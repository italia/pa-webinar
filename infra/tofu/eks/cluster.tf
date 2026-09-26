# Cluster EKS: control plane, cifratura dei Secret, log, voci di accesso e
# componenti aggiuntivi gestiti da EKS.
#
# I componenti di base (VPC CNI, kube-proxy, CoreDNS, agente di Pod Identity)
# sono componenti aggiuntivi EKS e non quelli che EKS installerebbe da sé
# (bootstrap_self_managed_addons = false): così se ne controllano versione e
# configurazione da qui, a partire dall'applicazione delle NetworkPolicy.

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
}

# ── Chiave per i Secret di Kubernetes ────────────────────────
# I Secret dell'applicazione contengono la chiave che cifra i dati personali,
# le password dei datastore e le chiavi dello storage: EKS li cifra con questa
# chiave, oltre alla cifratura del disco di etcd.

resource "aws_kms_key" "eks_secrets" {
  description             = "${var.name}: cifratura dei Secret di Kubernetes"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "eks_secrets" {
  name          = "alias/${var.name}-eks-secrets"
  target_key_id = aws_kms_key.eks_secrets.key_id
}

# ── Ruolo del control plane ──────────────────────────────────

data "aws_iam_policy_document" "cluster_assume" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster" {
  name               = "${var.name}-eks-cluster"
  assume_role_policy = data.aws_iam_policy_document.cluster_assume.json
}

resource "aws_iam_role_policy_attachment" "cluster" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/AmazonEKSClusterPolicy"
}

# Il control plane cifra e decifra i Secret con la chiave qui sopra: la policy
# gestita di EKS non comprende KMS.
data "aws_iam_policy_document" "cluster_encryption" {
  statement {
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ListGrants",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.eks_secrets.arn]
  }
}

resource "aws_iam_role_policy" "cluster_encryption" {
  name   = "secrets-encryption"
  role   = aws_iam_role.cluster.id
  policy = data.aws_iam_policy_document.cluster_encryption.json
}

# ── Log del control plane ────────────────────────────────────
# Creato qui, prima del cluster, per fissarne la conservazione: quello che EKS
# creerebbe da sé non scade mai.

#trivy:ignore:AVD-AWS-0017 Log del control plane cifrati con la chiave gestita da CloudWatch; una chiave dedicata si aggiunge con kms_key_id se la policy dell'ente lo chiede.
resource "aws_cloudwatch_log_group" "cluster" {
  name              = "/aws/eks/${var.name}/cluster"
  retention_in_days = var.cluster_log_retention_days
}

# ── Cluster ──────────────────────────────────────────────────

#trivy:ignore:AVD-AWS-0040 Endpoint pubblico limitato a cluster_endpoint_public_access_cidrs (0.0.0.0/0 rifiutato dalla validazione); con cluster_endpoint_public_access = false resta solo quello privato.
#trivy:ignore:AVD-AWS-0041 Gli indirizzi ammessi sull'endpoint pubblico li sceglie l'ente in cluster_endpoint_public_access_cidrs, e 0.0.0.0/0 è rifiutato.
#trivy:ignore:AVD-AWS-0038 Log del control plane scelti in cluster_log_types: api, audit e authenticator di base; scheduler e controllerManager si aggiungono lì, a costo di più volume in CloudWatch.
resource "aws_eks_cluster" "this" {
  name     = var.name
  version  = var.cluster_version
  role_arn = aws_iam_role.cluster.arn

  bootstrap_self_managed_addons = false
  enabled_cluster_log_types     = var.cluster_log_types

  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = true
  }

  vpc_config {
    subnet_ids              = aws_subnet.private[*].id
    endpoint_private_access = true
    endpoint_public_access  = var.cluster_endpoint_public_access
    public_access_cidrs     = var.cluster_endpoint_public_access ? var.cluster_endpoint_public_access_cidrs : null
  }

  encryption_config {
    resources = ["secrets"]

    provider {
      key_arn = aws_kms_key.eks_secrets.arn
    }
  }

  upgrade_policy {
    support_type = var.cluster_support_type
  }

  lifecycle {
    precondition {
      condition     = !var.cluster_endpoint_public_access || length(var.cluster_endpoint_public_access_cidrs) > 0
      error_message = "Con l'endpoint pubblico acceso servono gli indirizzi ammessi in cluster_endpoint_public_access_cidrs: senza, EKS lo aprirebbe a tutta Internet."
    }
    precondition {
      condition     = var.jvb_az_index >= 0 && var.jvb_az_index < var.az_count
      error_message = "jvb_az_index deve indicare una delle az_count zone usate (da 0 a az_count - 1)."
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.cluster,
    aws_iam_role_policy.cluster_encryption,
    aws_cloudwatch_log_group.cluster,
  ]
}

data "aws_eks_cluster_auth" "this" {
  name = aws_eks_cluster.this.name
}

# ── Accesso degli amministratori ─────────────────────────────

resource "aws_eks_access_entry" "admin" {
  for_each = toset(var.cluster_admin_principal_arns)

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value
}

resource "aws_eks_access_policy_association" "admin" {
  for_each = toset(var.cluster_admin_principal_arns)

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value
  policy_arn    = "arn:${local.partition}:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }

  depends_on = [aws_eks_access_entry.admin]
}

# ── Componenti aggiuntivi EKS ────────────────────────────────
# Prima dei nodi: rete dei pod, kube-proxy e agente di Pod Identity, senza i
# quali un nodo non diventa Ready o i controller non ricevono credenziali.
# Dopo i nodi: CoreDNS, driver EBS e metrics-server, che girano come
# Deployment e resterebbero degradati senza un nodo su cui partire.

resource "aws_eks_addon" "vpc_cni" {
  cluster_name  = aws_eks_cluster.this.name
  addon_name    = "vpc-cni"
  addon_version = lookup(var.addon_versions, "vpc-cni", null)

  configuration_values = jsonencode({
    enableNetworkPolicy = var.enable_network_policy ? "true" : "false"
  })

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name  = aws_eks_cluster.this.name
  addon_name    = "kube-proxy"
  addon_version = lookup(var.addon_versions, "kube-proxy", null)

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
}

resource "aws_eks_addon" "pod_identity_agent" {
  cluster_name  = aws_eks_cluster.this.name
  addon_name    = "eks-pod-identity-agent"
  addon_version = lookup(var.addon_versions, "eks-pod-identity-agent", null)

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
}

resource "aws_eks_addon" "coredns" {
  cluster_name  = aws_eks_cluster.this.name
  addon_name    = "coredns"
  addon_version = lookup(var.addon_versions, "coredns", null)

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.this]
}

# Driver CSI di EBS: dà i volumi al PostgreSQL del cluster. Dalla versione
# 1.30 EKS non crea più nessuna StorageClass: quella predefinita la crea
# storage-class.tf.
resource "aws_eks_addon" "ebs_csi" {
  cluster_name  = aws_eks_cluster.this.name
  addon_name    = "aws-ebs-csi-driver"
  addon_version = lookup(var.addon_versions, "aws-ebs-csi-driver", null)

  pod_identity_association {
    role_arn        = aws_iam_role.ebs_csi.arn
    service_account = "ebs-csi-controller-sa"
  }

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [
    aws_eks_node_group.this,
    aws_eks_addon.pod_identity_agent,
  ]
}

resource "aws_eks_addon" "metrics_server" {
  count = var.enable_metrics_server_addon ? 1 : 0

  cluster_name  = aws_eks_cluster.this.name
  addon_name    = "metrics-server"
  addon_version = lookup(var.addon_versions, "metrics-server", null)

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.this]
}

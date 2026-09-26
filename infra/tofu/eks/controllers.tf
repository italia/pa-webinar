# Ruoli IAM dei controller del cluster, consegnati con EKS Pod Identity: il
# ruolo si lega a un ServiceAccount (namespace + nome) e l'agente di Pod
# Identity dà le credenziali ai pod che lo usano. I controller si installano
# poi con Helm, con gli stessi nomi di ServiceAccount (README.md).
#
# Il portale NON usa Pod Identity per lo storage: legge solo chiavi statiche
# (storage.tf).

data "aws_iam_policy_document" "pod_identity_assume" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

# ── Driver CSI di EBS ────────────────────────────────────────

resource "aws_iam_role" "ebs_csi" {
  name               = "${var.name}-ebs-csi"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume.json
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  role       = aws_iam_role.ebs_csi.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

# ── Cluster Autoscaler ───────────────────────────────────────
# Accende e spegne i nodi dei gruppi gestiti: è ciò che porta a zero il pool
# dei bridge fuori dagli eventi. Può cambiare solo i gruppi di autoscaling di
# questo cluster (tag che EKS mette sui gruppi gestiti).

data "aws_iam_policy_document" "cluster_autoscaler" {
  statement {
    sid = "Read"
    actions = [
      "autoscaling:DescribeAutoScalingGroups",
      "autoscaling:DescribeAutoScalingInstances",
      "autoscaling:DescribeLaunchConfigurations",
      "autoscaling:DescribeScalingActivities",
      "autoscaling:DescribeTags",
      "ec2:DescribeImages",
      "ec2:DescribeInstanceTypes",
      "ec2:DescribeLaunchTemplateVersions",
      "ec2:GetInstanceTypesFromInstanceRequirements",
      "eks:DescribeNodegroup",
    ]
    resources = ["*"]
  }

  statement {
    sid = "ScaleOwnGroups"
    actions = [
      "autoscaling:SetDesiredCapacity",
      "autoscaling:TerminateInstanceInAutoScalingGroup",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/k8s.io/cluster-autoscaler/${var.name}"
      values   = ["owned"]
    }
  }
}

resource "aws_iam_role" "cluster_autoscaler" {
  count = var.create_cluster_autoscaler_role ? 1 : 0

  name               = "${var.name}-cluster-autoscaler"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume.json
}

resource "aws_iam_role_policy" "cluster_autoscaler" {
  count = var.create_cluster_autoscaler_role ? 1 : 0

  name   = "cluster-autoscaler"
  role   = aws_iam_role.cluster_autoscaler[0].id
  policy = data.aws_iam_policy_document.cluster_autoscaler.json
}

resource "aws_eks_pod_identity_association" "cluster_autoscaler" {
  count = var.create_cluster_autoscaler_role ? 1 : 0

  cluster_name    = aws_eks_cluster.this.name
  namespace       = "kube-system"
  service_account = "cluster-autoscaler"
  role_arn        = aws_iam_role.cluster_autoscaler[0].arn
}

# ── AWS Load Balancer Controller ─────────────────────────────
# Crea i Network Load Balancer dei Service di tipo LoadBalancer con
# loadBalancerClass service.k8s.aws/nlb: ingress-nginx, bridge (UDP), coturn.
# Il controller integrato di Kubernetes creerebbe un Classic Load Balancer,
# che non porta UDP. La policy è quella pubblicata dal progetto del controller
# (policies/aws-load-balancer-controller.json, vedi README.md).

resource "aws_iam_policy" "load_balancer_controller" {
  count = var.create_load_balancer_controller_role ? 1 : 0

  name   = "${var.name}-aws-load-balancer-controller"
  policy = file("${path.module}/policies/aws-load-balancer-controller.json")
}

resource "aws_iam_role" "load_balancer_controller" {
  count = var.create_load_balancer_controller_role ? 1 : 0

  name               = "${var.name}-aws-load-balancer-controller"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume.json
}

resource "aws_iam_role_policy_attachment" "load_balancer_controller" {
  count = var.create_load_balancer_controller_role ? 1 : 0

  role       = aws_iam_role.load_balancer_controller[0].name
  policy_arn = aws_iam_policy.load_balancer_controller[0].arn
}

resource "aws_eks_pod_identity_association" "load_balancer_controller" {
  count = var.create_load_balancer_controller_role ? 1 : 0

  cluster_name    = aws_eks_cluster.this.name
  namespace       = "kube-system"
  service_account = "aws-load-balancer-controller"
  role_arn        = aws_iam_role.load_balancer_controller[0].arn
}

# ── cert-manager (verifica DNS-01 su Route 53) ───────────────
# Serve al certificato del nome del TURN, che punta al bilanciatore di coturn
# e non all'ingress, e quindi non passa la verifica HTTP-01. Può scrivere solo
# nelle zone indicate.

data "aws_iam_policy_document" "cert_manager" {
  count = length(var.cert_manager_route53_zone_ids) > 0 ? 1 : 0

  statement {
    sid       = "Changes"
    actions   = ["route53:GetChange"]
    resources = ["arn:${local.partition}:route53:::change/*"]
  }

  statement {
    sid = "Records"
    actions = [
      "route53:ChangeResourceRecordSets",
      "route53:ListResourceRecordSets",
    ]
    resources = [for z in var.cert_manager_route53_zone_ids : "arn:${local.partition}:route53:::hostedzone/${z}"]
  }

  statement {
    sid       = "Zones"
    actions   = ["route53:ListHostedZonesByName"]
    resources = ["*"]
  }
}

resource "aws_iam_role" "cert_manager" {
  count = length(var.cert_manager_route53_zone_ids) > 0 ? 1 : 0

  name               = "${var.name}-cert-manager"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume.json
}

resource "aws_iam_role_policy" "cert_manager" {
  count = length(var.cert_manager_route53_zone_ids) > 0 ? 1 : 0

  name   = "route53-dns01"
  role   = aws_iam_role.cert_manager[0].id
  policy = data.aws_iam_policy_document.cert_manager[0].json
}

resource "aws_eks_pod_identity_association" "cert_manager" {
  count = length(var.cert_manager_route53_zone_ids) > 0 ? 1 : 0

  cluster_name    = aws_eks_cluster.this.name
  namespace       = "cert-manager"
  service_account = "cert-manager"
  role_arn        = aws_iam_role.cert_manager[0].arn
}

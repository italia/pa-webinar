# Gruppi di nodi gestiti.
#
#   applications — sempre acceso (app_min_size): portale, CronJob, Prosody,
#                  Jicofo, web, datastore del cluster, controller. Etichetta
#                  workload=applications, nessun taint.
#   jvb          — da zero nodi, un bridge per nodo. Etichetta e taint
#                  workload=jitsi-jvb, gli stessi di examples/values-full.yaml.
#   jibri        — facoltativo, da zero nodi. Etichetta e taint
#                  workload=jitsi-jibri.
#   gpu          — facoltativo, da zero nodi. Etichetta e taint
#                  workload=ai-gpu, i valori predefiniti di postprod.worker,
#                  più le etichette che il plugin dei dispositivi NVIDIA e
#                  Cluster Autoscaler cercano per riconoscere un nodo GPU.
#
# Un gruppo gestito a zero nodi non ha nodi da cui Cluster Autoscaler possa
# leggere etichette e taint: glieli dicono i tag del gruppo di autoscaling
# (k8s.io/cluster-autoscaler/node-template/*), messi in fondo a questo file.

locals {
  cluster_security_group_id = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id

  # Con il bilanciatore UDP i nodi dei bridge stanno nella stessa zona del suo
  # Elastic IP: niente traffico dei media fra zone. Con un IP per nodo stanno
  # nelle sottoreti pubbliche.
  jvb_subnet_ids = (
    var.jvb_exposure == "nlb"
    ? [aws_subnet.private[local.jvb_az].id]
    : aws_subnet.public[*].id
  )

  node_groups = {
    applications = {
      enabled        = true
      instance_types = var.app_instance_types
      ami_type       = "AL2023_x86_64_STANDARD"
      disk_size_gb   = var.app_disk_size_gb
      min_size       = var.app_min_size
      max_size       = var.app_max_size
      subnet_ids     = aws_subnet.private[*].id
      labels         = { workload = "applications" }
      taints         = []
      gpus           = 0
      extra_security_group_ids = concat(
        [aws_security_group.app_edge.id],
        aws_security_group.turn[*].id,
      )
    }
    jvb = {
      enabled                  = true
      instance_types           = var.jvb_instance_types
      ami_type                 = "AL2023_x86_64_STANDARD"
      disk_size_gb             = 30
      min_size                 = 0
      max_size                 = var.jvb_max_size
      subnet_ids               = local.jvb_subnet_ids
      labels                   = { workload = "jitsi-jvb" }
      taints                   = [{ key = "workload", value = "jitsi-jvb" }]
      gpus                     = 0
      extra_security_group_ids = [aws_security_group.jvb.id]
    }
    jibri = {
      enabled                  = var.jibri_enabled
      instance_types           = var.jibri_instance_types
      ami_type                 = "AL2023_x86_64_STANDARD"
      disk_size_gb             = 50
      min_size                 = 0
      max_size                 = var.jibri_max_size
      subnet_ids               = aws_subnet.private[*].id
      labels                   = { workload = "jitsi-jibri" }
      taints                   = [{ key = "workload", value = "jitsi-jibri" }]
      gpus                     = 0
      extra_security_group_ids = []
    }
    gpu = {
      enabled        = var.gpu_enabled
      instance_types = var.gpu_instance_types
      ami_type       = "AL2023_x86_64_NVIDIA"
      disk_size_gb   = var.gpu_disk_size_gb
      min_size       = 0
      max_size       = var.gpu_max_size
      subnet_ids     = aws_subnet.private[*].id
      labels = {
        workload    = "ai-gpu"
        accelerator = "nvidia"
        # L'affinità predefinita del plugin dei dispositivi NVIDIA sceglie i
        # nodi con questa etichetta: senza, nvidia.com/gpu non diventa mai
        # allocabile e il worker resta in attesa.
        "nvidia.com/gpu.present" = "true"
        # Cluster Autoscaler (fornitore AWS) tratta come GPU i nodi con questa
        # etichetta, e li aspetta finché il plugin non espone la GPU invece di
        # aggiungerne un altro.
        "k8s.amazonaws.com/accelerator" = var.gpu_accelerator_type
      }
      taints                   = [{ key = "workload", value = "ai-gpu" }]
      gpus                     = 1
      extra_security_group_ids = []
    }
  }

  enabled_node_groups = { for k, g in local.node_groups : k => g if g.enabled }

  # Tag per Cluster Autoscaler: uno per etichetta, per taint e, sui nodi GPU,
  # per la risorsa nvidia.com/gpu.
  autoscaler_template_tags = merge([
    for k, g in local.enabled_node_groups : merge(
      {
        for lk, lv in g.labels :
        "${k}/label/${lk}" => {
          group = k
          key   = "k8s.io/cluster-autoscaler/node-template/label/${lk}"
          value = lv
        }
      },
      {
        for t in g.taints :
        "${k}/taint/${t.key}" => {
          group = k
          key   = "k8s.io/cluster-autoscaler/node-template/taint/${t.key}"
          value = "${t.value}:NoSchedule"
        }
      },
      g.gpus > 0 ? {
        "${k}/resources/gpu" = {
          group = k
          key   = "k8s.io/cluster-autoscaler/node-template/resources/nvidia.com/gpu"
          value = tostring(g.gpus)
        }
      } : {},
    )
  ]...)
}

# ── Ruolo dei nodi ───────────────────────────────────────────

data "aws_iam_policy_document" "node_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "node" {
  name               = "${var.name}-eks-node"
  assume_role_policy = data.aws_iam_policy_document.node_assume.json
}

resource "aws_iam_role_policy_attachment" "node" {
  for_each = toset(concat(
    [
      "AmazonEKSWorkerNodePolicy",
      "AmazonEKS_CNI_Policy",
      # Solo prelievo da ECR: basta per le immagini copiate in un registro
      # ECR dell'account, senza Secret di prelievo.
      "AmazonEC2ContainerRegistryPullOnly",
    ],
    var.node_ssm_access ? ["AmazonSSMManagedInstanceCore"] : [],
  ))

  role       = aws_iam_role.node.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/${each.value}"
}

# ── Gruppi di sicurezza dei nodi ─────────────────────────────
# Si aggiungono al gruppo di sicurezza del cluster, che resta su ogni nodo e
# lascia passare tutto il traffico fra i nodi e verso l'esterno. Qui solo le
# porte che arrivano da fuori attraverso i bilanciatori, che per UDP (e per
# TCP con preserve_client_ip) consegnano con l'indirizzo del client.
# Nessuno di questi gruppi porta il tag kubernetes.io/cluster/<nome>: AWS Load
# Balancer Controller ne vuole uno solo per nodo, ed è quello del cluster.
#
# Davanti a un Network Load Balancer queste regole sono un secondo livello:
# il controller crea per ogni bilanciatore un gruppo di sicurezza che ammette
# le sorgenti del Service (load-balancer-source-ranges, 0.0.0.0/0 se assenti)
# e apre il gruppo del cluster al bilanciatore. Il filtro che conta è quindi
# quello del Service: per il bridge e il TURN lo scrive helm_values da
# public_ingress_cidrs, per ingress-nginx va nei suoi valori (README.md).
# Senza bilanciatore (jvb_exposure = "node-public-ip") la regola del bridge è
# invece l'unico filtro.

resource "aws_security_group" "app_edge" {
  name        = "${var.name}-app-edge"
  description = "Portale e conferenza: HTTP e HTTPS verso ingress-nginx dietro il Network Load Balancer"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${var.name}-app-edge" }
}

#trivy:ignore:AVD-AWS-0107 Portale pubblico: HTTPS e HTTP (verifica HTTP-01 e redirect) aperti ai partecipanti, su nodi senza indirizzo pubblico raggiunti solo attraverso il bilanciatore.
resource "aws_vpc_security_group_ingress_rule" "app_edge" {
  for_each = {
    for pair in setproduct([80, 443], var.public_ingress_cidrs) :
    "${pair[0]}-${pair[1]}" => { port = pair[0], cidr = pair[1] }
  }

  security_group_id = aws_security_group.app_edge.id
  description       = "ingress-nginx ${each.value.port}/tcp"
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
  cidr_ipv4         = each.value.cidr
}

resource "aws_security_group" "jvb" {
  name        = "${var.name}-jvb"
  description = "Bridge: media UDP dai partecipanti e controllo di salute del bilanciatore"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${var.name}-jvb" }
}

#trivy:ignore:AVD-AWS-0107 I media arrivano dai browser dei partecipanti, da qualunque rete: la porta UDP del bridge è pubblica per costruzione (public_ingress_cidrs).
resource "aws_vpc_security_group_ingress_rule" "jvb_media" {
  for_each = toset(var.public_ingress_cidrs)

  security_group_id = aws_security_group.jvb.id
  description       = "JVB media ${var.jvb_udp_port}/udp"
  ip_protocol       = "udp"
  from_port         = var.jvb_udp_port
  to_port           = var.jvb_udp_port
  cidr_ipv4         = each.value
}

# Il bilanciatore controlla il bridge sulla sua API di salute (porta 8080,
# /about/health): la porta UDP non si può sondare.
resource "aws_vpc_security_group_ingress_rule" "jvb_health" {
  security_group_id = aws_security_group.jvb.id
  description       = "JVB health check dal bilanciatore"
  ip_protocol       = "tcp"
  from_port         = 8080
  to_port           = 8080
  cidr_ipv4         = aws_vpc.this.cidr_block
}

resource "aws_security_group" "turn" {
  count = var.turn_enabled ? 1 : 0

  name        = "${var.name}-turn"
  description = "coturn: TURN su UDP 3478 e TURN su TLS 443 dietro il proprio Network Load Balancer"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${var.name}-turn" }
}

#trivy:ignore:AVD-AWS-0107 TURN serve proprio i partecipanti dietro firewall che bloccano l'UDP del bridge: deve essere raggiungibile da qualunque rete.
resource "aws_vpc_security_group_ingress_rule" "turn" {
  for_each = var.turn_enabled ? {
    for pair in setproduct(["udp/3478", "tcp/443"], var.public_ingress_cidrs) :
    "${pair[0]}-${pair[1]}" => {
      protocol = split("/", pair[0])[0]
      port     = tonumber(split("/", pair[0])[1])
      cidr     = pair[1]
    }
  } : {}

  security_group_id = aws_security_group.turn[0].id
  description       = "coturn ${each.value.port}/${each.value.protocol}"
  ip_protocol       = each.value.protocol
  from_port         = each.value.port
  to_port           = each.value.port
  cidr_ipv4         = each.value.cidr
}

resource "aws_vpc_security_group_ingress_rule" "turn_health" {
  count = var.turn_enabled ? 1 : 0

  security_group_id = aws_security_group.turn[0].id
  description       = "coturn health check dal bilanciatore"
  ip_protocol       = "tcp"
  from_port         = 3478
  to_port           = 3478
  cidr_ipv4         = aws_vpc.this.cidr_block
}

# ── Launch template ──────────────────────────────────────────
# Uno per gruppo: IMDSv2 obbligatorio, disco gp3 cifrato, gruppi di sicurezza.
# Limite di salti 1: i pod fuori dalla rete dell'host non raggiungono i
# metadati dell'istanza, e quindi nemmeno le credenziali del ruolo dei nodi
# (che può modificare le interfacce di rete dell'account). Li leggono solo i
# componenti sulla rete dell'host (VPC CNI, kube-proxy, agente di Pod
# Identity); il driver EBS ricava zona e istanza dall'API di Kubernetes, e ai
# controller installati con Helm la regione si passa esplicitamente
# (README.md).

resource "aws_launch_template" "node" {
  for_each = local.enabled_node_groups

  name_prefix            = "${var.name}-${each.key}-"
  update_default_version = true

  vpc_security_group_ids = concat([local.cluster_security_group_id], each.value.extra_security_group_ids)

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      volume_size           = each.value.disk_size_gb
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${var.name}-${each.key}" }
  }

  tag_specifications {
    resource_type = "volume"
    tags          = { Name = "${var.name}-${each.key}" }
  }
}

# ── Gruppi di nodi ───────────────────────────────────────────

resource "aws_eks_node_group" "this" {
  for_each = local.enabled_node_groups

  cluster_name    = aws_eks_cluster.this.name
  node_group_name = each.key
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = each.value.subnet_ids
  instance_types  = each.value.instance_types
  ami_type        = each.value.ami_type
  capacity_type   = "ON_DEMAND"

  # Stessa versione minore del control plane: quando cluster_version sale, i
  # gruppi si aggiornano dopo di lui, un nodo alla volta (README.md,
  # "Kubernetes upgrades"). Senza, resterebbero alla versione della creazione.
  version = aws_eks_cluster.this.version

  labels = each.value.labels

  dynamic "taint" {
    for_each = each.value.taints

    content {
      key    = taint.value.key
      value  = taint.value.value
      effect = "NO_SCHEDULE"
    }
  }

  scaling_config {
    min_size     = each.value.min_size
    max_size     = each.value.max_size
    desired_size = each.value.min_size
  }

  update_config {
    max_unavailable = 1
  }

  launch_template {
    id      = aws_launch_template.node[each.key].id
    version = aws_launch_template.node[each.key].latest_version
  }

  lifecycle {
    # Il numero di nodi lo decide Cluster Autoscaler: un nuovo `apply` non
    # deve riportarlo al minimo a evento in corso.
    ignore_changes = [scaling_config[0].desired_size]
  }

  depends_on = [
    aws_iam_role_policy_attachment.node,
    aws_eks_addon.vpc_cni,
    aws_eks_addon.kube_proxy,
    aws_eks_addon.pod_identity_agent,
  ]
}

resource "aws_autoscaling_group_tag" "node_template" {
  for_each = local.autoscaler_template_tags

  autoscaling_group_name = aws_eks_node_group.this[each.value.group].resources[0].autoscaling_groups[0].name

  tag {
    key                 = each.value.key
    value               = each.value.value
    propagate_at_launch = false
  }
}

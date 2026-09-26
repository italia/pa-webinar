locals {
  # Valori del chart che dipendono da questa infrastruttura. Nessun segreto:
  # le chiavi dello storage vanno nel Secret dell'applicazione (README.md).
  helm_values_app = {
    env = {
      STORAGE_FILES_PROVIDER  = "s3"
      STORAGE_FILES_S3_REGION = var.region
      STORAGE_FILES_S3_BUCKET = aws_s3_bucket.media.bucket
      RECORDING_STORAGE_TYPE  = "s3"
      RECORDING_S3_REGION     = var.region
      RECORDING_S3_BUCKET     = aws_s3_bucket.media.bucket
      # Tetto dei bridge per lo scaler e la pagina di stato: con il
      # bilanciatore UDP uno solo.
      JVB_MAX_REPLICAS = var.jvb_exposure == "nlb" ? "1" : tostring(var.jvb_max_size)
    }
  }

  # Chi può raggiungere i bilanciatori del bridge e del TURN. AWS Load
  # Balancer Controller ne fa il gruppo di sicurezza del bilanciatore, che è
  # il filtro vero: le regole sui nodi sono solo un secondo livello (nodes.tf).
  lb_source_ranges = join(",", var.public_ingress_cidrs)

  # jsondecode(jsonencode()) rende uniformi i tipi dei due rami: i blocchi
  # facoltativi hanno forme diverse.
  helm_values_jitsi_meet = merge(
    {
      jvb = merge(
        # La stessa porta aperta nel gruppo di sicurezza dei bridge.
        { UDPPort = var.jvb_udp_port },
        jsondecode(var.jvb_exposure == "nlb" ? jsonencode({
          publicIPs = [aws_eip.jvb[0].public_ip]
          service = {
            annotations = {
              "service.beta.kubernetes.io/aws-load-balancer-subnets"         = aws_subnet.public[local.jvb_az].id
              "service.beta.kubernetes.io/aws-load-balancer-eip-allocations" = aws_eip.jvb[0].allocation_id
              "service.beta.kubernetes.io/load-balancer-source-ranges"       = local.lb_source_ranges
            }
          }
        }) : "{}"),
      )
    },
    jsondecode(var.turn_enabled ? jsonencode({
      coturn = {
        # coturn inoltra i media al bridge sull'indirizzo del pod: la VPC.
        allowedPeerIPs = ["${cidrhost(var.vpc_cidr, 0)}-${cidrhost(var.vpc_cidr, -1)}"]
        service = {
          annotations = {
            "service.beta.kubernetes.io/aws-load-balancer-subnets"         = aws_subnet.public[local.jvb_az].id
            "service.beta.kubernetes.io/aws-load-balancer-eip-allocations" = aws_eip.turn[0].allocation_id
            "service.beta.kubernetes.io/load-balancer-source-ranges"       = local.lb_source_ranges
          }
        }
      }
    }) : "{}"),
  )
}

output "region" {
  description = "Regione AWS."
  value       = var.region
}

output "cluster_name" {
  description = "Nome del cluster EKS."
  value       = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  description = "Endpoint dell'API di Kubernetes."
  value       = aws_eks_cluster.this.endpoint
}

output "update_kubeconfig_command" {
  description = "Comando che aggiunge il cluster al kubeconfig di chi lo esegue."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${aws_eks_cluster.this.name}"
}

output "vpc_id" {
  description = "VPC del cluster: serve all'installazione di AWS Load Balancer Controller."
  value       = aws_vpc.this.id
}

output "public_subnet_ids" {
  description = "Sottoreti pubbliche (bilanciatori esposti a Internet)."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Sottoreti private (nodi)."
  value       = aws_subnet.private[*].id
}

output "jvb_public_ip" {
  description = "Con jvb_exposure = \"nlb\": l'indirizzo che il bridge annuncia ai browser. Nel firewall dei partecipanti: la porta UDP jvb_udp_port (10000 di base) verso questo indirizzo."
  value       = var.jvb_exposure == "nlb" ? aws_eip.jvb[0].public_ip : null
}

output "turn_public_ip" {
  description = "Con turn_enabled: l'indirizzo del TURN. Il suo nome DNS (turn.<dominio>) va puntato qui."
  value       = var.turn_enabled ? aws_eip.turn[0].public_ip : null
}

output "s3_bucket" {
  description = "Bucket di materiali, registrazioni e risultati AI."
  value       = aws_s3_bucket.media.bucket
}

output "s3_access_key_id" {
  description = "ID della chiave d'accesso dell'utente IAM dello storage."
  value       = var.s3_create_access_key ? aws_iam_access_key.storage[0].id : null
  sensitive   = true
}

output "s3_secret_access_key" {
  description = "Chiave segreta dell'utente IAM dello storage. Leggila solo per metterla nel Secret: tofu output -raw s3_secret_access_key."
  value       = var.s3_create_access_key ? aws_iam_access_key.storage[0].secret : null
  sensitive   = true
}

output "node_groups" {
  description = "Gruppi di nodi creati, con etichette e taint."
  value = {
    for k, g in local.enabled_node_groups : k => {
      labels = g.labels
      taints = [for t in g.taints : "${t.key}=${t.value}:NoSchedule"]
      min    = g.min_size
      max    = g.max_size
    }
  }
}

output "helm_values" {
  description = "File di valori del chart con ciò che dipende da questa infrastruttura: tofu output -raw helm_values > pa-webinar.eks-infra.yaml"
  value       = "# Generato da infra/tofu/eks (tofu output -raw helm_values). Nessun segreto.\n${yamlencode({ app = local.helm_values_app, "jitsi-meet" = local.helm_values_jitsi_meet })}"
}

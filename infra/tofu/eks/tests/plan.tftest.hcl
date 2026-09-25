# Prove del modulo senza account AWS: `tofu test` da infra/tofu/eks.
# I provider sono simulati, quindi si controllano solo la logica del modulo
# (quali risorse, con quali valori) e le sue validazioni, non le API di AWS.

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["eu-south-1a", "eu-south-1b", "eu-south-1c"]
    }
  }

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "111122223333"
    }
  }

  mock_data "aws_partition" {
    defaults = {
      partition = "aws"
    }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  # Gli ARN simulati devono avere la forma giusta: il provider li controlla
  # anche quando le API sono simulate.
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::111122223333:role/mock"
    }
  }

  mock_resource "aws_iam_policy" {
    defaults = {
      arn = "arn:aws:iam::111122223333:policy/mock"
    }
  }

  mock_resource "aws_kms_key" {
    defaults = {
      arn = "arn:aws:kms:eu-south-1:111122223333:key/00000000-0000-0000-0000-000000000000"
    }
  }

  mock_resource "aws_s3_bucket" {
    defaults = {
      arn = "arn:aws:s3:::mock-bucket"
    }
  }

  mock_resource "aws_iam_user" {
    defaults = {
      arn = "arn:aws:iam::111122223333:user/mock"
    }
  }

  mock_resource "aws_launch_template" {
    defaults = {
      id             = "lt-0123456789abcdef0"
      latest_version = 1
    }
  }

  mock_resource "aws_eks_node_group" {
    defaults = {
      resources = [{
        autoscaling_groups              = [{ name = "eks-nodegroup-asg" }]
        remote_access_security_group_id = ""
      }]
    }
  }

  mock_resource "aws_eks_cluster" {
    defaults = {
      endpoint = "https://cluster.example.com"
      certificate_authority = [{
        data = "Y2VydGlmaWNhdGU="
      }]
    }
  }

  mock_resource "aws_eip" {
    defaults = {
      public_ip     = "198.51.100.10"
      allocation_id = "eipalloc-mock"
    }
  }
}

mock_provider "kubernetes" {}

variables {
  region                               = "eu-south-1"
  cluster_version                      = "1.36"
  cluster_endpoint_public_access_cidrs = ["192.0.2.0/24"]
  portal_origins                       = ["https://webinar.example.com"]
}

run "predefinito_bridge_dietro_nlb" {
  command = apply

  assert {
    condition     = length(aws_eip.jvb) == 1 && length(aws_eip.turn) == 0
    error_message = "Con jvb_exposure = nlb serve un solo Elastic IP, per il bridge."
  }

  assert {
    condition     = toset(keys(aws_eks_node_group.this)) == toset(["applications", "jvb"])
    error_message = "Di base solo i pool applications e jvb."
  }

  assert {
    condition     = aws_eks_node_group.this["jvb"].scaling_config[0].min_size == 0
    error_message = "Il pool dei bridge deve partire da zero nodi."
  }

  assert {
    condition     = length(local.jvb_subnet_ids) == 1
    error_message = "Con il bilanciatore UDP i nodi dei bridge stanno nella sola zona del suo Elastic IP."
  }

  assert {
    condition     = alltrue([for s in aws_subnet.public : !s.map_public_ip_on_launch])
    error_message = "Senza nodi pubblici le sottoreti pubbliche non assegnano IP alle istanze."
  }

  assert {
    condition     = aws_eks_node_group.this["jvb"].labels["workload"] == "jitsi-jvb"
    error_message = "Etichetta del pool dei bridge diversa da quella di values-full.yaml."
  }

  assert {
    condition     = aws_autoscaling_group_tag.node_template["jvb/taint/workload"].tag[0].value == "jitsi-jvb:NoSchedule"
    error_message = "Cluster Autoscaler deve conoscere il taint del pool dei bridge a zero nodi."
  }

  assert {
    condition     = strcontains(output.helm_values, "aws-load-balancer-eip-allocations") && strcontains(output.helm_values, "JVB_MAX_REPLICAS\": \"1\"")
    error_message = "I valori per il chart devono portare l'Elastic IP del bridge e il tetto di un bridge."
  }

  assert {
    condition     = aws_s3_bucket.media.bucket == "pa-webinar-media-111122223333-eu-south-1"
    error_message = "Nome predefinito del bucket inatteso."
  }

  assert {
    condition     = kubernetes_storage_class_v1.gp3[0].metadata[0].annotations["storageclass.kubernetes.io/is-default-class"] == "true"
    error_message = "Manca la StorageClass predefinita."
  }

  assert {
    condition     = jsondecode(aws_eks_addon.vpc_cni.configuration_values).enableNetworkPolicy == "true"
    error_message = "Il VPC CNI deve applicare le NetworkPolicy."
  }

  assert {
    condition     = alltrue([for lt in aws_launch_template.node : lt.metadata_options[0].http_put_response_hop_limit == 1 && lt.metadata_options[0].http_tokens == "required"])
    error_message = "I pod non devono raggiungere i metadati dell'istanza (IMDSv2, limite di salti 1)."
  }

  assert {
    condition     = alltrue([for g in aws_eks_node_group.this : g.version == "1.36"])
    error_message = "I gruppi di nodi devono seguire la versione del control plane."
  }

  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].jvb.UDPPort == 10000
    error_message = "La porta UDP del bridge deve arrivare al chart."
  }

  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].jvb.service.annotations["service.beta.kubernetes.io/load-balancer-source-ranges"] == "0.0.0.0/0"
    error_message = "Il bilanciatore del bridge deve ricevere le sorgenti ammesse."
  }
}

run "bridge_su_nodi_pubblici_con_turn_jibri_gpu" {
  command = apply

  variables {
    jvb_exposure  = "node-public-ip"
    jvb_max_size  = 3
    turn_enabled  = true
    jibri_enabled = true
    gpu_enabled   = true
  }

  assert {
    condition     = length(aws_eip.jvb) == 0 && length(aws_eip.turn) == 1
    error_message = "Con i nodi pubblici nessun Elastic IP del bridge; con il TURN il suo."
  }

  assert {
    condition     = alltrue([for s in aws_subnet.public : s.map_public_ip_on_launch])
    error_message = "EKS vuole l'assegnazione automatica dell'IP pubblico nelle sottoreti dei nodi pubblici."
  }

  assert {
    condition     = length(local.jvb_subnet_ids) == 3
    error_message = "Con i nodi pubblici il pool dei bridge usa tutte le sottoreti pubbliche."
  }

  assert {
    condition     = toset(keys(aws_eks_node_group.this)) == toset(["applications", "jvb", "jibri", "gpu"])
    error_message = "Mancano i pool facoltativi."
  }

  assert {
    condition     = aws_eks_node_group.this["gpu"].ami_type == "AL2023_x86_64_NVIDIA"
    error_message = "Il pool GPU vuole l'AMI con i driver NVIDIA."
  }

  assert {
    condition     = aws_autoscaling_group_tag.node_template["gpu/resources/gpu"].tag[0].value == "1"
    error_message = "Cluster Autoscaler deve sapere che il nodo GPU porta una GPU."
  }

  assert {
    condition     = aws_eks_node_group.this["gpu"].labels["nvidia.com/gpu.present"] == "true" && aws_eks_node_group.this["gpu"].labels["k8s.amazonaws.com/accelerator"] == "nvidia-a10g"
    error_message = "I nodi GPU devono portare le etichette cercate dal plugin NVIDIA e da Cluster Autoscaler."
  }

  assert {
    condition     = aws_autoscaling_group_tag.node_template["gpu/label/k8s.amazonaws.com/accelerator"].tag[0].key == "k8s.io/cluster-autoscaler/node-template/label/k8s.amazonaws.com/accelerator"
    error_message = "Il gruppo GPU a zero nodi deve annunciare l'etichetta dell'acceleratore a Cluster Autoscaler."
  }

  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].jvb.UDPPort == 10000 && !can(yamldecode(output.helm_values)["jitsi-meet"].jvb.service)
    error_message = "Con i nodi pubblici il bridge riceve la porta ma nessun Service."
  }

  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].coturn.service.annotations["service.beta.kubernetes.io/load-balancer-source-ranges"] == "0.0.0.0/0"
    error_message = "Il bilanciatore del TURN deve ricevere le sorgenti ammesse."
  }

  assert {
    condition     = strcontains(output.helm_values, "10.40.0.0-10.40.255.255") && strcontains(output.helm_values, "JVB_MAX_REPLICAS\": \"3\"")
    error_message = "allowedPeerIPs di coturn o tetto dei bridge sbagliati."
  }

  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.turn) == 2
    error_message = "Il TURN vuole UDP 3478 e TCP 443."
  }
}

run "porta_e_sorgenti_ristrette_arrivano_al_chart" {
  command = apply

  variables {
    jvb_udp_port         = 10500
    public_ingress_cidrs = ["198.51.100.0/24", "203.0.113.0/24"]
    turn_enabled         = true
  }

  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].jvb.UDPPort == 10500
    error_message = "La porta UDP scelta deve arrivare al chart."
  }

  assert {
    condition     = alltrue([for r in aws_vpc_security_group_ingress_rule.jvb_media : r.from_port == 10500 && r.to_port == 10500 && r.ip_protocol == "udp"])
    error_message = "Il gruppo di sicurezza dei bridge deve aprire la stessa porta del chart."
  }

  assert {
    condition = (
      yamldecode(output.helm_values)["jitsi-meet"].jvb.service.annotations["service.beta.kubernetes.io/load-balancer-source-ranges"] == "198.51.100.0/24,203.0.113.0/24"
      && yamldecode(output.helm_values)["jitsi-meet"].coturn.service.annotations["service.beta.kubernetes.io/load-balancer-source-ranges"] == "198.51.100.0/24,203.0.113.0/24"
    )
    error_message = "Le sorgenti ristrette devono arrivare ai bilanciatori del bridge e del TURN."
  }
}

run "nome_del_bucket_troppo_lungo_rifiutato_nel_piano" {
  command = plan

  variables {
    name   = "pa-webinar-ente-con-nome-lungo-x"
    region = "eu-central-1"
  }

  expect_failures = [aws_s3_bucket.media]
}

run "porta_del_bridge_fuori_intervallo_rifiutata" {
  command = plan

  variables {
    jvb_udp_port = 80
  }

  expect_failures = [var.jvb_udp_port]
}

run "endpoint_pubblico_senza_indirizzi_rifiutato" {
  command = plan

  variables {
    cluster_endpoint_public_access_cidrs = []
  }

  expect_failures = [aws_eks_cluster.this]
}

run "endpoint_aperto_a_tutti_rifiutato" {
  command = plan

  variables {
    cluster_endpoint_public_access_cidrs = ["0.0.0.0/0"]
  }

  expect_failures = [var.cluster_endpoint_public_access_cidrs]
}

run "origine_del_portale_non_https_rifiutata" {
  command = plan

  variables {
    portal_origins = ["http://webinar.example.com"]
  }

  expect_failures = [var.portal_origins]
}

run "zona_del_bridge_fuori_intervallo_rifiutata" {
  command = plan

  variables {
    az_count     = 2
    jvb_az_index = 2
  }

  expect_failures = [aws_eks_cluster.this]
}

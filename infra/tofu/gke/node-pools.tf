# Pool di nodi.
#
# Etichette e taint sono il contratto con i nodeSelector e le tolerations del
# chart (infra/helm/pa-webinar/examples/values-gke.yaml): cambiarli qui senza
# cambiare i valori lascia i pod in Pending. Si usano etichette proprie
# (workload=...) e non quella di GKE (cloud.google.com/gke-nodepool), così i
# valori del chart restano gli stessi su ogni piattaforma.
#
# min e max contano i nodi di tutte le zone (total_*). Un pool che parte da
# zero nodi resta spento finché un pod non lo chiede: i bridge li chiede lo
# scaler del chart, Jibri una registrazione, la GPU un lavoro di
# post-produzione.

locals {
  jvb_node_public_ip = var.jvb_exposure == "node_public_ip"

  # Etichetta di rete dei nodi dei bridge: la regola firewall dei media
  # (firewall.tf) si applica ai nodi che la portano.
  jvb_network_tag = "${var.name_prefix}-jvb"

  pools = merge(
    {
      apps = {
        machine_type     = var.apps_pool.machine_type
        min_nodes        = var.apps_pool.min_nodes
        max_nodes        = var.apps_pool.max_nodes
        initial_per_zone = 1
        disk_size_gb     = var.apps_pool.disk_size_gb
        labels           = { workload = "applications" }
        taints           = []
        tags             = ["${var.name_prefix}-apps"]
        private          = true
        spot             = false
        gvnic            = false
        location_policy  = "BALANCED"
        zones            = []
        accelerator      = null
      }

      jvb = {
        machine_type     = var.jvb_pool.machine_type
        min_nodes        = 0
        max_nodes        = var.jvb_pool.max_nodes
        initial_per_zone = 0
        disk_size_gb     = var.jvb_pool.disk_size_gb
        labels           = { workload = "jitsi-jvb" }
        taints           = [{ key = "workload", value = "jitsi-jvb", effect = "NO_SCHEDULE" }]
        tags             = [local.jvb_network_tag]
        # Con node_public_ip ogni nodo del bridge ha un indirizzo pubblico
        # (NAT 1:1 di Google, non sulla scheda di rete: il bridge lo scopre
        # con STUN). Con load_balancer resta privato come gli altri.
        private         = !local.jvb_node_public_ip
        spot            = false
        gvnic           = true
        location_policy = "ANY"
        zones           = []
        accelerator     = null
      }
    },

    var.jibri_enabled ? {
      jibri = {
        machine_type     = var.jibri_pool.machine_type
        min_nodes        = 0
        max_nodes        = var.jibri_pool.max_nodes
        initial_per_zone = 0
        disk_size_gb     = var.jibri_pool.disk_size_gb
        labels           = { workload = "jitsi-jibri" }
        taints           = [{ key = "workload", value = "jitsi-jibri", effect = "NO_SCHEDULE" }]
        tags             = ["${var.name_prefix}-jibri"]
        private          = true
        spot             = false
        gvnic            = false
        location_policy  = "ANY"
        zones            = []
        accelerator      = null
      }
    } : {},

    # GKE installa da sé il driver NVIDIA (gpu_driver_version) e aggiunge ai
    # nodi il taint nvidia.com/gpu=present:NoSchedule, che i pod con una
    # richiesta di GPU tollerano in automatico. Niente GPU Operator con il
    # driver: installerebbe un secondo driver sopra quello di GKE.
    var.gpu_enabled ? {
      gpu = {
        machine_type     = var.gpu_pool.machine_type
        min_nodes        = 0
        max_nodes        = var.gpu_pool.max_nodes
        initial_per_zone = 0
        disk_size_gb     = var.gpu_pool.disk_size_gb
        labels           = { workload = "ai-gpu", accelerator = "nvidia" }
        taints           = [{ key = "workload", value = "ai-gpu", effect = "NO_SCHEDULE" }]
        tags             = ["${var.name_prefix}-gpu"]
        private          = true
        spot             = var.gpu_pool.spot
        gvnic            = true
        location_policy  = "ANY"
        zones            = var.gpu_pool.zones
        accelerator = {
          type  = var.gpu_pool.accelerator_type
          count = var.gpu_pool.accelerator_count
        }
      }
    } : {},
  )
}

resource "google_container_node_pool" "this" {
  for_each = local.pools

  name     = each.key
  cluster  = google_container_cluster.this.id
  location = var.region

  node_locations = length(each.value.zones) > 0 ? each.value.zones : null

  # Per zona, solo alla creazione: poi decide l'autoscaler.
  initial_node_count = each.value.initial_per_zone

  autoscaling {
    total_min_node_count = each.value.min_nodes
    total_max_node_count = each.value.max_nodes
    location_policy      = each.value.location_policy
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  # Un nodo nuovo prima di togliere il vecchio. Un aggiornamento svuota
  # comunque il nodo del bridge: la finestra di manutenzione del cluster va
  # messa dove non ci sono eventi.
  upgrade_settings {
    strategy        = "SURGE"
    max_surge       = 1
    max_unavailable = 0
  }

  network_config {
    enable_private_nodes = each.value.private
  }

  node_config {
    machine_type = each.value.machine_type
    image_type   = "COS_CONTAINERD"
    disk_type    = "pd-balanced"
    disk_size_gb = each.value.disk_size_gb

    service_account = google_service_account.nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]

    labels = each.value.labels
    tags   = each.value.tags
    spot   = each.value.spot

    metadata = {
      disable-legacy-endpoints = "true"
    }

    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    shielded_instance_config {
      enable_secure_boot          = true
      enable_integrity_monitoring = true
    }

    gvnic {
      enabled = each.value.gvnic
    }

    kubelet_config {
      insecure_kubelet_readonly_port_enabled = "FALSE"
    }

    dynamic "taint" {
      for_each = each.value.taints
      content {
        key    = taint.value.key
        value  = taint.value.value
        effect = taint.value.effect
      }
    }

    dynamic "guest_accelerator" {
      for_each = each.value.accelerator != null ? [each.value.accelerator] : []
      content {
        type  = guest_accelerator.value.type
        count = guest_accelerator.value.count
        gpu_driver_installation_config {
          gpu_driver_version = "LATEST"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [initial_node_count]
  }
}

# Cluster GKE Standard, regionale, VPC nativo, con Dataplane V2.
#
# Standard e non Autopilot: il bridge vuole un pool di nodi suo (etichetta e
# taint, scala a zero) e, nella topologia con un indirizzo per nodo, una porta
# dell'host UDP; il profilo completo del chart presuppone pool dedicati.

# ── Identità dei nodi ────────────────────────────────────────
#
# Un service account per i nodi al posto di quello predefinito di Compute
# Engine, che ha il ruolo Editor sul progetto. Il ruolo qui sotto basta a
# scrivere log e metriche; ai pod non arriva, perché il server dei metadati
# di GKE (GKE_METADATA) gli presenta un'altra identità.

resource "google_service_account" "nodes" {
  account_id   = "${var.name_prefix}-nodes"
  display_name = "PA Webinar - nodi GKE"

  depends_on = [google_project_service.this]
}

resource "google_project_iam_member" "nodes" {
  project = var.project_id
  role    = "roles/container.defaultNodeServiceAccount"
  member  = "serviceAccount:${google_service_account.nodes.email}"
}

# ── Cluster ──────────────────────────────────────────────────

resource "google_container_cluster" "this" {
  name     = "${var.name_prefix}-gke"
  location = var.region

  node_locations = length(var.node_locations) > 0 ? var.node_locations : null

  network         = google_compute_network.this.id
  subnetwork      = google_compute_subnetwork.nodes.id
  networking_mode = "VPC_NATIVE"

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  # Dataplane V2 applica le NetworkPolicy del chart (networkPolicy.enabled).
  # Si sceglie solo alla creazione del cluster.
  datapath_provider = "ADVANCED_DATAPATH"

  # I pool stanno in node-pools.tf. Il pool iniziale serve solo a far nascere
  # il cluster e viene tolto subito: gli si dà comunque l'identità e i
  # metadati protetti dei pool veri.
  remove_default_node_pool = true
  initial_node_count       = 1

  node_config {
    service_account = google_service_account.nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
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
  }

  release_channel {
    channel = var.release_channel
  }

  maintenance_policy {
    recurring_window {
      start_time = var.maintenance_window.start_time
      end_time   = var.maintenance_window.end_time
      recurrence = var.maintenance_window.recurrence
    }
  }

  # Nodi privati per impostazione predefinita; il pool dei bridge ne esce
  # quando jvb_exposure = node_public_ip (vedi node-pools.tf). L'API resta
  # raggiungibile dal suo indirizzo pubblico, ma solo dalle reti autorizzate.
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
  }

  master_authorized_networks_config {
    gcp_public_cidrs_access_enabled = false

    dynamic "cidr_blocks" {
      for_each = var.master_authorized_networks
      content {
        cidr_block   = cidr_blocks.value.cidr_block
        display_name = cidr_blocks.value.display_name
      }
    }
  }

  master_auth {
    client_certificate_config {
      issue_client_certificate = false
    }
  }

  # Workload Identity del cluster: la usano i componenti che parlano con le
  # API di Google a nome proprio (cert-manager per la sfida DNS-01 su Cloud
  # DNS, External Secrets Operator su Secret Manager). L'applicazione no: lo
  # storage lo raggiunge con la chiave HMAC (vedi storage.tf).
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  enable_shielded_nodes = true
  enable_legacy_abac    = false

  addons_config {
    # Serve all'Ingress di GKE (ingress_mode = "gce") e al bilanciatore misto
    # UDP/TCP del coturn.
    http_load_balancing {
      disabled = false
    }
    horizontal_pod_autoscaling {
      disabled = false
    }
    gce_persistent_disk_csi_driver_config {
      enabled = true
    }
    gcp_filestore_csi_driver_config {
      enabled = var.enable_filestore_csi
    }
  }

  # Profilo predefinito: un nodo vuoto se ne va dopo circa dieci minuti.
  # OPTIMIZE_UTILIZATION lo toglierebbe prima, ma consolida anche più
  # volentieri, e un bridge spostato fa cadere la sua conferenza.
  cluster_autoscaling {
    autoscaling_profile = "BALANCED"
  }

  # I log dei container finiscono nel bucket _Default del progetto, globale se
  # non gli si dà una posizione. Le righe dei proxy HTTP, che portano token e
  # indirizzi, ne restano fuori: logging.tf.
  logging_config {
    enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS"]
  }

  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS"]
    managed_prometheus {
      enabled = var.enable_managed_prometheus
    }
  }

  dynamic "database_encryption" {
    for_each = var.etcd_kms_key_name != null ? [var.etcd_kms_key_name] : []
    content {
      state    = "ENCRYPTED"
      key_name = database_encryption.value
    }
  }

  resource_labels = merge(
    {
      project    = "pa-webinar"
      managed_by = "opentofu"
    },
    var.labels,
  )

  deletion_protection = var.deletion_protection

  lifecycle {
    # Il pool iniziale non esiste più dopo la creazione: le sue impostazioni
    # non vanno riconciliate.
    ignore_changes = [node_config, initial_node_count]
  }

  depends_on = [google_project_iam_member.nodes]
}

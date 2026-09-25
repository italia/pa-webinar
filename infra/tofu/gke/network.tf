# API del progetto, rete VPC, subnet dei nodi e uscita verso Internet.

locals {
  project_services = concat(
    [
      "compute.googleapis.com",
      "container.googleapis.com",
      "iam.googleapis.com",
      # Il provider legge e scrive la policy IAM del progetto (il ruolo dei
      # nodi, cluster.tf) attraverso questa API: su un progetto nuovo
      # spesso non è attiva.
      "cloudresourcemanager.googleapis.com",
      "storage.googleapis.com",
      # I log e le metriche del cluster, e l'esclusione dei log dei proxy
      # (logging.tf).
      "logging.googleapis.com",
      "monitoring.googleapis.com",
    ],
    var.dns_managed_zone != "" ? ["dns.googleapis.com"] : [],
    # Il driver CSI di Filestore crea le istanze attraverso questa API.
    var.enable_filestore_csi ? ["file.googleapis.com"] : [],
  )
}

# disable_on_destroy = false: smontare questo modulo non spegne API che altro
# nel progetto potrebbe usare.
resource "google_project_service" "this" {
  for_each = var.manage_project_services ? toset(local.project_services) : toset([])

  service            = each.value
  disable_on_destroy = false
}

# ── VPC e subnet ─────────────────────────────────────────────
#
# Una VPC propria, senza le regole firewall che la rete "default" apre (SSH,
# RDP, ICMP da Internet): su questa rete entra solo ciò che GKE apre per i
# propri bilanciatori e ciò che firewall.tf apre per i media.

resource "google_compute_network" "this" {
  name                    = "${var.name_prefix}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"

  depends_on = [google_project_service.this]
}

# I log di flusso sono spenti per impostazione predefinita (enable_flow_logs):
# sui nodi dei bridge conterrebbero l'indirizzo IP di ogni partecipante, un
# dato personale che l'applicazione per scelta non registra.
#trivy:ignore:AVD-GCP-0029
#trivy:ignore:AVD-GCP-0076
resource "google_compute_subnetwork" "nodes" {
  name          = "${var.name_prefix}-nodes"
  region        = var.region
  network       = google_compute_network.this.id
  ip_cidr_range = var.nodes_cidr

  # I nodi privati raggiungono le API di Google (registri, Cloud Storage,
  # Logging) senza passare dal NAT.
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = var.pods_cidr
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = var.services_cidr
  }

  # Log di flusso spenti per impostazione predefinita (vedi enable_flow_logs).
  dynamic "log_config" {
    for_each = var.enable_flow_logs ? [1] : []
    content {
      aggregation_interval = "INTERVAL_5_SEC"
      flow_sampling        = 0.5
      metadata             = "INCLUDE_ALL_METADATA"
    }
  }
}

# ── Uscita dei nodi privati ──────────────────────────────────
#
# I nodi delle applicazioni non hanno indirizzo pubblico: prelevano le
# immagini, mandano la posta e chiamano i servizi esterni attraverso Cloud
# NAT. Con nat_ip_count > 0 l'uscita ha indirizzi fissi, da far autorizzare a
# un relay SMTP che filtra per indirizzo. I nodi dei bridge con indirizzo
# pubblico (jvb_exposure = node_public_ip) escono con il proprio.

resource "google_compute_router" "nat" {
  name    = "${var.name_prefix}-router"
  region  = var.region
  network = google_compute_network.this.id
}

resource "google_compute_address" "nat" {
  count = var.nat_ip_count

  name         = "${var.name_prefix}-nat-${count.index}"
  region       = var.region
  address_type = "EXTERNAL"

  depends_on = [google_project_service.this]
}

resource "google_compute_router_nat" "nat" {
  name   = "${var.name_prefix}-nat"
  router = google_compute_router.nat.name
  region = var.region

  nat_ip_allocate_option = var.nat_ip_count > 0 ? "MANUAL_ONLY" : "AUTO_ONLY"
  nat_ips                = google_compute_address.nat[*].self_link

  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"
  subnetwork {
    name                    = google_compute_subnetwork.nodes.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  # I pod di un nodo condividono le sue porte: il valore predefinito (64) si
  # esaurisce presto con molti prelievi di immagini in parallelo.
  min_ports_per_vm = 1024

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# Indirizzi pubblici fissi e record DNS.
#
# Gli indirizzi si prenotano qui e il chart li usa per nome o per valore
# (vedi l'output helm_values): un bilanciatore ricreato da Kubernetes riprende
# lo stesso indirizzo, e i record DNS non cambiano.

locals {
  ingress_gce = var.ingress_mode == "gce"
  jvb_via_lb  = var.jvb_exposure == "load_balancer"
  dns_managed = var.dns_managed_zone != ""
}

# Ingress di GKE: un Application Load Balancer esterno, globale, per ogni
# Ingress. Portale e conferenza sono due Ingress, quindi due indirizzi.
resource "google_compute_global_address" "portal" {
  count = local.ingress_gce ? 1 : 0

  name         = "${var.name_prefix}-portal"
  address_type = "EXTERNAL"
  ip_version   = "IPV4"

  depends_on = [google_project_service.this]
}

resource "google_compute_global_address" "conference" {
  count = local.ingress_gce ? 1 : 0

  name         = "${var.name_prefix}-conference"
  address_type = "EXTERNAL"
  ip_version   = "IPV4"

  depends_on = [google_project_service.this]
}

# Politica TLS dei due bilanciatori: solo TLS 1.2 e successivi, con i
# cifrari del profilo MODERN. Senza, il bilanciatore accetta anche TLS 1.0.
# La richiama il FrontendConfig (k8s/gce-ingress.yaml.tftpl).
resource "google_compute_ssl_policy" "ingress" {
  count = local.ingress_gce ? 1 : 0

  name            = "${var.name_prefix}-tls12"
  profile         = "MODERN"
  min_tls_version = "TLS_1_2"

  depends_on = [google_project_service.this]
}

# ingress-nginx: un bilanciatore di rete regionale davanti al controller, che
# serve entrambi i nomi dallo stesso indirizzo.
resource "google_compute_address" "ingress" {
  count = local.ingress_gce ? 0 : 1

  name         = "${var.name_prefix}-ingress"
  region       = var.region
  address_type = "EXTERNAL"

  depends_on = [google_project_service.this]
}

# Il bridge dietro un bilanciatore di rete passthrough (UDP): l'indirizzo che
# il bridge annuncia (jitsi-meet.jvb.publicIPs) deve essere questo.
resource "google_compute_address" "jvb" {
  count = local.jvb_via_lb ? 1 : 0

  name         = "${var.name_prefix}-jvb"
  region       = var.region
  address_type = "EXTERNAL"

  depends_on = [google_project_service.this]
}

# Il coturn del chart: TURN su UDP 3478 e TURN su TLS su TCP 443 sullo stesso
# indirizzo.
resource "google_compute_address" "turn" {
  count = var.turn_enabled ? 1 : 0

  name         = "${var.name_prefix}-turn"
  region       = var.region
  address_type = "EXTERNAL"

  depends_on = [google_project_service.this]
}

# ── Record DNS (facoltativi) ─────────────────────────────────

locals {
  portal_ip     = local.ingress_gce ? google_compute_global_address.portal[0].address : google_compute_address.ingress[0].address
  conference_ip = local.ingress_gce ? google_compute_global_address.conference[0].address : google_compute_address.ingress[0].address
  turn_ip       = var.turn_enabled ? google_compute_address.turn[0].address : null

  dns_records = merge(
    {
      (var.portal_hostname)     = local.portal_ip
      (var.conference_hostname) = local.conference_ip
    },
    var.turn_enabled && var.turn_hostname != "" ? { (var.turn_hostname) = local.turn_ip } : {},
  )
}

data "google_dns_managed_zone" "this" {
  count = local.dns_managed ? 1 : 0

  name = var.dns_managed_zone
}

resource "google_dns_record_set" "this" {
  for_each = local.dns_managed ? local.dns_records : {}

  managed_zone = data.google_dns_managed_zone.this[0].name
  name         = "${each.key}."
  type         = "A"
  ttl          = 300
  rrdatas      = [each.value]
}

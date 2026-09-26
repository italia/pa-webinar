# Regole firewall della VPC.
#
# Le regole per i Service LoadBalancer (bridge dietro bilanciatore, coturn,
# ingress-nginx) e per i controlli di salute dell'Ingress di GKE le crea GKE
# da sé, sull'etichetta di rete dei nodi del cluster: non stanno qui. Resta
# da aprire solo ciò che arriva ai nodi senza passare da un Service: i media
# UDP del bridge quando ogni nodo ha il proprio indirizzo pubblico.
#
# In una VPC condivisa (Shared VPC) GKE può non avere il permesso di creare
# regole nel progetto host: vedi README.md.

# I partecipanti mandano i media al bridge da qualunque rete: l'origine aperta
# è voluta. La regola vale solo per i nodi con l'etichetta del pool dei bridge
# e solo per la porta UDP dei media; su quei nodi il bridge è l'unico pod
# con una porta dell'host.
#trivy:ignore:AVD-GCP-0027
#trivy:ignore:AVD-GCP-0073
resource "google_compute_firewall" "jvb_media" {
  count = local.jvb_node_public_ip ? 1 : 0

  name        = "${var.name_prefix}-jvb-media"
  network     = google_compute_network.this.id
  direction   = "INGRESS"
  priority    = 1000
  description = "Media UDP dei partecipanti verso il bridge (porta dell'host)."

  source_ranges = var.media_ingress_cidrs
  target_tags   = [local.jvb_network_tag]

  allow {
    protocol = "udp"
    ports    = [tostring(var.jvb_udp_port)]
  }
}

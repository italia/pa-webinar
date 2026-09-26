# Log del cluster in Cloud Logging.
#
# GKE manda nel bucket _Default del progetto anche i log dei container
# (logging_config in cluster.tf). Tra questi ci sono le righe di accesso dei
# due proxy HTTP nel cluster, che registrano l'indirizzo del client e l'URL
# con la query: il link del moderatore, quelli di partecipazione e il flusso
# della chat portano ?token=, l'ingresso nella conferenza ?jwt=. Quelle righe
# restano fuori da Cloud Logging, come i log del bilanciatore di GKE, spenti
# nella BackendConfig (k8s/gce-ingress.yaml.tftpl).
#
# L'esclusione vale per il sink _Default del progetto, solo per questo
# cluster. Un sink a livello di organizzazione o di cartella, comune nelle
# landing zone, riceve le righe comunque: va escluso lì.

locals {
  proxy_access_log_filter = join("\n", [
    "resource.type=\"k8s_container\"",
    "resource.labels.cluster_name=\"${google_container_cluster.this.name}\"",
    # ingress-nginx installato come in README.md; il web della conferenza per
    # nome del pod (<release>-jitsi-meet-web-...), perché nel sottochart
    # tutti i container di Jitsi si chiamano allo stesso modo.
    "(resource.labels.namespace_name=\"ingress-nginx\" OR resource.labels.pod_name:\"-jitsi-meet-web-\")",
  ])
}

resource "google_logging_project_exclusion" "proxy_access_logs" {
  count = var.exclude_proxy_access_logs ? 1 : 0

  name        = "${var.name_prefix}-proxy-access-logs"
  description = "PA Webinar: righe dei proxy HTTP del cluster, con indirizzi dei client e token nelle URL."
  filter      = local.proxy_access_log_filter

  depends_on = [google_project_service.this]
}

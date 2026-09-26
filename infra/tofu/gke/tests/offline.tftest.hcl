# Prova del modulo senza un progetto Google Cloud: il provider è simulato
# (mock_provider), quindi nessuna chiamata alle API e nessuna credenziale.
# Controlla le combinazioni delle scelte e i valori che finiscono nel chart.
#
#   tofu init -backend=false && tofu test

mock_provider "google" {
  mock_resource "google_compute_global_address" {
    defaults = {
      address = "198.51.100.20"
    }
  }
  mock_resource "google_storage_hmac_key" {
    defaults = {
      access_id = "mock-access-id"
      secret    = "mock-secret"
    }
  }
}

# Un indirizzo diverso per ogni prenotazione regionale: così un valore del
# chart collegato all'indirizzo sbagliato (quello del NAT al posto di quello
# del bridge, per esempio) fa fallire la prova.
override_resource {
  target = google_compute_address.nat
  values = { address = "203.0.113.10" }
}
override_resource {
  target = google_compute_address.jvb
  values = { address = "203.0.113.11" }
}
override_resource {
  target = google_compute_address.turn
  values = { address = "203.0.113.12" }
}
override_resource {
  target = google_compute_address.ingress
  values = { address = "203.0.113.13" }
}

variables {
  project_id          = "example-project"
  portal_hostname     = "webinar.example.com"
  conference_hostname = "meet.webinar.example.com"
  turn_hostname       = "turn.webinar.example.com"
  master_authorized_networks = [
    { cidr_block = "192.0.2.0/24", display_name = "amministratori" },
  ]
}

run "predefiniti" {
  command = apply

  assert {
    condition     = toset(keys(google_container_node_pool.this)) == toset(["apps", "jvb"])
    error_message = "Con i valori predefiniti i pool sono solo apps e jvb."
  }
  assert {
    condition     = google_container_node_pool.this["jvb"].network_config[0].enable_private_nodes
    error_message = "Con il bridge dietro il bilanciatore i nodi del bridge restano privati."
  }
  assert {
    condition     = google_container_node_pool.this["jvb"].autoscaling[0].total_min_node_count == 0
    error_message = "Il pool dei bridge deve poter scendere a zero nodi."
  }
  assert {
    condition     = length(google_compute_firewall.jvb_media) == 0
    error_message = "Con il bilanciatore le regole le crea GKE: nessuna regola sui nodi."
  }
  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].jvb.publicIPs == ["203.0.113.11"]
    error_message = "Il bridge deve annunciare l'indirizzo prenotato per lui."
  }
  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].jvb.service.loadBalancerIP == "203.0.113.11"
    error_message = "Il bilanciatore del bridge deve prendere l'indirizzo prenotato per lui."
  }
  assert {
    condition     = !contains(output.nat_ips, yamldecode(output.helm_values)["jitsi-meet"].jvb.publicIPs[0])
    error_message = "Il bridge non deve annunciare l'indirizzo di uscita del NAT."
  }
  assert {
    condition     = yamldecode(output.helm_values).app.env.JVB_MAX_REPLICAS == "1"
    error_message = "Un solo indirizzo davanti al bridge: JVB_MAX_REPLICAS deve essere 1."
  }
  assert {
    condition     = yamldecode(output.helm_values).ingress.annotations["kubernetes.io/ingress.global-static-ip-name"] == "pa-webinar-portal"
    error_message = "L'Ingress del portale deve usare l'indirizzo globale prenotato."
  }
  assert {
    condition     = !contains(keys(yamldecode(output.helm_values).ingress), "tls") && !contains(keys(yamldecode(output.helm_values)), "jitsi")
    error_message = "Con l'Ingress di GKE il certificato è la ManagedCertificate: nessun tls nei valori."
  }
  assert {
    condition     = length(regexall("sslPolicy: pa-webinar-tls12", output.gce_ingress_manifest)) == 1
    error_message = "Il FrontendConfig deve richiamare la politica TLS."
  }
  assert {
    condition     = length(regexall("logging:\n    enable: false", output.gce_ingress_manifest)) == 2
    error_message = "Le due BackendConfig devono spegnere i log del bilanciatore, che portano token e indirizzi."
  }
  assert {
    condition     = length(google_storage_bucket.this["recordings"].cors) == 1 && length(google_storage_bucket.this["files"].cors) == 0
    error_message = "Il CORS serve solo al bucket delle registrazioni."
  }
  assert {
    condition     = output.turn_ip == null && !contains(keys(yamldecode(output.helm_values)["jitsi-meet"]), "coturn") && !contains(keys(output.dns_records), "turn.webinar.example.com")
    error_message = "Il TURN è spento per impostazione predefinita, come il coturn in values-gke.yaml."
  }
  assert {
    condition     = length(google_logging_project_exclusion.proxy_access_logs) == 1 && strcontains(google_logging_project_exclusion.proxy_access_logs[0].filter, "resource.labels.cluster_name=\"pa-webinar-gke\"")
    error_message = "Le righe dei proxy HTTP di questo cluster devono restare fuori da Cloud Logging."
  }
  assert {
    condition     = contains(keys(google_project_service.this), "cloudresourcemanager.googleapis.com") && !contains(keys(google_project_service.this), "file.googleapis.com")
    error_message = "Servono l'API di Resource Manager sempre, quella di Filestore solo con il suo driver."
  }
}

run "turn_acceso" {
  command = apply

  variables {
    turn_enabled = true
  }

  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].coturn.service.annotations["networking.gke.io/load-balancer-ip-addresses"] == google_compute_address.turn[0].name
    error_message = "Il coturn deve prendere l'indirizzo prenotato per lui, per nome."
  }
  assert {
    condition     = output.turn_ip == "203.0.113.12" && output.dns_records["turn.webinar.example.com"] == "203.0.113.12"
    error_message = "Il record DNS del TURN deve puntare all'indirizzo del coturn."
  }
  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].jvb.publicIPs == ["203.0.113.11"] && output.jvb_ip != output.turn_ip
    error_message = "Il bridge annuncia il proprio indirizzo, non quello del coturn."
  }
}

run "nodi_pubblici_nginx_pool_facoltativi" {
  command = apply

  variables {
    jvb_exposure              = "node_public_ip"
    ingress_mode              = "nginx"
    jibri_enabled             = true
    gpu_enabled               = true
    enable_filestore_csi      = true
    exclude_proxy_access_logs = false
    create_hmac_key           = false
  }

  assert {
    condition     = toset(keys(google_container_node_pool.this)) == toset(["apps", "jvb", "jibri", "gpu"])
    error_message = "Con Jibri e GPU i pool sono quattro."
  }
  assert {
    condition     = google_container_node_pool.this["gpu"].node_config[0].machine_type == "g2-standard-16"
    error_message = "Il nodo GPU predefinito deve contenere le richieste del worker del chart (8 CPU, 32Gi)."
  }
  assert {
    condition     = !google_container_node_pool.this["jvb"].network_config[0].enable_private_nodes
    error_message = "Con un indirizzo per nodo i nodi del bridge devono essere pubblici."
  }
  assert {
    condition     = google_compute_firewall.jvb_media[0].target_tags == toset(["pa-webinar-jvb"])
    error_message = "La regola dei media vale solo per i nodi del bridge."
  }
  assert {
    condition     = !contains(keys(yamldecode(output.helm_values)["jitsi-meet"]), "coturn")
    error_message = "Senza TURN nessuna chiave coturn nei valori."
  }
  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].jvb.stunServers != ""
    error_message = "Con un indirizzo per nodo il bridge ha bisogno di uno STUN."
  }
  assert {
    condition     = !contains(keys(yamldecode(output.helm_values).app.env), "JVB_MAX_REPLICAS")
    error_message = "Con un indirizzo per nodo il tetto dei bridge non si impone qui."
  }
  assert {
    condition     = output.gce_ingress_manifest == null && output.ingress_nginx_ip == "203.0.113.13"
    error_message = "Con ingress-nginx: nessun oggetto dell'Ingress di GKE, l'indirizzo regionale prenotato per il controller."
  }
  assert {
    condition = (
      yamldecode(output.helm_values).ingress.tls == [{ secretName = "videocall-tls", hosts = ["webinar.example.com"] }]
      && yamldecode(output.helm_values)["jitsi-meet"].web.ingress.tls == [{ secretName = "jitsi-tls", hosts = ["meet.webinar.example.com"] }]
      && yamldecode(output.helm_values).jitsi.webIngress.tls[0].hosts == ["meet.webinar.example.com"]
    )
    error_message = "Con ingress-nginx i certificati devono portare i nomi veri, non quelli di esempio del profilo completo."
  }
  assert {
    condition     = contains(keys(google_project_service.this), "file.googleapis.com")
    error_message = "Con il driver di Filestore serve la sua API."
  }
  assert {
    condition     = length(google_logging_project_exclusion.proxy_access_logs) == 0
    error_message = "Con exclude_proxy_access_logs = false nessuna esclusione."
  }
  assert {
    condition     = output.storage_hmac_access_id == null
    error_message = "Con create_hmac_key = false la chiave non si crea."
  }
}

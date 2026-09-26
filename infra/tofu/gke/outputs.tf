# Uscite: ciò che serve per collegarsi al cluster, per i record DNS e per i
# valori del chart. Nessun segreto in chiaro: il segreto HMAC è marcato
# sensibile e si legge solo con `tofu output -raw storage_hmac_secret`.

output "cluster_name" {
  description = "Nome del cluster GKE."
  value       = google_container_cluster.this.name
}

output "cluster_location" {
  description = "Regione del cluster."
  value       = google_container_cluster.this.location
}

output "get_credentials_command" {
  description = "Comando che scrive il kubeconfig del cluster (serve il plugin gke-gcloud-auth-plugin)."
  value       = "gcloud container clusters get-credentials ${google_container_cluster.this.name} --region ${google_container_cluster.this.location} --project ${var.project_id}"
}

output "network_name" {
  description = "Rete VPC del cluster."
  value       = google_compute_network.this.name
}

output "jvb_network_tag" {
  description = "Etichetta di rete dei nodi dei bridge, su cui si appoggia la regola firewall dei media."
  value       = local.jvb_network_tag
}

output "node_pools" {
  description = "Pool creati, con l'etichetta workload che i valori del chart usano nei nodeSelector."
  value       = { for k, v in local.pools : k => v.labels.workload }
}

output "nat_ips" {
  description = "Indirizzi di uscita dei nodi privati (Cloud NAT), da far autorizzare al relay SMTP. Vuoto con nat_ip_count = 0."
  value       = google_compute_address.nat[*].address
}

output "dns_records" {
  description = "Record A da creare (o creati, con dns_managed_zone): nome → indirizzo."
  value       = local.dns_records
}

output "ingress_nginx_ip" {
  description = "Solo con ingress_mode = nginx: l'indirizzo da dare al Service di ingress-nginx (controller.service.loadBalancerIP)."
  value       = local.ingress_gce ? null : google_compute_address.ingress[0].address
}

output "jvb_ip" {
  description = "Solo con jvb_exposure = load_balancer: l'indirizzo pubblico del bridge."
  value       = local.jvb_via_lb ? google_compute_address.jvb[0].address : null
}

output "turn_ip" {
  description = "Indirizzo pubblico del coturn, se turn_enabled."
  value       = local.turn_ip
}

output "files_bucket" {
  description = "Bucket del dominio files (STORAGE_FILES_S3_BUCKET)."
  value       = google_storage_bucket.this["files"].name
}

output "recordings_bucket" {
  description = "Bucket del dominio recordings (RECORDING_S3_BUCKET)."
  value       = google_storage_bucket.this["recordings"].name
}

output "storage_service_account" {
  description = "Service account a cui appartiene la chiave HMAC."
  value       = google_service_account.storage.email
}

output "storage_hmac_access_id" {
  description = "ID della chiave HMAC: va in STORAGE_FILES_S3_ACCESS_KEY_ID e RECORDING_S3_ACCESS_KEY_ID. null con create_hmac_key = false."
  value       = var.create_hmac_key ? google_storage_hmac_key.storage[0].access_id : null
}

output "storage_hmac_secret" {
  description = "Segreto della chiave HMAC: va in STORAGE_FILES_S3_SECRET_ACCESS_KEY e RECORDING_S3_SECRET_ACCESS_KEY."
  value       = var.create_hmac_key ? google_storage_hmac_key.storage[0].secret : null
  sensitive   = true
}

# ── Valori del chart ─────────────────────────────────────────
#
# Si sovrappongono a examples/values-full.yaml e examples/values-gke.yaml,
# in un file fuori dal repository (README.md, "Install"):
#   tofu output -raw helm_values > <cartella-di-configurazione>/gke-infra.yaml
# Contengono solo nomi, indirizzi e bucket di questa infrastruttura.

locals {
  helm_values = {
    app = {
      env = merge(
        {
          NEXT_PUBLIC_APP_URL      = "https://${var.portal_hostname}"
          NEXT_PUBLIC_JITSI_DOMAIN = var.conference_hostname
          STORAGE_FILES_S3_BUCKET  = google_storage_bucket.this["files"].name
          RECORDING_S3_BUCKET      = google_storage_bucket.this["recordings"].name
        },
        # Un solo indirizzo davanti al bridge: un secondo bridge dietro lo
        # stesso indirizzo farebbe cadere i partecipanti.
        local.jvb_via_lb ? { JVB_MAX_REPLICAS = "1" } : {},
      )
    }

    # merge() salta gli argomenti null: così le parti che dipendono dalle
    # scelte non finiscono nei valori come chiavi a null, che in Helm
    # cancellerebbero i valori predefiniti del chart e del sottochart.
    #
    # Con ingress-nginx i nomi del certificato (tls) vanno riscritti insieme
    # agli host: il profilo completo e il chart portano i nomi di esempio, e
    # cert-manager chiederebbe un certificato per quelli, mentre il
    # controller servirebbe i nomi veri con il suo certificato finto. Con
    # l'Ingress di GKE il certificato è la ManagedCertificate e `tls` resta
    # vuoto, come in values-gke.yaml.
    ingress = merge(
      {
        annotations = local.ingress_gce ? {
          "kubernetes.io/ingress.global-static-ip-name" = google_compute_global_address.portal[0].name
        } : {}
        hosts = [{
          host  = var.portal_hostname
          paths = [{ path = "/", pathType = "Prefix" }]
        }]
      },
      local.ingress_gce ? null : {
        tls = [{ secretName = local.portal_tls_secret, hosts = [var.portal_hostname] }]
      },
    )

    "jitsi-meet" = merge(
      {
        publicURL = "https://${var.conference_hostname}"

        web = {
          ingress = merge(
            {
              annotations = local.ingress_gce ? {
                "kubernetes.io/ingress.global-static-ip-name" = google_compute_global_address.conference[0].name
              } : {}
              hosts = [{
                host  = var.conference_hostname
                paths = ["/"]
              }]
            },
            local.ingress_gce ? null : {
              tls = [{ secretName = local.conference_tls_secret, hosts = [var.conference_hostname] }]
            },
          )
        }
      },

      local.jvb_via_lb ? {
        jvb = {
          publicIPs = [google_compute_address.jvb[0].address]
          service = {
            loadBalancerIP = google_compute_address.jvb[0].address
          }
        }
      } : null,

      local.jvb_via_lb ? null : {
        jvb = {
          stunServers = var.jvb_stun_servers
        }
      },

      # Letto solo se accendi il coturn nei tuoi valori (vedi values-gke.yaml).
      var.turn_enabled ? {
        coturn = {
          service = {
            annotations = {
              "networking.gke.io/load-balancer-ip-addresses" = google_compute_address.turn[0].name
            }
          }
        }
      } : null,
    )
  }

  # Con ingress-nginx anche l'Ingress che rimanda la radice della conferenza
  # al portale (jitsi.webIngress, reso solo se imposti redirectUrl) prende il
  # nome vero e il suo certificato.
  helm_values_nginx = local.ingress_gce ? null : {
    jitsi = {
      webIngress = {
        hosts = [{ host = var.conference_hostname }]
        tls   = [{ secretName = local.conference_tls_secret, hosts = [var.conference_hostname] }]
      }
    }
  }

  # I Secret TLS che cert-manager crea con ingress-nginx: gli stessi nomi del
  # profilo completo e del chart.
  portal_tls_secret     = "videocall-tls"
  conference_tls_secret = "jitsi-tls"
}

output "helm_values" {
  description = "Valori del chart che dipendono da questa infrastruttura, in YAML."
  value       = yamlencode(merge(local.helm_values, local.helm_values_nginx))
}

output "gce_ingress_manifest" {
  description = "Solo con ingress_mode = gce: BackendConfig, FrontendConfig e certificati gestiti da applicare nel namespace dell'applicazione prima del chart."
  value = local.ingress_gce ? templatefile("${path.module}/k8s/gce-ingress.yaml.tftpl", {
    portal_hostname     = var.portal_hostname
    conference_hostname = var.conference_hostname
    ssl_policy_name     = google_compute_ssl_policy.ingress[0].name
  }) : null
}

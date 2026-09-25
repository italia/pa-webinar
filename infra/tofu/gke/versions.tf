# Infrastruttura di riferimento per PA Webinar su Google Kubernetes Engine.
#
# Modulo radice autonomo: rete, cluster Standard, pool di nodi, bucket di Cloud
# Storage con chiave HMAC, indirizzi pubblici fissi e, se si vuole, i record
# DNS. Non contiene nulla del chart: l'applicazione si installa poi con Helm
# (vedi README.md in questa cartella). Validato con OpenTofu 1.11 e il
# provider google 8.4.
#
# Lo stato contiene il segreto della chiave HMAC dello storage: tienilo in un
# backend remoto cifrato, mai nel repository.

terraform {
  required_version = ">= 1.8.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 8.4.0, < 9.0.0"
    }
  }

  # Backend: nessuno qui, di proposito. Esempio con un bucket dedicato allo
  # stato, creato a mano prima del primo apply e con il versioning attivo:
  #
  # backend "gcs" {
  #   bucket = "<bucket-dello-stato>"
  #   prefix = "pa-webinar/gke"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region

  default_labels = merge(
    {
      project    = "pa-webinar"
      managed_by = "opentofu"
    },
    var.labels,
  )
}

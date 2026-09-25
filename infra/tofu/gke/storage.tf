# Cloud Storage: due bucket, uno per dominio dell'applicazione, e l'identità
# con cui il portale li usa.
#
# Il portale parla con Cloud Storage solo attraverso l'API compatibile con S3
# (XML API di Google) e firma le richieste con una chiave HMAC: Workload
# Identity non è supportata dall'applicazione per lo storage, perché il suo
# client S3 si costruisce sempre con una coppia di chiavi statiche
# (app/src/lib/storage/index.ts). La chiave appartiene a un service account
# che ha accesso solo ai due bucket.

locals {
  storage_location  = var.storage_location != "" ? var.storage_location : var.region
  files_bucket      = var.files_bucket_name != "" ? var.files_bucket_name : "${var.project_id}-${var.name_prefix}-files"
  recordings_bucket = var.recordings_bucket_name != "" ? var.recordings_bucket_name : "${var.project_id}-${var.name_prefix}-recordings"
  cors_origins      = length(var.portal_origins) > 0 ? var.portal_origins : ["https://${var.portal_hostname}"]

  buckets = {
    files      = local.files_bucket
    recordings = local.recordings_bucket
  }
}

# Nessun versioning e nessuna eliminazione temporanea per impostazione
# predefinita: la conservazione la decide l'applicazione (pulizia GDPR,
# retention delle registrazioni) e una copia nascosta di ciò che ha cancellato
# contraddirebbe l'informativa. Nessun log di accesso: registrerebbe
# l'indirizzo di chi guarda una registrazione. La chiave KMS gestita dal
# cliente è facoltativa (storage_kms_key_name).
#trivy:ignore:AVD-GCP-0066
#trivy:ignore:AVD-GCP-0077
#trivy:ignore:AVD-GCP-0078
resource "google_storage_bucket" "this" {
  for_each = local.buckets

  name          = each.value
  location      = local.storage_location
  storage_class = "STANDARD"

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Un bucket con dentro registrazioni non si cancella con tofu destroy:
  # prima lo si svuota a mano, con consapevolezza.
  force_destroy = false

  soft_delete_policy {
    retention_duration_seconds = var.soft_delete_retention_seconds
  }

  dynamic "encryption" {
    for_each = var.storage_kms_key_name != null ? [var.storage_kms_key_name] : []
    content {
      default_kms_key_name = encryption.value
    }
  }

  # Le parti di un caricamento dal browser mai concluso (la pagina chiusa a
  # metà) restano nel bucket finché questa regola non le scarta.
  lifecycle_rule {
    condition {
      age = var.abort_incomplete_multipart_days
    }
    action {
      type = "AbortIncompleteMultipartUpload"
    }
  }

  # Solo il bucket delle registrazioni riceve PUT dal browser: i video
  # caricati dall'area di amministrazione vanno dritti allo storage con un URL
  # firmato. La riproduzione non ha bisogno di CORS. In Cloud Storage
  # response_header vale anche per le intestazioni ammesse nella richiesta
  # preliminare: il browser manda Content-Type, che è parte della firma. L'ETag
  # delle parti non serve esporlo: il portale le rilegge da sé.
  dynamic "cors" {
    for_each = each.key == "recordings" ? [1] : []
    content {
      origin          = local.cors_origins
      method          = ["PUT", "GET", "HEAD"]
      response_header = ["Content-Type"]
      max_age_seconds = 3600
    }
  }

  lifecycle {
    precondition {
      condition     = can(regex("^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$", each.value))
      error_message = "Nome del bucket non valido (da 3 a 63 caratteri, minuscole, cifre, punti, trattini e trattini bassi): con project_id e name_prefix lunghi il nome predefinito supera il limite, indica files_bucket_name e recordings_bucket_name."
    }
  }

  depends_on = [google_project_service.this]
}

# ── Identità del portale verso lo storage ────────────────────

resource "google_service_account" "storage" {
  account_id   = "${var.name_prefix}-storage"
  display_name = "PA Webinar - accesso S3 a Cloud Storage"

  depends_on = [google_project_service.this]
}

# objectAdmin copre oggetti e caricamenti a più parti (creazione, parti,
# elenco delle parti, chiusura, annullamento). legacyBucketReader aggiunge
# storage.buckets.get, che serve al controllo di esistenza del bucket
# (HeadBucket) fatto dal portale.
resource "google_storage_bucket_iam_member" "storage" {
  for_each = {
    for pair in setproduct(keys(local.buckets), ["roles/storage.objectAdmin", "roles/storage.legacyBucketReader"]) :
    "${pair[0]}/${pair[1]}" => { bucket = pair[0], role = pair[1] }
  }

  bucket = google_storage_bucket.this[each.value.bucket].name
  role   = each.value.role
  member = "serviceAccount:${google_service_account.storage.email}"
}

# Il segreto della chiave finisce nello stato. Con create_hmac_key = false la
# chiave si crea fuori da qui, e il segreto non passa mai da tofu:
#   gcloud storage hmac create <service-account-email>
resource "google_storage_hmac_key" "storage" {
  count = var.create_hmac_key ? 1 : 0

  service_account_email = google_service_account.storage.email
}

# Storage dell'applicazione: uno storage account con due container privati,
# uno per dominio (file e registrazioni). Le due connection string del Secret
# dell'applicazione puntano allo stesso account (vedi l'output
# storage_connection_string).
#
# Accesso con chiave condivisa: il portale firma ogni URL come SAS con la
# chiave dell'account che legge dalla connection string, e senza chiave il
# dominio resta spento. Identità gestite e workload identity non sono
# supportate dall'applicazione; un criterio che vieta la chiave condivisa
# (frequente nelle landing zone della PA) rende lo storage inutilizzabile.
#
# Accesso di rete pubblico: i browser dei partecipanti leggono le
# registrazioni e lo staff carica i video direttamente sull'account, con URL
# firmati. Nessun container è leggibile senza firma.

resource "random_string" "storage_suffix" {
  count = var.storage_account_name == null ? 1 : 0

  length  = 6
  lower   = true
  upper   = false
  numeric = true
  special = false
}

locals {
  storage_account_name = coalesce(
    var.storage_account_name,
    "${substr(replace(var.name_prefix, "/[^a-z0-9]/", ""), 0, 18)}${try(random_string.storage_suffix[0].result, "")}",
  )
}

# Rilievi dell'analisi statica accettati:
#   - accesso di rete non ristretto (AZU-0012): vedi sopra, i browser
#     raggiungono l'account con URL firmati;
#   - nessuna replica geografica (AZU-0058): ZRS tiene i dati in tre zone
#     della regione, e una replica in un'altra regione sposterebbe
#     registrazioni e dati personali fuori da essa;
#   - nessun log di Storage Analytics (AZU-0057): i log delle richieste si
#     raccolgono con le impostazioni di diagnostica di Azure Monitor, fuori
#     da questo modulo.
#trivy:ignore:AVD-AZU-0012
#trivy:ignore:AVD-AZU-0057
#trivy:ignore:AVD-AZU-0058
resource "azurerm_storage_account" "this" {
  name                     = local.storage_account_name
  resource_group_name      = local.rg_name
  location                 = var.location
  account_kind             = "StorageV2"
  account_tier             = "Standard"
  account_replication_type = var.storage_replication_type
  access_tier              = "Hot"
  tags                     = local.tags

  https_traffic_only_enabled        = true
  min_tls_version                   = "TLS1_2"
  allow_nested_items_to_be_public   = false
  shared_access_key_enabled         = true
  default_to_oauth_authentication   = false
  cross_tenant_replication_enabled  = false
  local_user_enabled                = false
  sftp_enabled                      = false
  infrastructure_encryption_enabled = var.storage_infrastructure_encryption
  public_network_access             = "Enabled"

  network_rules {
    default_action = "Allow"
    bypass         = ["AzureServices"]
  }

  blob_properties {
    # Niente versioni: una versione precedente sopravvivrebbe alla
    # cancellazione decisa dalla conservazione.
    versioning_enabled  = false
    change_feed_enabled = false

    # Caricamenti diretti dal browser: blocchi del video dall'area di
    # amministrazione e materiali dalla sala, con le intestazioni x-ms-* che
    # manda il client Azure. La riproduzione non ha bisogno di CORS.
    dynamic "cors_rule" {
      for_each = length(var.cors_allowed_origins) > 0 ? [1] : []
      content {
        allowed_origins    = var.cors_allowed_origins
        allowed_methods    = ["PUT"]
        allowed_headers    = ["content-type", "x-ms-*"]
        exposed_headers    = ["etag", "x-ms-*"]
        max_age_in_seconds = 3600
      }
    }

    dynamic "delete_retention_policy" {
      for_each = var.blob_soft_delete_days > 0 ? [1] : []
      content {
        days = var.blob_soft_delete_days
      }
    }

    dynamic "container_delete_retention_policy" {
      for_each = var.blob_soft_delete_days > 0 ? [1] : []
      content {
        days = var.blob_soft_delete_days
      }
    }
  }

  lifecycle {
    precondition {
      condition     = can(regex("^[a-z0-9]{3,24}$", local.storage_account_name))
      error_message = "Il nome dello storage account deve avere da 3 a 24 caratteri, solo lettere minuscole e cifre."
    }
  }

  depends_on = [azurerm_resource_group.this]
}

resource "azurerm_storage_container" "files" {
  name                  = var.files_container_name
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

resource "azurerm_storage_container" "recordings" {
  name                  = var.recordings_container_name
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

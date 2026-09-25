# Infrastruttura di riferimento per PA Webinar su Azure Kubernetes Service.
#
# Modulo radice autonomo: resource group, rete, cluster con i suoi pool di
# nodi, indirizzi pubblici fissi e storage account. Non contiene nulla del
# chart: l'applicazione si installa poi con Helm (vedi README.md in questa
# cartella). Validato con OpenTofu 1.11 e il provider azurerm 5.7.
#
# Lo stato contiene la chiave dello storage account: tienilo in un backend
# remoto cifrato e ad accesso ristretto, mai nel repository.

terraform {
  required_version = ">= 1.8.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 5.7.0, < 6.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6.0, < 4.0.0"
    }
  }

  # Backend: nessuno qui, di proposito. Esempio con uno storage account
  # dedicato allo stato, creato a mano prima del primo apply:
  #
  # backend "azurerm" {
  #   resource_group_name  = "<resource-group-dello-stato>"
  #   storage_account_name = "<account-dello-stato>"
  #   container_name       = "tfstate"
  #   key                  = "pa-webinar/aks.tfstate"
  #   use_azuread_auth     = true
  # }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

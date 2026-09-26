# Infrastruttura di riferimento per PA Webinar su Amazon EKS.
#
# Modulo radice autonomo: rete, cluster, pool di nodi, storage degli oggetti e
# ruoli IAM dei controller. Non contiene nulla del chart: l'applicazione si
# installa poi con Helm (vedi README.md in questa cartella).
#
# Lo stato contiene la chiave segreta dell'utente IAM dello storage e i dati
# del cluster: tienilo in un backend remoto cifrato, mai nel repository.

terraform {
  required_version = ">= 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.60"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.0"
    }
  }

  # Backend: nessuno qui, di proposito. Esempio con un bucket S3 dedicato allo
  # stato e il blocco su file (OpenTofu >= 1.10, Terraform >= 1.10):
  #
  # backend "s3" {
  #   bucket       = "<bucket-dello-stato>"
  #   key          = "pa-webinar/eks.tfstate"
  #   region       = "<regione>"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = merge(
      {
        project    = "pa-webinar"
        managed_by = "opentofu"
      },
      var.tags,
    )
  }
}

# Solo per la StorageClass predefinita (vedi storage-class.tf). Il token dura
# 15 minuti: basta per l'unica risorsa Kubernetes gestita qui.
provider "kubernetes" {
  host                   = aws_eks_cluster.this.endpoint
  cluster_ca_certificate = base64decode(aws_eks_cluster.this.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.this.token
}

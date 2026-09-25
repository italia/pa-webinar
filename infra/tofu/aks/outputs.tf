# Uscite usate dai valori Helm e dai comandi del README.

locals {
  jvb_tolerations = [{
    key      = "workload"
    operator = "Equal"
    value    = local.jvb_label.workload
    effect   = "NoSchedule"
  }]

  jibri_node_selector = var.jibri_pool.enabled ? local.jibri_label : local.jvb_label
  jibri_tolerations = [{
    key      = "workload"
    operator = "Equal"
    value    = local.jibri_node_selector.workload
    effect   = "NoSchedule"
  }]

  gpu_tolerations = concat(
    [{
      key      = "workload"
      operator = "Equal"
      value    = local.gpu_labels.workload
      effect   = "NoSchedule"
    }],
    var.gpu_pool.spot ? [{
      key      = "kubernetes.azure.com/scalesetpriority"
      operator = "Equal"
      value    = "spot"
      effect   = "NoSchedule"
    }] : [],
  )

  # Annotazioni per agganciare un Service LoadBalancer a un indirizzo
  # pubblico creato qui, fuori dal resource group dei nodi.
  pip_annotations = {
    for key, pip in {
      ingress = azurerm_public_ip.ingress.name
      jvb     = try(azurerm_public_ip.jvb[0].name, null)
      turn    = try(azurerm_public_ip.turn[0].name, null)
      } : key => {
      "service.beta.kubernetes.io/azure-pip-name"                     = pip
      "service.beta.kubernetes.io/azure-load-balancer-resource-group" = local.rg_name
    } if pip != null
  }

  # Intervallo privato, nel formato di coturn, verso cui il relay può
  # inoltrare: i pod, perché in entrambe le topologie il bridge annuncia il
  # proprio indirizzo di pod. Nessuna topologia annuncia un indirizzo di
  # nodo, quindi le subnet dei nodi restano negate come nel sottochart: ogni
  # partecipante riceve credenziali TURN, e aprirle vorrebbe dire lasciarlo
  # inoltrare UDP a qualunque nodo.
  coturn_allowed_peer_ips = [
    "${cidrhost(var.pod_cidr, 0)}-${cidrhost(var.pod_cidr, -1)}",
  ]

  # Valori del bridge per le due topologie. La scelta passa per un indice e
  # non per un'espressione condizionale perché i due oggetti hanno chiavi
  # diverse.
  jvb_values_by_exposure = {
    load_balancer = {
      # Un solo bridge dietro l'indirizzo fisso, annunciato così com'è.
      useHostPort = false
      useNodeIP   = false
      publicIPs   = [try(azurerm_public_ip.jvb[0].ip_address, "")]
      stunServers = ""
      service = {
        enabled               = true
        type                  = "LoadBalancer"
        externalTrafficPolicy = "Local"
        annotations           = lookup(local.pip_annotations, "jvb", {})
      }
    }
    node_public_ip = {
      # Un bridge per nodo sulla porta dell'host; ogni bridge scopre con STUN
      # l'indirizzo pubblico del proprio nodo. publicIPs a null toglie
      # l'indirizzo segnaposto di examples/values-aks.yaml. Il bridge continua
      # ad annunciare anche il proprio indirizzo di pod: è quello che usano i
      # bot di registrazione, Jibri e il relay di coturn dentro il cluster.
      # Senza, dovrebbero raggiungere l'indirizzo pubblico del nodo uscendo
      # dall'indirizzo in uscita del cluster, che le regole ristrette da
      # inbound_source_address_prefixes non ammettono.
      useHostPort = true
      useNodeIP   = false
      publicIPs   = null
      stunServers = var.jvb_stun_servers
      service     = { enabled = false }
    }
  }

  jitsi_meet_values = merge(
    {
      jvb = merge(local.jvb_values_by_exposure[var.jvb_exposure], {
        nodeSelector = local.jvb_label
        tolerations  = local.jvb_tolerations
      })
      jibri = {
        nodeSelector = local.jibri_node_selector
        tolerations  = local.jibri_tolerations
      }
    },
    # Senza turn_enabled coturn va spento (examples/values-aks.yaml lo
    # accende) e turnHost svuotato, altrimenti Prosody annuncerebbe ai
    # partecipanti un TURN che non risponde. Scelta per indice: i due
    # oggetti hanno chiavi diverse.
    {
      on = {
        coturn = {
          service        = { annotations = lookup(local.pip_annotations, "turn", {}) }
          allowedPeerIPs = local.coturn_allowed_peer_ips
        }
      }
      off = {
        turnHost = ""
        coturn   = { enabled = false }
      }
    }[var.turn_enabled ? "on" : "off"],
  )

  helm_values = merge(
    {
      app = {
        nodeSelector = { agentpool = var.apps_pool.name }
        env = {
          RECORDING_STORAGE_TYPE       = "azure-blob"
          AZURE_STORAGE_CONTAINER_NAME = azurerm_storage_container.files.name
          RECORDING_AZURE_CONTAINER    = azurerm_storage_container.recordings.name
          # Con un solo indirizzo i bridge devono restare uno: più bridge
          # dietro lo stesso indirizzo fanno cadere i partecipanti.
          JVB_MAX_REPLICAS = local.jvb_via_lb ? "1" : tostring(var.jvb_pool.max_count)
        }
      }
      jitsi-meet = local.jitsi_meet_values
    },
    {
      for key, value in {
        postprod = {
          worker = {
            nodeSelector = { workload = local.gpu_labels.workload }
            tolerations  = local.gpu_tolerations
          }
        }
      } : key => value if var.gpu_pool.enabled
    },
  )

  ingress_nginx_values = {
    controller = {
      service = {
        # Conserva l'indirizzo del client, che il portale usa per i limiti
        # per indirizzo e per il registro di audit.
        externalTrafficPolicy = "Local"
        annotations = merge(local.pip_annotations.ingress, {
          "service.beta.kubernetes.io/azure-load-balancer-health-probe-request-path" = "/healthz"
        })
      }
    }
  }
}

output "resource_group_name" {
  description = "Resource group di cluster, rete, indirizzi pubblici e storage."
  value       = local.rg_name
}

output "cluster_name" {
  description = "Nome del cluster AKS."
  value       = azurerm_kubernetes_cluster.this.name
}

output "cluster_id" {
  description = "ID del cluster AKS."
  value       = azurerm_kubernetes_cluster.this.id
}

output "node_resource_group" {
  description = "Resource group dei nodi, gestito da AKS."
  value       = azurerm_kubernetes_cluster.this.node_resource_group
}

output "oidc_issuer_url" {
  description = "Emittente OIDC del cluster, per le federated credential delle workload identity."
  value       = azurerm_kubernetes_cluster.this.oidc_issuer_url
}

output "get_credentials_command" {
  description = "Comando per scaricare il kubeconfig (poi kubelogin convert-kubeconfig -l azurecli)."
  value       = "az aks get-credentials --resource-group ${local.rg_name} --name ${azurerm_kubernetes_cluster.this.name}"
}

output "ingress_public_ip" {
  description = "Indirizzo pubblico dell'ingress: i record DNS del portale e della conferenza puntano qui."
  value       = azurerm_public_ip.ingress.ip_address
}

output "ingress_public_ip_fqdn" {
  description = "Nome DNS dell'indirizzo dell'ingress, se ingress_dns_label è impostato."
  value       = azurerm_public_ip.ingress.fqdn
}

output "jvb_public_ip" {
  description = "Indirizzo pubblico del bridge (topologia load_balancer): va in jitsi-meet.jvb.publicIPs. null nella topologia node_public_ip."
  value       = try(azurerm_public_ip.jvb[0].ip_address, null)
}

output "jvb_node_public_ip_prefix" {
  description = "Prefisso degli indirizzi pubblici dei nodi dei bridge (topologia node_public_ip con prefisso)."
  value       = try(azurerm_public_ip_prefix.jvb_nodes[0].ip_prefix, null)
}

output "turn_public_ip" {
  description = "Indirizzo pubblico di coturn: il record DNS di jitsi-meet.turnHost punta qui."
  value       = try(azurerm_public_ip.turn[0].ip_address, null)
}

output "storage_account_name" {
  description = "Nome dello storage account."
  value       = azurerm_storage_account.this.name
}

output "storage_blob_endpoint" {
  description = "Endpoint blob dello storage account."
  value       = azurerm_storage_account.this.primary_blob_endpoint
}

output "files_container_name" {
  description = "Container del dominio file (AZURE_STORAGE_CONTAINER_NAME)."
  value       = azurerm_storage_container.files.name
}

output "recordings_container_name" {
  description = "Container del dominio registrazioni (RECORDING_AZURE_CONTAINER)."
  value       = azurerm_storage_container.recordings.name
}

output "storage_connection_string" {
  description = "Connection string con la chiave dell'account: vale sia per AZURE_STORAGE_CONNECTION_STRING sia per RECORDING_AZURE_CONNECTION_STRING nel Secret dell'applicazione. Sensibile: non stamparla, scrivila in un file protetto (vedi README)."
  value       = azurerm_storage_account.this.primary_connection_string
  sensitive   = true
}

output "node_pools" {
  description = "Etichette e taint dei pool, come li leggono nodeSelector e tolerations del chart."
  value = {
    applications = { selector = { agentpool = var.apps_pool.name }, taint = null }
    jvb          = { selector = local.jvb_label, taint = local.jvb_taint }
    jibri        = var.jibri_pool.enabled ? { selector = local.jibri_label, taint = local.jibri_taint } : null
    gpu          = var.gpu_pool.enabled ? { selector = local.gpu_labels, taint = join(",", local.gpu_taints) } : null
  }
}

output "coturn_allowed_peer_ips" {
  description = "Valore per jitsi-meet.coturn.allowedPeerIPs: l'intervallo dei pod."
  value       = local.coturn_allowed_peer_ips
}

output "gpu_tolerations" {
  description = "Tolerations per tutto ciò che deve girare sul pool GPU: il worker della post-produzione (già nei valori Helm), il DaemonSet del device plugin NVIDIA o del GPU Operator, e il server vLLM. Con gpu_pool.spot comprende il taint spot di AKS. Vuoto senza pool GPU."
  value       = var.gpu_pool.enabled ? local.gpu_tolerations : []
}

output "helm_values" {
  description = "Frammento YAML per il chart pa-webinar con i valori che dipendono da questa infrastruttura. Va passato dopo examples/values-aks.yaml."
  value       = yamlencode(local.helm_values)
}

output "ingress_nginx_values" {
  description = "Frammento YAML per il chart di ingress-nginx: l'indirizzo pubblico fisso dell'ingress e la sonda del bilanciatore."
  value       = yamlencode(local.ingress_nginx_values)
}

output "required_inbound_rules" {
  description = "Con subnet esistenti il modulo non crea NSG: queste sono le regole in ingresso da aggiungere al NSG delle subnet. Vuoto quando il modulo crea la rete."
  value = local.byo_network ? [
    for name, rule in local.inbound_rules : {
      name     = name
      priority = rule.priority
      protocol = rule.protocol
      ports    = rule.ports
      source   = coalesce(local.inbound_source, join(",", var.inbound_source_address_prefixes))
      destinations = compact(concat(
        rule.destinations,
        rule.public_ip == null ? [] : [local.public_ip_addresses[rule.public_ip]],
      ))
    }
  ] : []
}

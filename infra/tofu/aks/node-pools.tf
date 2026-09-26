# Pool di nodi utente. Ogni pool ha un solo compito, e i pool che scendono a
# zero (bridge, Jibri, GPU) hanno un taint che tiene lontano tutto il resto:
# un pod qualsiasi posato lì impedirebbe all'autoscaler di spegnerli.
#
# Il numero di nodi lo decide il cluster autoscaler: node_count è solo il
# valore iniziale, e OpenTofu non lo riporta indietro.

# ── Applicativo ──────────────────────────────────────────────
#
# Senza taint: ci arrivano il portale, i CronJob e lo scaler dei bridge
# (app.nodeSelector), il controller e i bot della registrazione per
# partecipante, la segnalazione Jitsi (Prosody, Jicofo, web), coturn, e
# PostgreSQL e Redis se stanno nel cluster. Almeno due nodi su zone diverse
# per le due repliche del portale.

resource "azurerm_kubernetes_cluster_node_pool" "apps" {
  name                        = var.apps_pool.name
  temporary_name_for_rotation = "appstmp"
  kubernetes_cluster_id       = azurerm_kubernetes_cluster.this.id
  mode                        = "User"
  vm_size                     = var.apps_pool.vm_size
  auto_scaling_enabled        = true
  min_count                   = var.apps_pool.min_count
  max_count                   = var.apps_pool.max_count
  node_count                  = var.apps_pool.min_count
  os_type                     = "Linux"
  os_sku                      = var.os_sku
  vnet_subnet_id              = local.nodes_subnet_id
  zones                       = local.zones
  tags                        = local.tags

  upgrade_settings {
    max_surge = "33%"
  }

  lifecycle {
    ignore_changes = [node_count]
  }
}

# ── Bridge (JVB) ─────────────────────────────────────────────
#
# Contratto con il chart: etichetta workload=jitsi-jvb per
# jitsi-meet.jvb.nodeSelector, taint workload=jitsi-jvb:NoSchedule per
# jitsi-meet.jvb.tolerations, minimo zero nodi. Lo scaler dei bridge porta il
# Deployment a zero fuori dagli eventi e l'autoscaler spegne i nodi.
#
# Capacità regolare, mai spot: uno sfratto fa cadere i media di tutti i
# partecipanti su quel bridge.
#
# Con jvb_exposure = node_public_ip ogni nodo ha un indirizzo pubblico e la
# porta UDP dei media aperta: il bridge usa la porta dell'host, quindi un
# bridge per nodo, e max_count è anche il massimo di bridge (JVB_MAX_REPLICAS).

resource "azurerm_kubernetes_cluster_node_pool" "jvb" {
  name                        = "jvb"
  temporary_name_for_rotation = "jvbtmp"
  kubernetes_cluster_id       = azurerm_kubernetes_cluster.this.id
  mode                        = "User"
  vm_size                     = var.jvb_pool.vm_size
  auto_scaling_enabled        = true
  min_count                   = 0
  max_count                   = var.jvb_pool.max_count
  node_count                  = 0
  max_pods                    = var.jvb_pool.max_pods
  priority                    = "Regular"
  node_labels                 = local.jvb_label
  node_taints                 = [local.jvb_taint]
  os_type                     = "Linux"
  os_sku                      = var.os_sku
  vnet_subnet_id              = local.jvb_subnet_id
  zones                       = local.zones
  tags                        = local.tags

  node_public_ip_enabled   = !local.jvb_via_lb
  node_public_ip_prefix_id = length(azurerm_public_ip_prefix.jvb_nodes) > 0 ? azurerm_public_ip_prefix.jvb_nodes[0].id : null

  dynamic "node_network_profile" {
    for_each = local.jvb_via_lb ? [] : [1]
    content {
      allowed_host_ports {
        port_start = var.jvb_udp_port
        port_end   = var.jvb_udp_port
        protocol   = "UDP"
      }
    }
  }

  upgrade_settings {
    max_surge = "33%"
  }

  lifecycle {
    ignore_changes = [node_count]

    precondition {
      condition     = var.jvb_node_public_ip_prefix_length == null || pow(2, 32 - coalesce(var.jvb_node_public_ip_prefix_length, 32)) >= var.jvb_pool.max_count
      error_message = "Il prefisso jvb_node_public_ip_prefix_length ha meno indirizzi di jvb_pool.max_count: i nodi in più non avrebbero un indirizzo pubblico."
    }
  }
}

# ── Jibri (facoltativo) ──────────────────────────────────────
#
# Spento, Jibri sta sul pool dei bridge come nel profilo completo del chart.
# Acceso, Jibri va qui con jitsi-meet.jibri.nodeSelector workload=jitsi-jibri
# e la toleration corrispondente (l'output helm_values le contiene).

resource "azurerm_kubernetes_cluster_node_pool" "jibri" {
  count = var.jibri_pool.enabled ? 1 : 0

  name                        = "jibri"
  temporary_name_for_rotation = "jibritmp"
  kubernetes_cluster_id       = azurerm_kubernetes_cluster.this.id
  mode                        = "User"
  vm_size                     = var.jibri_pool.vm_size
  auto_scaling_enabled        = true
  min_count                   = 0
  max_count                   = var.jibri_pool.max_count
  node_count                  = 0
  priority                    = "Regular"
  node_labels                 = local.jibri_label
  node_taints                 = [local.jibri_taint]
  os_type                     = "Linux"
  os_sku                      = var.os_sku
  vnet_subnet_id              = local.nodes_subnet_id
  zones                       = local.zones
  tags                        = local.tags

  upgrade_settings {
    max_surge = "33%"
  }

  lifecycle {
    ignore_changes = [node_count]
  }
}

# ── GPU per la post-produzione AI (facoltativo) ──────────────
#
# Etichetta e taint workload=ai-gpu: sono i valori predefiniti di
# postprod.worker.nodeSelector e tolerations. Minimo zero: la coda della
# post-produzione accende il pool, lo scaler dei bridge no.
#
# gpu_driver = Install: i driver NVIDIA li installa AKS; resta da installare
# il device plugin (o il GPU Operator con i driver spenti). Con None li
# installa il GPU Operator. Serve quota GPU nella regione; ogni worker e il
# server vLLM chiedono una GPU intera.
#
# Con spot = true AKS aggiunge il taint
# kubernetes.azure.com/scalesetpriority=spot:NoSchedule, che il worker e il
# Deployment vLLM devono tollerare (l'output helm_values lo aggiunge al
# worker). Un nodo spot può essere ripreso da Azure a lavoro in corso: la
# coda riprende il job, ma il lavoro fatto si perde.

resource "azurerm_kubernetes_cluster_node_pool" "gpu" {
  count = var.gpu_pool.enabled ? 1 : 0

  name                        = "aigpu"
  temporary_name_for_rotation = "aigputmp"
  kubernetes_cluster_id       = azurerm_kubernetes_cluster.this.id
  mode                        = "User"
  vm_size                     = var.gpu_pool.vm_size
  auto_scaling_enabled        = true
  min_count                   = 0
  max_count                   = var.gpu_pool.max_count
  node_count                  = 0
  gpu_driver                  = var.gpu_pool.gpu_driver
  priority                    = var.gpu_pool.spot ? "Spot" : "Regular"
  eviction_policy             = var.gpu_pool.spot ? "Delete" : null
  spot_max_price              = var.gpu_pool.spot ? -1 : null
  node_labels                 = local.gpu_node_labels
  node_taints                 = local.gpu_taints
  os_type                     = "Linux"
  os_sku                      = var.os_sku
  vnet_subnet_id              = local.nodes_subnet_id
  zones                       = length(var.gpu_pool.zones) > 0 ? var.gpu_pool.zones : null
  tags                        = merge(local.tags, { purpose = "ai-postprod" })

  dynamic "upgrade_settings" {
    # Negli aggiornamenti dei pool spot AKS non aggiunge nodi in più: il
    # max_surge vale solo per i pool regolari.
    for_each = var.gpu_pool.spot ? [] : [1]
    content {
      max_surge = "33%"
    }
  }

  lifecycle {
    ignore_changes = [node_count]
  }
}

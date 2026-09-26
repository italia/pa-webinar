# Resource group, identità e ruoli. Cosa crea il modulo e come si usa:
# README.md in questa cartella. I nomi di etichette, taint e container
# coincidono con quelli che il chart si aspetta
# (infra/helm/pa-webinar/examples/values-aks.yaml e l'output helm_values).

data "azurerm_client_config" "current" {}

locals {
  rg_name = coalesce(var.resource_group_name, "${var.name_prefix}-rg")

  cluster_name = "${var.name_prefix}-aks"

  tags = merge(
    {
      project    = "pa-webinar"
      managed_by = "opentofu"
    },
    var.tags,
  )

  zones = length(var.zones) > 0 ? var.zones : null

  # Rete propria oppure subnet esistenti: le due subnet vanno date insieme.
  byo_network    = var.existing_nodes_subnet_id != null || var.existing_jvb_subnet_id != null
  create_network = !local.byo_network

  nodes_subnet_id = local.create_network ? azurerm_subnet.nodes[0].id : var.existing_nodes_subnet_id
  jvb_subnet_id   = local.create_network ? azurerm_subnet.jvb[0].id : var.existing_jvb_subnet_id

  jvb_via_lb = var.jvb_exposure == "load_balancer"

  # Etichette e taint: sono il contratto con i nodeSelector e le tolerations
  # del chart. Cambiarli qui senza cambiare i valori lascia i pod in Pending.
  jvb_label   = { workload = "jitsi-jvb" }
  jvb_taint   = "workload=jitsi-jvb:NoSchedule"
  jibri_label = { workload = "jitsi-jibri" }
  jibri_taint = "workload=jitsi-jibri:NoSchedule"
  gpu_labels  = { workload = "ai-gpu", accelerator = "nvidia" }
  # AKS mette da sé etichetta e taint dei nodi spot: dichiararli evita una
  # differenza perpetua fra configurazione e pool.
  gpu_node_labels = merge(
    local.gpu_labels,
    var.gpu_pool.spot ? { "kubernetes.azure.com/scalesetpriority" = "spot" } : {},
  )
  gpu_taints = concat(
    ["workload=ai-gpu:NoSchedule"],
    var.gpu_pool.spot ? ["kubernetes.azure.com/scalesetpriority=spot:NoSchedule"] : [],
  )

  cluster_admins = length(var.cluster_admin_object_ids) > 0 ? toset(var.cluster_admin_object_ids) : toset([data.azurerm_client_config.current.object_id])
}

# ── Resource group ───────────────────────────────────────────

resource "azurerm_resource_group" "this" {
  count = var.create_resource_group ? 1 : 0

  name     = local.rg_name
  location = var.location
  tags     = local.tags
}

data "azurerm_resource_group" "existing" {
  count = var.create_resource_group ? 0 : 1

  name = local.rg_name
}

locals {
  rg_id = var.create_resource_group ? azurerm_resource_group.this[0].id : data.azurerm_resource_group.existing[0].id
}

# ── Identità del piano di controllo ──────────────────────────
#
# Identità assegnata dall'utente, così i permessi sulla rete esistono prima
# che il cluster nasca: AKS li usa per agganciare le subnet e per mettere gli
# indirizzi pubblici fissi davanti ai Service LoadBalancer.

resource "azurerm_user_assigned_identity" "control_plane" {
  name                = "${local.cluster_name}-identity"
  location            = var.location
  resource_group_name = local.rg_name
  tags                = local.tags

  depends_on = [azurerm_resource_group.this]
}

# Network Contributor sul resource group che contiene rete e indirizzi
# pubblici. L'ambito è il gruppo e non il singolo indirizzo perché il
# provider cloud di AKS elenca gli indirizzi del gruppo prima di usarne uno.
# Il ruolo non dà accesso allo storage account. Se il resource group è
# condiviso con altro, il cluster può modificarne anche le risorse di rete:
# in quel caso conviene un resource group dedicato.
resource "azurerm_role_assignment" "control_plane_network" {
  scope                = local.rg_id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_user_assigned_identity.control_plane.principal_id
}

# Con subnet esistenti in un altro resource group serve lo stesso ruolo su
# ciascuna.
resource "azurerm_role_assignment" "control_plane_byo_subnets" {
  for_each = {
    for key, id in {
      nodes = var.existing_nodes_subnet_id
      jvb   = var.existing_jvb_subnet_id
    } : key => id if id != null
  }

  scope                = each.value
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_user_assigned_identity.control_plane.principal_id
}

# ── Accesso al cluster (Azure RBAC) ──────────────────────────

resource "azurerm_role_assignment" "cluster_admin" {
  for_each = local.cluster_admins

  scope                = azurerm_kubernetes_cluster.this.id
  role_definition_name = "Azure Kubernetes Service RBAC Cluster Admin"
  principal_id         = each.value
}

# Serve per scaricare il kubeconfig (az aks get-credentials).
resource "azurerm_role_assignment" "cluster_user" {
  for_each = local.cluster_admins

  scope                = azurerm_kubernetes_cluster.this.id
  role_definition_name = "Azure Kubernetes Service Cluster User Role"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "acr_pull" {
  count = var.acr_id != null ? 1 : 0

  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id
}

# ── Controlli al piano ───────────────────────────────────────
#
# Avvisi, non errori: il piano prosegue ma li mostra.

check "cors_origins" {
  assert {
    condition     = length(var.cors_allowed_origins) > 0
    error_message = "cors_allowed_origins è vuoto: lo storage rifiuterà i caricamenti diretti dal browser (video dall'area di amministrazione, materiali dalla sala). Indica l'origine del portale, per esempio https://webinar.example.com."
  }
}

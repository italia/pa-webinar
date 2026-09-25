# Il cluster AKS e il suo pool di sistema.
#
# Rilievi dell'analisi statica accettati, con i valori predefiniti:
#   - API server senza intervalli autorizzati (AZU-0041): gli indirizzi di
#     chi amministra non si conoscono in anticipo; l'accesso richiede
#     comunque Entra ID. Si restringe con api_server_authorized_ip_ranges.
#   - Container Insights spento (AZU-0040): richiede un workspace Log
#     Analytics, che si indica in log_analytics_workspace_id.
#   - Cluster non privato (AZU-0065): un API server privato richiede una
#     rete di amministrazione (VPN, bastion) fuori dal perimetro del modulo.
#   - Nessun componente Azure Policy (AZU-0066): le iniziative di base
#     rifiutano le porte dell'host, che la topologia node_public_ip usa.
#   - Dischi cifrati con chiavi della piattaforma, non con un disk
#     encryption set con chiavi proprie (AZU-0067).
#trivy:ignore:AVD-AZU-0040
#trivy:ignore:AVD-AZU-0041
#trivy:ignore:AVD-AZU-0065
#trivy:ignore:AVD-AZU-0066
#trivy:ignore:AVD-AZU-0067
resource "azurerm_kubernetes_cluster" "this" {
  name                = local.cluster_name
  location            = var.location
  resource_group_name = local.rg_name
  dns_prefix          = local.cluster_name
  kubernetes_version  = var.kubernetes_version
  sku_tier            = var.sku_tier
  tags                = local.tags

  automatic_upgrade_channel = var.automatic_upgrade_channel
  node_os_upgrade_channel   = var.node_os_upgrade_channel

  # Accesso solo con Entra ID e Azure RBAC; le identità dei carichi di lavoro
  # restano disponibili per chi le usa (per esempio cert-manager con DNS-01).
  # Lo storage dell'applicazione oggi non le usa: vedi README.md.
  local_account_disabled            = var.local_account_disabled
  role_based_access_control_enabled = true
  oidc_issuer_enabled               = true
  workload_identity_enabled         = true

  image_cleaner_enabled        = true
  image_cleaner_interval_hours = 48

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.control_plane.id]
  }

  azure_active_directory_role_based_access_control {
    azure_rbac_enabled = true
    tenant_id          = data.azurerm_client_config.current.tenant_id
  }

  # Pool di sistema. Con only_critical_addons_enabled porta il taint
  # CriticalAddonsOnly: portale, Jitsi e tutto il resto vanno sul pool
  # applicativo, che non ha taint.
  default_node_pool {
    name                         = "system"
    temporary_name_for_rotation  = "systemtmp"
    vm_size                      = var.system_pool.vm_size
    auto_scaling_enabled         = true
    min_count                    = var.system_pool.min_count
    max_count                    = var.system_pool.max_count
    node_count                   = var.system_pool.min_count
    only_critical_addons_enabled = var.system_pool.critical_addons_only
    os_sku                       = var.os_sku
    vnet_subnet_id               = local.nodes_subnet_id
    zones                        = local.zones
    tags                         = local.tags

    upgrade_settings {
      max_surge = "33%"
    }
  }

  # Nodi gestiti dai pool dichiarati qui e dal cluster autoscaler, non dal
  # provisioning automatico di AKS.
  node_provisioning_profile {
    mode = "Manual"
  }

  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    network_policy      = var.network_policy == "none" ? null : var.network_policy
    network_data_plane  = var.network_policy == "cilium" ? "cilium" : null
    load_balancer_sku   = "standard"
    outbound_type       = "loadBalancer"
    pod_cidr            = var.pod_cidr
    service_cidr        = var.service_cidr
    dns_service_ip      = var.dns_service_ip
  }

  # Profilo del cluster autoscaler, per tutto il cluster. Un nodo svuotato
  # (un bridge a fine evento) viene tolto dopo 10 minuti di inutilizzo, e
  # nessun nodo viene tolto nei 10 minuti successivi a un'aggiunta.
  auto_scaler_profile {
    scale_down_delay_after_add       = "10m"
    scale_down_delay_after_delete    = "10s"
    scale_down_delay_after_failure   = "3m"
    scale_down_unneeded              = "10m"
    scale_down_utilization_threshold = "0.5"
    scan_interval                    = "10s"
    max_graceful_termination_sec     = "600"
    skip_nodes_with_local_storage    = false
    skip_nodes_with_system_pods      = true
  }

  dynamic "maintenance_window_auto_upgrade" {
    for_each = var.maintenance_window != null && var.automatic_upgrade_channel != null ? [var.maintenance_window] : []
    content {
      frequency   = "Weekly"
      interval    = 1
      day_of_week = maintenance_window_auto_upgrade.value.day_of_week
      start_time  = maintenance_window_auto_upgrade.value.start_time
      duration    = maintenance_window_auto_upgrade.value.duration_hours
      utc_offset  = maintenance_window_auto_upgrade.value.utc_offset
    }
  }

  dynamic "maintenance_window_node_os" {
    for_each = var.maintenance_window != null && contains(["NodeImage", "SecurityPatch"], coalesce(var.node_os_upgrade_channel, "None")) ? [var.maintenance_window] : []
    content {
      frequency   = "Weekly"
      interval    = 1
      day_of_week = maintenance_window_node_os.value.day_of_week
      start_time  = maintenance_window_node_os.value.start_time
      duration    = maintenance_window_node_os.value.duration_hours
      utc_offset  = maintenance_window_node_os.value.utc_offset
    }
  }

  dynamic "api_server_access_profile" {
    for_each = length(var.api_server_authorized_ip_ranges) > 0 ? [1] : []
    content {
      authorized_ip_ranges = var.api_server_authorized_ip_ranges
    }
  }

  dynamic "oms_agent" {
    for_each = var.log_analytics_workspace_id != null ? [1] : []
    content {
      log_analytics_workspace_id      = var.log_analytics_workspace_id
      msi_auth_for_monitoring_enabled = true
    }
  }

  lifecycle {
    # Il numero di nodi lo decide il cluster autoscaler.
    ignore_changes = [default_node_pool[0].node_count]

    precondition {
      condition     = (var.existing_nodes_subnet_id == null) == (var.existing_jvb_subnet_id == null)
      error_message = "existing_nodes_subnet_id ed existing_jvb_subnet_id vanno indicati insieme, oppure nessuno dei due."
    }

    precondition {
      condition     = var.create_resource_group || var.resource_group_name != null
      error_message = "Con create_resource_group = false va indicato resource_group_name."
    }
  }

  # I permessi sulla rete devono esistere prima che AKS agganci le subnet.
  depends_on = [
    azurerm_role_assignment.control_plane_network,
    azurerm_role_assignment.control_plane_byo_subnets,
    azurerm_subnet_network_security_group_association.nodes,
    azurerm_subnet_network_security_group_association.jvb,
  ]
}

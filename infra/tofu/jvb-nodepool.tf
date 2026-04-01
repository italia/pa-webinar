# JVB Node Pool for eventi-dtd — Azure AKS Example
# This file is a REFERENCE — adapt and add to your IaC repo.
#
# This node pool hosts Jitsi Video Bridge (JVB) and Jibri (recording) pods.
# It scales to 0 nodes when no events are active, minimizing costs.
#
# Only needed for "full" deployment mode (see examples/values-full.yaml).
# For "simple" and "standard" modes, JVB runs on existing nodes.
#
# Cloud equivalents:
#   AKS:  azurerm_kubernetes_cluster_node_pool (this file)
#   GKE:  google_container_node_pool with autoscaling { min_node_count = 0 }
#   EKS:  aws_eks_node_group with scaling_config { min_size = 0 }
#   k3s:  Not applicable — use a single node or external autoscaler
#
# Key requirement: taint workload=jitsi-jvb:NoSchedule + label workload=jitsi-jvb

resource "azurerm_kubernetes_cluster_node_pool" "jvb" {
  name                  = "jvb"
  kubernetes_cluster_id = data.azurerm_kubernetes_cluster.main.id # Reference your existing cluster

  # VM size — D4s_v3 gives 4 vCPU, 16 GiB RAM.
  # Each node can run 1-2 JVB pods + 1 Jibri pod.
  vm_size = "Standard_D4s_v3"

  # Scale to zero when idle
  auto_scaling_enabled = true
  min_count            = 0
  max_count            = 4
  node_count           = 0 # Start with 0

  # Taints — only JVB/Jibri pods scheduled here
  node_taints = ["workload=jitsi-jvb:NoSchedule"]

  # Labels for nodeSelector
  node_labels = {
    "workload" = "jitsi-jvb"
  }

  # AZ spread for resilience
  zones = [1, 2, 3]

  # OS
  os_type = "Linux"
  os_sku  = "AzureLinux"

  # Network
  max_pods = 30

  # Node pool mode
  mode = "User"

  # Upgrade settings
  upgrade_settings {
    max_surge = "33%"
  }

  tags = {
    environment = "production"
    project     = "eventi-dtd"
    managed_by  = "tofu"
  }
}

# ─────────────────────────────────────────────────────────────
# Cluster autoscaler profile tuning
# ─────────────────────────────────────────────────────────────
# Add these settings to your existing azurerm_kubernetes_cluster resource
# in the iac-azure repo. They apply cluster-wide, not per node pool.
#
# auto_scaler_profile {
#   scale_down_delay_after_add       = "10m"
#   scale_down_delay_after_delete    = "10s"
#   scale_down_delay_after_failure   = "3m"
#   scale_down_unneeded              = "10m"   # How long a node must be unneeded before scale-down
#   scale_down_utilization_threshold = "0.5"
#   scan_interval                    = "10s"
#   max_graceful_termination_sec     = "600"
#   skip_nodes_with_local_storage    = false
#   skip_nodes_with_system_pods      = true
# }

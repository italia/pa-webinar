# AI GPU node pool — riferimento (NON applicare da qui).
#
# Per il tenant produttivo DTD, il pool è definito e gestito nel repo
# IaC dedicato: `iac-azure/modules/aks/main.tf` (resource
# `azurerm_kubernetes_cluster_node_pool.ai_gpu`) + valori in
# `iac-azure/environments/prod/locals.tf` (chiave `ai_gpu_*`).
#
# Default attuali (Italy North, maggio 2026):
#   vm_size   = "Standard_NC16as_T4_v3"   (1× T4 16GB, 16 vCPU, 110 GiB)
#   min_count = 0                           (scale-to-zero)
#   max_count = 2
#   taint     = workload=ai-gpu:NoSchedule
#   labels    = workload=ai-gpu, accelerator=nvidia
#
# Questo file resta come reference per chi adotta il chart in un cluster
# proprio (PA terze, on-prem k3s con tolerations equivalenti, ecc.).
# Cloud equivalents:
#   AKS:   azurerm_kubernetes_cluster_node_pool  (vedi sotto)
#   GKE:   google_container_node_pool { autoscaling { min_node_count = 0 }, accelerator_count }
#   EKS:   aws_eks_node_group + nodeadm GPU AMI / Karpenter
#   k3s:   manuale, GPU passthrough sul nodo
#
# Sovranità del dato: ogni componente AI è in-cluster (no API esterne).
# Il taint isola il pool a `postprod-worker` + (opzionale) `vLLM Service`.
# Italy North SKU disponibili (verificare prima del bump):
#   - Standard_NC4as_T4_v3 / NC8as_T4_v3 / NC16as_T4_v3 — 1× T4 16GB
#   - Standard_NC24ads_A100_v4                          — 1× A100 80GB
# H100 NON disponibili in Italy North a oggi.

resource "azurerm_kubernetes_cluster_node_pool" "ai_gpu" {
  count                 = 0 # disabilitato per default: usa `iac-azure` invece
  name                  = "aigpu"
  kubernetes_cluster_id = data.azurerm_kubernetes_cluster.main.id

  vm_size              = "Standard_NC16as_T4_v3"
  auto_scaling_enabled = true
  min_count            = 0
  max_count            = 2
  node_count           = 0

  node_taints = ["workload=ai-gpu:NoSchedule"]
  node_labels = {
    "workload"    = "ai-gpu"
    "accelerator" = "nvidia"
  }

  zones    = [1, 2, 3]
  os_type  = "Linux"
  os_sku   = "AzureLinux"
  max_pods = 30
  mode     = "User"

  upgrade_settings {
    max_surge = "33%"
  }

  tags = {
    environment = "production"
    project     = "eventi-dtd"
    managed_by  = "tofu"
    purpose     = "ai-postprod"
  }
}

# ─────────────────────────────────────────────────────────────
# Requisiti operativi (uguali sia per AKS-prod che per altri cluster)
# ─────────────────────────────────────────────────────────────
#
# 1. NVIDIA GPU Operator installato (espone nvidia.com/gpu come risorsa):
#      helm install gpu-operator nvidia/gpu-operator \
#        -n gpu-operator --create-namespace \
#        --set toolkit.enabled=true --set driver.enabled=true \
#        --set nodeSelector.workload=ai-gpu
#
# 2. PVC `ai-models` ReadOnlyMany su Azure Files Premium per la cache
#    HuggingFace (~100GiB; pre-popolata da un Job di seed con HF_TOKEN).
#    Senza PVC ogni cold-start ri-scarica WhisperX large-v3 (~3 GB) +
#    pyannote 3.1 (~500 MB) + il modello LLM (5–64 GB a seconda della VM).
#
# 3. Secret `hf-token` con HF_TOKEN che ha accettato i TOS di
#    `pyannote/speaker-diarization-3.1`. Necessario UNA VOLTA durante il
#    seed della PVC; a runtime il container ha `HF_HUB_OFFLINE=1`.
#
# 4. Deployment vLLM in-cluster + Service `eventi-dtd-vllm.<ns>` esposto
#    in OpenAI-compat. Vedi `docs/POSTPROD.md` §"Deploy on AKS Italy North".

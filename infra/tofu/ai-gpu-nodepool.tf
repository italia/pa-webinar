# Pool GPU per la post-produzione AI su AKS: la definizione sta nel modulo
# infra/tofu/aks, risorsa azurerm_kubernetes_cluster_node_pool.gpu in
# node-pools.tf, accesa con gpu_pool = { enabled = true }. Istruzioni:
# infra/tofu/aks/README.md e docs/POSTPROD.md.
#
# Il contratto del pool, uguale su ogni cloud: etichetta e taint
# workload=ai-gpu (NoSchedule), i valori predefiniti di
# postprod.worker.nodeSelector e tolerations; minimo zero nodi; una GPU
# intera per ogni worker e una per vLLM; il modello linguistico predefinito
# richiede una GPU da 80 GB.
#
# Questo file non dichiara risorse.

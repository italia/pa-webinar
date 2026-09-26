# Pool dei bridge (JVB) su AKS: la definizione sta nel modulo infra/tofu/aks,
# risorsa azurerm_kubernetes_cluster_node_pool.jvb in node-pools.tf, insieme al
# profilo del cluster autoscaler (cluster.tf) e alla rete che espone UDP 10000
# (network.tf). Istruzioni: infra/tofu/aks/README.md.
#
# Il contratto del pool, uguale su ogni cloud: etichetta workload=jitsi-jvb,
# taint workload=jitsi-jvb:NoSchedule, minimo zero nodi, capacità regolare e
# non spot, porta UDP dei media raggiungibile dai partecipanti. Dettagli in
# infra/aks/node-pools.md.
#
# Questo file non dichiara risorse.

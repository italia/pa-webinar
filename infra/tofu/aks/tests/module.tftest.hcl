# Prove del modulo con provider simulati: nessuna credenziale Azure, nessuna
# risorsa creata. Verificano che ogni combinazione di variabili si valuti, e
# che etichette, taint, regole di rete e valori Helm dicano la stessa cosa.
#
#   tofu init -backend=false && tofu test

mock_provider "azurerm" {
  mock_data "azurerm_client_config" {
    defaults = {
      tenant_id = "00000000-0000-0000-0000-000000000000"
      object_id = "11111111-1111-1111-1111-111111111111"
    }
  }

  mock_data "azurerm_resource_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-existing"
    }
  }

  # Il provider controlla la forma degli ID anche con i valori simulati.
  mock_resource "azurerm_resource_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/pa-webinar-rg"
    }
  }

  mock_resource "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/pa-webinar-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/pa-webinar-aks-identity"
      principal_id = "22222222-2222-2222-2222-222222222222"
    }
  }

  mock_resource "azurerm_virtual_network" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/pa-webinar-rg/providers/Microsoft.Network/virtualNetworks/pa-webinar-vnet"
    }
  }

  mock_resource "azurerm_subnet" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/pa-webinar-rg/providers/Microsoft.Network/virtualNetworks/pa-webinar-vnet/subnets/nodes"
    }
  }

  mock_resource "azurerm_network_security_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/pa-webinar-rg/providers/Microsoft.Network/networkSecurityGroups/pa-webinar-nodes-nsg"
    }
  }

  mock_resource "azurerm_public_ip" {
    defaults = {
      id         = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/pa-webinar-rg/providers/Microsoft.Network/publicIPAddresses/pip"
      ip_address = "203.0.113.10"
    }
  }

  mock_resource "azurerm_public_ip_prefix" {
    defaults = {
      id        = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/pa-webinar-rg/providers/Microsoft.Network/publicIPPrefixes/pa-webinar-jvb-nodes-prefix"
      ip_prefix = "203.0.113.16/30"
    }
  }

  mock_resource "azurerm_storage_account" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/pa-webinar-rg/providers/Microsoft.Storage/storageAccounts/pawebinarabc123"
    }
  }

  mock_resource "azurerm_kubernetes_cluster" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/pa-webinar-rg/providers/Microsoft.ContainerService/managedClusters/pa-webinar-aks"
    }
  }
}

mock_provider "random" {}

variables {
  subscription_id      = "00000000-0000-0000-0000-000000000000"
  cors_allowed_origins = ["https://webinar.example.com"]
}

run "load_balancer_default" {
  command = apply

  assert {
    condition     = azurerm_kubernetes_cluster_node_pool.jvb.min_count == 0 && azurerm_kubernetes_cluster_node_pool.jvb.node_public_ip_enabled == false
    error_message = "Il pool dei bridge deve partire da zero nodi e, dietro il bilanciatore, senza indirizzi pubblici."
  }

  assert {
    condition     = azurerm_kubernetes_cluster_node_pool.jvb.node_labels["workload"] == "jitsi-jvb" && azurerm_kubernetes_cluster_node_pool.jvb.node_taints[0] == "workload=jitsi-jvb:NoSchedule"
    error_message = "Etichetta e taint del pool dei bridge non coincidono con il profilo completo del chart."
  }

  assert {
    condition     = length(azurerm_network_security_rule.inbound) == 4
    error_message = "Con coturn servono quattro regole in ingresso (HTTPS, media, TURN su UDP e su TCP)."
  }

  assert {
    condition     = contains(azurerm_network_security_rule.inbound["jvb-media"].destination_address_prefixes, "203.0.113.10")
    error_message = "La regola dei media deve ammettere l'indirizzo pubblico del bridge."
  }

  assert {
    condition     = yamldecode(output.helm_values).app.env.JVB_MAX_REPLICAS == "1"
    error_message = "Dietro un solo indirizzo i bridge devono restare uno."
  }

  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].jvb.publicIPs == ["203.0.113.10"] && yamldecode(output.helm_values)["jitsi-meet"].jvb.useHostPort == false
    error_message = "Il bridge deve annunciare l'indirizzo del bilanciatore, senza porta dell'host."
  }

  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].jvb.service.annotations["service.beta.kubernetes.io/azure-pip-name"] == "pa-webinar-jvb-pip"
    error_message = "Il Service del bridge deve agganciare l'indirizzo pubblico creato dal modulo."
  }

  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].coturn.allowedPeerIPs == ["10.244.0.0-10.244.255.255"]
    error_message = "allowedPeerIPs deve coprire l'intervallo dei pod e nient'altro: le subnet dei nodi restano negate."
  }

  assert {
    condition     = toset(azurerm_network_security_rule.inbound["turn-tcp"].destination_port_ranges) == toset(["80", "443"])
    error_message = "La regola TCP di coturn apre solo 443 (TURN su TLS) e 80 (proxy ACME): il Service non pubblica TCP 3478."
  }

  assert {
    condition     = length(output.gpu_tolerations) == 0
    error_message = "Senza pool GPU non ci sono tolerations da applicare."
  }

  assert {
    condition     = yamldecode(output.helm_values).app.env.AZURE_STORAGE_CONTAINER_NAME == "files" && yamldecode(output.helm_values).app.env.RECORDING_AZURE_CONTAINER == "recordings"
    error_message = "I container nei valori Helm devono essere quelli creati."
  }

  assert {
    condition     = !contains(keys(yamldecode(output.helm_values)), "postprod")
    error_message = "Senza pool GPU i valori Helm non toccano la post-produzione."
  }

  assert {
    condition     = length(azurerm_storage_account.this.blob_properties[0].cors_rule) == 1 && azurerm_storage_account.this.allow_nested_items_to_be_public == false
    error_message = "Lo storage deve avere la regola CORS per il portale e nessun container pubblico."
  }

  assert {
    condition     = can(regex("^pawebinar[a-z0-9]+$", azurerm_storage_account.this.name)) && length(azurerm_storage_account.this.name) <= 24
    error_message = "Il nome derivato dello storage account non rispetta le regole di Azure."
  }

  assert {
    condition     = length(output.required_inbound_rules) == 0
    error_message = "Quando il modulo crea la rete, non ci sono regole da aggiungere a mano."
  }
}

run "node_public_ip_without_turn" {
  command = apply

  variables {
    jvb_exposure                     = "node_public_ip"
    jvb_node_public_ip_prefix_length = 30
    jvb_pool                         = { max_count = 4 }
    turn_enabled                     = false
  }

  assert {
    condition     = azurerm_kubernetes_cluster_node_pool.jvb.node_public_ip_enabled == true && length(azurerm_kubernetes_cluster_node_pool.jvb.node_network_profile[0].allowed_host_ports) == 1
    error_message = "Con un indirizzo per nodo il pool deve avere indirizzi pubblici e la porta dei media aperta sull'host."
  }

  assert {
    condition     = length(azurerm_public_ip.jvb) == 0 && length(azurerm_public_ip.turn) == 0 && length(azurerm_public_ip_prefix.jvb_nodes) == 1
    error_message = "Senza bilanciatore dei bridge e senza coturn non servono i loro indirizzi; serve il prefisso dei nodi."
  }

  assert {
    condition     = length(azurerm_network_security_rule.inbound) == 2
    error_message = "Senza coturn restano solo le regole di HTTPS e dei media."
  }

  assert {
    condition     = yamldecode(output.helm_values).app.env.JVB_MAX_REPLICAS == "4" && yamldecode(output.helm_values)["jitsi-meet"].jvb.useHostPort == true
    error_message = "Con un indirizzo per nodo il massimo dei bridge è il massimo del pool, sulla porta dell'host."
  }

  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].jvb.publicIPs == null
    error_message = "Con un indirizzo per nodo publicIPs va tolto, perché ogni bridge annuncia il proprio."
  }

  assert {
    condition     = !contains(keys(yamldecode(output.helm_values)["jitsi-meet"].jvb), "extraEnvs")
    error_message = "Il bridge deve continuare ad annunciare l'indirizzo di pod: lo usano i bot di registrazione, Jibri e il relay di coturn."
  }

  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].coturn.enabled == false && yamldecode(output.helm_values)["jitsi-meet"].turnHost == ""
    error_message = "Senza turn_enabled i valori Helm devono spegnere coturn e non annunciare un TURN."
  }
}

run "existing_subnets" {
  command = apply

  variables {
    existing_nodes_subnet_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet/subnets/nodes"
    existing_jvb_subnet_id   = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet/subnets/jvb"
  }

  assert {
    condition     = length(azurerm_virtual_network.this) == 0 && length(azurerm_network_security_group.this) == 0
    error_message = "Con subnet esistenti il modulo non crea rete né NSG."
  }

  assert {
    condition     = length(output.required_inbound_rules) == 4 && length(azurerm_role_assignment.control_plane_byo_subnets) == 2
    error_message = "Con subnet esistenti servono le regole da applicare a mano e il ruolo sulle due subnet."
  }

  assert {
    condition     = [for r in output.required_inbound_rules : r.name if contains(r.destinations, "10.224.16.0/24")] == ["jvb-media"]
    error_message = "Le regole da applicare a mano devono indicare come destinazione i prefissi delle subnet: la subnet dei bridge solo per i media."
  }
}

run "gpu_spot_and_jibri_pool" {
  command = apply

  variables {
    gpu_pool   = { enabled = true, spot = true }
    jibri_pool = { enabled = true }
  }

  assert {
    condition     = contains(azurerm_kubernetes_cluster_node_pool.gpu[0].node_taints, "workload=ai-gpu:NoSchedule") && contains(azurerm_kubernetes_cluster_node_pool.gpu[0].node_taints, "kubernetes.azure.com/scalesetpriority=spot:NoSchedule")
    error_message = "Il pool GPU spot deve portare il taint della post-produzione e quello spot."
  }

  assert {
    condition     = azurerm_kubernetes_cluster_node_pool.gpu[0].min_count == 0 && length(azurerm_kubernetes_cluster_node_pool.gpu[0].upgrade_settings) == 0
    error_message = "Il pool GPU parte da zero nodi e, se spot, senza impostazioni di aggiornamento."
  }

  assert {
    condition     = length(yamldecode(output.helm_values).postprod.worker.tolerations) == 2
    error_message = "Il worker deve tollerare il taint della post-produzione e quello spot."
  }

  assert {
    condition     = length(output.gpu_tolerations) == 2 && contains([for t in output.gpu_tolerations : t.key], "kubernetes.azure.com/scalesetpriority")
    error_message = "L'output per device plugin e vLLM deve comprendere il taint spot."
  }

  assert {
    condition     = yamldecode(output.helm_values)["jitsi-meet"].jibri.nodeSelector.workload == "jitsi-jibri"
    error_message = "Con il pool dedicato Jibri va sui nodi jitsi-jibri."
  }
}

run "one_existing_subnet_only" {
  command = plan

  variables {
    existing_nodes_subnet_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet/subnets/nodes"
  }

  expect_failures = [azurerm_kubernetes_cluster.this]
}

run "public_ip_prefix_too_small" {
  command = plan

  variables {
    jvb_exposure                     = "node_public_ip"
    jvb_node_public_ip_prefix_length = 31
    jvb_pool                         = { max_count = 4 }
  }

  expect_failures = [azurerm_kubernetes_cluster_node_pool.jvb]
}

# Rete: una rete virtuale con due subnet (nodi e bridge), un NSG sulle due
# subnet e gli indirizzi pubblici fissi che il chart mette davanti ai Service.
#
# Con Azure CNI Overlay solo i nodi prendono indirizzi dalla subnet; i pod
# stanno in pod_cidr. La subnet dei bridge è separata perché le regole che
# aprono UDP 10000 valgano solo per quei nodi.

resource "azurerm_virtual_network" "this" {
  count = local.create_network ? 1 : 0

  name                = "${var.name_prefix}-vnet"
  location            = var.location
  resource_group_name = local.rg_name
  address_space       = var.vnet_address_space
  tags                = local.tags

  depends_on = [azurerm_resource_group.this]
}

resource "azurerm_subnet" "nodes" {
  count = local.create_network ? 1 : 0

  name                 = "nodes"
  resource_group_name  = local.rg_name
  virtual_network_name = azurerm_virtual_network.this[0].name
  address_prefixes     = [var.nodes_subnet_prefix]
}

resource "azurerm_subnet" "jvb" {
  count = local.create_network ? 1 : 0

  name                 = "jvb"
  resource_group_name  = local.rg_name
  virtual_network_name = azurerm_virtual_network.this[0].name
  address_prefixes     = [var.jvb_subnet_prefix]
}

# ── Indirizzi pubblici ───────────────────────────────────────
#
# Creati qui e non da AKS: sopravvivono alla cancellazione dei Service e del
# cluster, quindi i record DNS e le eccezioni dei firewall dei partecipanti
# restano validi. Il provider cloud di AKS aggiunge i propri tag
# all'indirizzo quando lo aggancia: ignorarli evita che ogni apply li tolga.

resource "azurerm_public_ip" "ingress" {
  name                = "${var.name_prefix}-ingress-pip"
  location            = var.location
  resource_group_name = local.rg_name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = local.zones
  domain_name_label   = var.ingress_dns_label
  tags                = local.tags

  lifecycle {
    ignore_changes = [tags]
  }

  depends_on = [azurerm_resource_group.this]
}

# Topologia load_balancer: un solo bridge dietro questo indirizzo, che il
# bridge annuncia ai partecipanti (jitsi-meet.jvb.publicIPs).
resource "azurerm_public_ip" "jvb" {
  count = local.jvb_via_lb ? 1 : 0

  name                = "${var.name_prefix}-jvb-pip"
  location            = var.location
  resource_group_name = local.rg_name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = local.zones
  tags                = local.tags

  lifecycle {
    ignore_changes = [tags]
  }

  depends_on = [azurerm_resource_group.this]
}

# Topologia node_public_ip: prefisso facoltativo da cui i nodi dei bridge
# prendono l'indirizzo pubblico.
resource "azurerm_public_ip_prefix" "jvb_nodes" {
  count = !local.jvb_via_lb && var.jvb_node_public_ip_prefix_length != null ? 1 : 0

  name                = "${var.name_prefix}-jvb-nodes-prefix"
  location            = var.location
  resource_group_name = local.rg_name
  prefix_length       = var.jvb_node_public_ip_prefix_length
  sku                 = "Standard"
  zones               = local.zones
  tags                = local.tags

  lifecycle {
    ignore_changes = [tags]
  }

  depends_on = [azurerm_resource_group.this]
}

resource "azurerm_public_ip" "turn" {
  count = var.turn_enabled ? 1 : 0

  name                = "${var.name_prefix}-turn-pip"
  location            = var.location
  resource_group_name = local.rg_name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = local.zones
  tags                = local.tags

  lifecycle {
    ignore_changes = [tags]
  }

  depends_on = [azurerm_resource_group.this]
}

# ── NSG delle subnet ─────────────────────────────────────────
#
# AKS apre da sé le porte dei Service LoadBalancer nel NSG che gestisce, ma
# non tocca un NSG associato alla subnet: senza queste regole il traffico si
# ferma qui. Le regole predefinite di Azure restano (traffico interno alla
# rete virtuale e sonde del bilanciatore ammessi, il resto negato).
#
# Destinazione: l'indirizzo pubblico del Service e la subnet dei nodi che lo
# servono. Il bilanciatore di AKS usa l'IP flottante e consegna il pacchetto
# con l'indirizzo pubblico come destinazione; senza IP flottante la
# destinazione è il nodo. Tenere entrambe regge i due casi, e la subnet non
# è raggiungibile da fuori se non attraverso il bilanciatore o gli indirizzi
# pubblici dei nodi.

locals {
  inbound_source = length(var.inbound_source_address_prefixes) > 0 ? null : "Internet"

  # Le regole TURN esistono solo con turn_enabled. Il filtro del for dà lo
  # stesso tipo nei due casi; un'espressione condizionale fra un oggetto con
  # queste chiavi e uno vuoto non passerebbe il controllo dei tipi.
  inbound_rules = {
    for name, rule in {
      ingress-https = {
        priority     = 100
        protocol     = "Tcp"
        ports        = ["80", "443"]
        destinations = [var.nodes_subnet_prefix]
        public_ip    = "ingress"
        turn         = false
        description  = "Portale e conferenza: HTTPS, e HTTP per la convalida dei certificati e il reindirizzamento"
      }
      jvb-media = {
        priority     = 110
        protocol     = "Udp"
        ports        = [tostring(var.jvb_udp_port)]
        destinations = [var.jvb_subnet_prefix]
        public_ip    = local.jvb_via_lb ? "jvb" : null
        turn         = false
        description  = "Media dei partecipanti verso i bridge"
      }
      turn-udp = {
        priority     = 120
        protocol     = "Udp"
        ports        = ["3478"]
        destinations = [var.nodes_subnet_prefix]
        public_ip    = "turn"
        turn         = true
        description  = "STUN e TURN su UDP"
      }
      # Niente TCP 3478: il coturn del chart usa turn.transport udp, e il suo
      # Service pubblica solo UDP 3478, TCP 443 e, con il proxy ACME, TCP 80.
      turn-tcp = {
        priority     = 130
        protocol     = "Tcp"
        ports        = ["80", "443"]
        destinations = [var.nodes_subnet_prefix]
        public_ip    = "turn"
        turn         = true
        description  = "TURN su TLS (443) e la convalida HTTP del certificato TURN (80, solo con il proxy ACME del sottochart)"
      }
    } : name => rule if var.turn_enabled || !rule.turn
  }

  public_ip_addresses = {
    ingress = azurerm_public_ip.ingress.ip_address
    jvb     = try(azurerm_public_ip.jvb[0].ip_address, null)
    turn    = try(azurerm_public_ip.turn[0].ip_address, null)
  }
}

resource "azurerm_network_security_group" "this" {
  count = local.create_network ? 1 : 0

  name                = "${var.name_prefix}-nodes-nsg"
  location            = var.location
  resource_group_name = local.rg_name
  tags                = local.tags

  depends_on = [azurerm_resource_group.this]
}

# Il portale, i media e il TURN sono servizi pubblici per natura: la regola
# ammette Internet (o gli intervalli di inbound_source_address_prefixes) solo
# sulle porte di quei servizi.
#trivy:ignore:AVD-AZU-0047
resource "azurerm_network_security_rule" "inbound" {
  for_each = local.create_network ? local.inbound_rules : {}

  name                    = each.key
  description             = each.value.description
  priority                = each.value.priority
  direction               = "Inbound"
  access                  = "Allow"
  protocol                = each.value.protocol
  source_port_range       = "*"
  destination_port_ranges = each.value.ports
  source_address_prefix   = local.inbound_source
  source_address_prefixes = local.inbound_source == null ? var.inbound_source_address_prefixes : null
  destination_address_prefixes = compact(concat(
    each.value.destinations,
    each.value.public_ip == null ? [] : [local.public_ip_addresses[each.value.public_ip]],
  ))
  resource_group_name         = local.rg_name
  network_security_group_name = azurerm_network_security_group.this[0].name
}

resource "azurerm_subnet_network_security_group_association" "nodes" {
  count = local.create_network ? 1 : 0

  subnet_id                 = azurerm_subnet.nodes[0].id
  network_security_group_id = azurerm_network_security_group.this[0].id
}

resource "azurerm_subnet_network_security_group_association" "jvb" {
  count = local.create_network ? 1 : 0

  subnet_id                 = azurerm_subnet.jvb[0].id
  network_security_group_id = azurerm_network_security_group.this[0].id
}

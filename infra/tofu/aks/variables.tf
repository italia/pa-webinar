# ── Posizione e nomi ─────────────────────────────────────────

variable "subscription_id" {
  description = "Sottoscrizione Azure in cui creare l'infrastruttura."
  type        = string
}

variable "location" {
  description = "Regione Azure di tutte le risorse."
  type        = string
  default     = "italynorth"
}

variable "name_prefix" {
  description = "Prefisso dei nomi delle risorse: lettere minuscole, cifre e trattini."
  type        = string
  default     = "pa-webinar"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,28}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix: da 3 a 30 caratteri, lettere minuscole, cifre e trattini, inizia con una lettera."
  }
}

variable "create_resource_group" {
  description = "true = il modulo crea il resource group; false = usa quello indicato in resource_group_name, che deve esistere."
  type        = bool
  default     = true
}

variable "resource_group_name" {
  description = "Nome del resource group. Vuoto con create_resource_group = true: \"<name_prefix>-rg\"."
  type        = string
  default     = null
}

variable "zones" {
  description = "Zone di disponibilità per i pool e gli indirizzi pubblici. Lista vuota nelle regioni senza zone."
  type        = list(string)
  default     = ["1", "2", "3"]
}

variable "tags" {
  description = "Tag aggiunti a ogni risorsa."
  type        = map(string)
  default     = {}
}

# ── Cluster ──────────────────────────────────────────────────

variable "kubernetes_version" {
  description = "Versione di Kubernetes, meglio solo minore (\"1.33\"): le patch le applica il canale di aggiornamento. Vuoto = quella predefinita di AKS."
  type        = string
  default     = null
}

variable "sku_tier" {
  description = "Livello del piano di controllo: Free (nessun SLA), Standard o Premium."
  type        = string
  default     = "Standard"

  validation {
    condition     = contains(["Free", "Standard", "Premium"], var.sku_tier)
    error_message = "sku_tier: Free, Standard o Premium."
  }
}

variable "automatic_upgrade_channel" {
  description = "Canale di aggiornamento automatico di Kubernetes (patch, stable, rapid, node-image). null = nessun aggiornamento automatico."
  type        = string
  default     = "patch"
}

variable "node_os_upgrade_channel" {
  description = "Canale di aggiornamento dell'immagine dei nodi (NodeImage, SecurityPatch, Unmanaged, None)."
  type        = string
  default     = "NodeImage"
}

variable "maintenance_window" {
  description = "Finestra settimanale per gli aggiornamenti automatici di cluster e nodi. Va messa dove non ci sono eventi: un aggiornamento svuota i nodi, bridge compresi. null = nessuna finestra (AKS aggiorna quando vuole)."
  type = object({
    day_of_week    = optional(string, "Sunday")
    start_time     = optional(string, "01:00")
    duration_hours = optional(number, 4)
    utc_offset     = optional(string, "+00:00")
  })
  default = {}

  validation {
    condition     = try(var.maintenance_window.duration_hours >= 4, true)
    error_message = "maintenance_window.duration_hours: almeno 4 ore, il minimo che AKS accetta."
  }
}

variable "cluster_admin_object_ids" {
  description = "Object ID Entra (utenti, gruppi, identità) che amministrano il cluster con Azure RBAC. Vuoto = l'identità che esegue OpenTofu."
  type        = list(string)
  default     = []
}

variable "local_account_disabled" {
  description = "Disattiva l'account amministrativo locale del cluster: l'accesso passa solo da Entra ID e Azure RBAC."
  type        = bool
  default     = true
}

variable "api_server_authorized_ip_ranges" {
  description = "Intervalli CIDR da cui si raggiunge l'API server. Vuoto = nessuna restrizione di rete (l'accesso resta autenticato)."
  type        = list(string)
  default     = []
}

variable "log_analytics_workspace_id" {
  description = "ID di un workspace Log Analytics esistente per Container Insights. null = nessun agente di monitoraggio."
  type        = string
  default     = null
}

variable "acr_id" {
  description = "ID di un Azure Container Registry da cui i nodi prelevano le immagini (ruolo AcrPull all'identità kubelet). null = nessuno."
  type        = string
  default     = null
}

variable "os_sku" {
  description = "Sistema operativo dei nodi Linux (AzureLinux o Ubuntu)."
  type        = string
  default     = "AzureLinux"
}

# ── Rete ─────────────────────────────────────────────────────

variable "network_policy" {
  description = "Motore delle NetworkPolicy: calico, cilium (con il piano dati Cilium), azure, oppure none."
  type        = string
  default     = "calico"

  validation {
    condition     = contains(["calico", "cilium", "azure", "none"], var.network_policy)
    error_message = "network_policy: calico, cilium, azure o none."
  }
}

variable "vnet_address_space" {
  description = "Spazio di indirizzi della rete virtuale creata dal modulo."
  type        = list(string)
  default     = ["10.224.0.0/16"]
}

variable "nodes_subnet_prefix" {
  description = "Subnet dei nodi di sistema, applicativi, Jibri e GPU. Con subnet esistenti, il prefisso di existing_nodes_subnet_id: è la destinazione delle regole elencate in required_inbound_rules."
  type        = string
  default     = "10.224.0.0/20"
}

variable "jvb_subnet_prefix" {
  description = "Subnet dedicata ai nodi dei bridge: le regole per UDP 10000 valgono solo qui. Con subnet esistenti, il prefisso di existing_jvb_subnet_id: è la destinazione della regola dei media in required_inbound_rules."
  type        = string
  default     = "10.224.16.0/24"
}

variable "pod_cidr" {
  description = "Intervallo degli indirizzi dei pod (Azure CNI Overlay). Non deve sovrapporsi alla rete virtuale né alle reti collegate."
  type        = string
  default     = "10.244.0.0/16"
}

variable "service_cidr" {
  description = "Intervallo degli indirizzi dei Service."
  type        = string
  default     = "10.0.0.0/16"
}

variable "dns_service_ip" {
  description = "Indirizzo del DNS del cluster, dentro service_cidr."
  type        = string
  default     = "10.0.0.10"
}

variable "existing_nodes_subnet_id" {
  description = "Subnet esistente per i nodi, quando la rete la gestisce qualcun altro. Con questa e existing_jvb_subnet_id il modulo non crea rete né NSG, e l'output required_inbound_rules elenca le regole da aggiungere."
  type        = string
  default     = null
}

variable "existing_jvb_subnet_id" {
  description = "Subnet esistente per i nodi dei bridge. Va indicata insieme a existing_nodes_subnet_id."
  type        = string
  default     = null
}

variable "inbound_source_address_prefixes" {
  description = "Da dove arrivano portale, media e TURN. Vuoto = Internet. Per un'installazione raggiungibile solo da reti note, i loro CIDR. Chiude anche la porta 80 a Let's Encrypt: la convalida HTTP-01 dei certificati non passa più, e servono un emittente DNS-01 o certificati esistenti (vedi README)."
  type        = list(string)
  default     = []
}

variable "ingress_dns_label" {
  description = "Etichetta DNS facoltativa dell'indirizzo pubblico dell'ingress (<etichetta>.<regione>.cloudapp.azure.com). null = nessuna."
  type        = string
  default     = null
}

# ── Media: bridge e TURN ─────────────────────────────────────

variable "jvb_exposure" {
  description = "Come i partecipanti raggiungono i bridge su UDP: load_balancer (un solo bridge dietro un indirizzo pubblico fisso, la topologia in uso nell'installazione di riferimento) oppure node_public_ip (un indirizzo pubblico per nodo, più bridge)."
  type        = string
  default     = "load_balancer"

  validation {
    condition     = contains(["load_balancer", "node_public_ip"], var.jvb_exposure)
    error_message = "jvb_exposure: load_balancer oppure node_public_ip."
  }
}

variable "jvb_udp_port" {
  description = "Porta UDP dei media: deve coincidere con jitsi-meet.jvb.UDPPort nei valori del chart."
  type        = number
  default     = 10000
}

variable "jvb_node_public_ip_prefix_length" {
  description = "Solo con jvb_exposure = node_public_ip: crea un prefisso di indirizzi pubblici di questa lunghezza (per esempio 29) da cui i nodi dei bridge prendono l'indirizzo, così gli indirizzi sono noti in anticipo e si possono comunicare a chi filtra il traffico in uscita. null = indirizzi presi a caso da Azure."
  type        = number
  default     = null
}

variable "jvb_stun_servers" {
  description = "Solo con jvb_exposure = node_public_ip: server STUN con cui ogni bridge scopre l'indirizzo pubblico del proprio nodo. Deve stare fuori da questo cluster: il coturn del cluster risponderebbe con l'indirizzo privato. Il valore predefinito è il server di terzi del progetto Jitsi."
  type        = string
  default     = "meet-jit-si-turnrelay.jitsi.net:443"
}

variable "turn_enabled" {
  description = "Crea l'indirizzo pubblico e le regole per il coturn del chart (TURN su UDP 3478, TURN su TLS su TCP 443), per chi è dietro reti che bloccano UDP."
  type        = bool
  default     = true
}

# ── Pool di nodi ─────────────────────────────────────────────

variable "system_pool" {
  description = "Pool di sistema. Con critical_addons_only = true ospita solo i componenti di AKS e i carichi dell'applicazione vanno sul pool applicativo."
  type = object({
    vm_size              = optional(string, "Standard_D2s_v5")
    min_count            = optional(number, 1)
    max_count            = optional(number, 3)
    critical_addons_only = optional(bool, true)
  })
  default = {}
}

variable "apps_pool" {
  description = "Pool applicativo: portale, CronJob, scaler dei bridge, controller e bot di registrazione, segnalazione Jitsi, coturn, database e Redis se in cluster."
  type = object({
    name      = optional(string, "applications")
    vm_size   = optional(string, "Standard_D4s_v5")
    min_count = optional(number, 2)
    max_count = optional(number, 6)
  })
  default = {}

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{0,11}$", var.apps_pool.name))
    error_message = "apps_pool.name: fino a 12 caratteri, lettere minuscole e cifre, inizia con una lettera."
  }
}

variable "jvb_pool" {
  description = "Pool dei bridge: etichetta e taint workload=jitsi-jvb, minimo zero nodi. Con jvb_exposure = load_balancer resta un solo bridge; il secondo nodo serve a Jibri quando non entra accanto al bridge."
  type = object({
    vm_size   = optional(string, "Standard_D4s_v5")
    max_count = optional(number, 2)
    max_pods  = optional(number, 30)
  })
  default = {}

  validation {
    condition     = var.jvb_pool.max_count >= 1
    error_message = "jvb_pool.max_count: almeno 1."
  }
}

variable "jibri_pool" {
  description = "Pool facoltativo per Jibri (etichetta e taint workload=jitsi-jibri, minimo zero). Spento = Jibri sta sul pool dei bridge, come nel profilo completo del chart."
  type = object({
    enabled   = optional(bool, false)
    vm_size   = optional(string, "Standard_D4s_v5")
    max_count = optional(number, 1)
  })
  default = {}
}

variable "gpu_pool" {
  description = "Pool GPU facoltativo per la post-produzione AI (etichetta e taint workload=ai-gpu, minimo zero). Il modello linguistico predefinito richiede una GPU da 80 GB."
  type = object({
    enabled    = optional(bool, false)
    vm_size    = optional(string, "Standard_NC24ads_A100_v4")
    max_count  = optional(number, 2)
    spot       = optional(bool, false)
    zones      = optional(list(string), [])
    gpu_driver = optional(string, "Install")
  })
  default = {}

  validation {
    condition     = contains(["Install", "None"], var.gpu_pool.gpu_driver)
    error_message = "gpu_pool.gpu_driver: Install (driver installati da AKS) oppure None (li installa il GPU Operator)."
  }
}

# ── Storage ──────────────────────────────────────────────────

variable "storage_account_name" {
  description = "Nome dello storage account (3-24 caratteri, minuscole e cifre, unico in Azure). Vuoto = derivato da name_prefix con un suffisso casuale."
  type        = string
  default     = null
}

variable "storage_replication_type" {
  description = "Replica dello storage account: ZRS tiene i dati su tre zone della regione; LRS dove ZRS non c'è."
  type        = string
  default     = "ZRS"
}

variable "storage_infrastructure_encryption" {
  description = "Seconda cifratura a riposo a livello di infrastruttura. Si decide solo alla creazione dell'account."
  type        = bool
  default     = true
}

variable "files_container_name" {
  description = "Container del dominio file (materiali, immagini, allegati): AZURE_STORAGE_CONTAINER_NAME."
  type        = string
  default     = "files"
}

variable "recordings_container_name" {
  description = "Container del dominio registrazioni (registrazioni, tracce, prodotti della post-produzione): RECORDING_AZURE_CONTAINER."
  type        = string
  default     = "recordings"
}

variable "cors_allowed_origins" {
  description = "Origini del portale ammesse a caricare direttamente nello storage (per esempio https://webinar.example.com). Senza, il caricamento dei video dall'area di amministrazione e dei materiali dalla sala fallisce nel browser."
  type        = list(string)
  default     = []
}

variable "blob_soft_delete_days" {
  description = "Giorni in cui un oggetto cancellato resta recuperabile. Allunga di altrettanto la conservazione effettiva di registrazioni e materiali: va detto nell'informativa. 0 = nessuna eliminazione temporanea."
  type        = number
  default     = 7

  validation {
    condition     = var.blob_soft_delete_days == 0 || (var.blob_soft_delete_days >= 1 && var.blob_soft_delete_days <= 365)
    error_message = "blob_soft_delete_days: 0 oppure da 1 a 365."
  }
}

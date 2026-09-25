# ── Progetto, posizione e nomi ───────────────────────────────

variable "project_id" {
  description = "ID del progetto Google Cloud che ospita tutto."
  type        = string
}

variable "region" {
  description = "Regione di cluster, bucket e indirizzi. Il valore predefinito è Milano; Torino è europe-west12."
  type        = string
  default     = "europe-west8"
}

variable "node_locations" {
  description = "Zone della regione su cui stanno i nodi. Lista vuota = tutte le zone che GKE sceglie nella regione (di solito tre)."
  type        = list(string)
  default     = []
}

variable "name_prefix" {
  description = "Prefisso dei nomi delle risorse: lettere minuscole, cifre e trattini."
  type        = string
  default     = "pa-webinar"

  validation {
    # Il service account più lungo è "<prefisso>-storage": GCP ne accetta al
    # massimo 30 caratteri.
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix: da 3 a 22 caratteri, lettere minuscole, cifre e trattini, inizia con una lettera."
  }
}

variable "labels" {
  description = "Etichette aggiunte a ogni risorsa che le accetta."
  type        = map(string)
  default     = {}
}

variable "manage_project_services" {
  description = "Abilita da qui le API che servono: Compute, GKE, IAM, Cloud Resource Manager (per il ruolo dei nodi), Cloud Storage, Logging e Monitoring, più Cloud DNS con dns_managed_zone e Filestore con enable_filestore_csi. false = le abiliti tu."
  type        = bool
  default     = true
}

# ── Cluster ──────────────────────────────────────────────────

variable "release_channel" {
  description = "Canale di rilascio di GKE: RAPID, REGULAR o STABLE. Il bilanciatore misto UDP/TCP del coturn chiede una versione recente: vedi README.md."
  type        = string
  default     = "REGULAR"

  validation {
    condition     = contains(["RAPID", "REGULAR", "STABLE"], var.release_channel)
    error_message = "release_channel: RAPID, REGULAR o STABLE."
  }
}

variable "deletion_protection" {
  description = "Impedisce a tofu destroy di cancellare il cluster. Si mette a false solo per smontare un ambiente di prova."
  type        = bool
  default     = true
}

variable "master_authorized_networks" {
  description = "Reti da cui si raggiunge l'API del cluster (le postazioni degli amministratori, la CI che fa il deploy). Nessun valore predefinito: una lista vuota chiude l'API a tutto ciò che sta fuori dalla VPC."
  type = list(object({
    cidr_block   = string
    display_name = string
  }))
}

variable "maintenance_window" {
  description = "Finestra in cui GKE aggiorna piano di controllo e nodi, in UTC. Un aggiornamento dei nodi durante un evento ferma il bridge e fa cadere la chiamata: mettila dove non ci sono eventi. GKE chiede almeno 48 ore disponibili ogni 32 giorni."
  type = object({
    start_time = string
    end_time   = string
    recurrence = string
  })
  default = {
    start_time = "2026-01-01T01:00:00Z"
    end_time   = "2026-01-01T05:00:00Z"
    recurrence = "FREQ=DAILY"
  }
}

variable "enable_managed_prometheus" {
  description = "Raccolta gestita di Google Cloud Managed Service for Prometheus. Il chart rende ServiceMonitor, non PodMonitoring: vedi README.md."
  type        = bool
  default     = false
}

variable "enable_filestore_csi" {
  description = "Driver CSI di Filestore, per un volume ReadWriteMany (per esempio la cache dei modelli della post-produzione AI)."
  type        = bool
  default     = false
}

variable "etcd_kms_key_name" {
  description = "Chiave Cloud KMS con cui cifrare i Secret di Kubernetes a livello applicativo (projects/<p>/locations/<r>/keyRings/<k>/cryptoKeys/<c>). null = cifratura predefinita di Google."
  type        = string
  default     = null
}

# ── Rete ─────────────────────────────────────────────────────

variable "nodes_cidr" {
  description = "Intervallo primario della subnet dei nodi."
  type        = string
  default     = "10.10.0.0/20"
}

variable "pods_cidr" {
  description = "Intervallo secondario dei pod (VPC nativo)."
  type        = string
  default     = "10.20.0.0/16"
}

variable "services_cidr" {
  description = "Intervallo secondario dei Service."
  type        = string
  default     = "10.30.0.0/20"
}

variable "nat_ip_count" {
  description = "Indirizzi pubblici fissi per l'uscita dei nodi privati (Cloud NAT): sono quelli da far autorizzare a un relay SMTP o a un servizio che filtra per indirizzo. 0 = indirizzi scelti da Google, che possono cambiare."
  type        = number
  default     = 1
}

variable "exclude_proxy_access_logs" {
  description = "Tiene fuori da Cloud Logging le righe dei due proxy HTTP nel cluster, ingress-nginx (nel namespace ingress-nginx) e il web della conferenza: registrano l'indirizzo del client e l'URL con i token di accesso (?token=, ?jwt=). Esclude tutte le loro righe, errori compresi; kubectl logs continua a mostrarle. false = le righe restano nel bucket _Default."
  type        = bool
  default     = true
}

variable "enable_flow_logs" {
  description = "Log di flusso della subnet. Spenti di proposito: sui nodi dei bridge registrano l'indirizzo IP di ogni partecipante, che è un dato personale. Accendili solo con una conservazione dichiarata nell'informativa."
  type        = bool
  default     = false
}

# ── Ingresso HTTP ────────────────────────────────────────────

variable "ingress_mode" {
  description = <<-EOT
    Chi serve portale e conferenza su HTTPS:
      "gce"   — l'Ingress di GKE (Application Load Balancer esterno), con
                certificati gestiti da Google. Qui si prenotano due indirizzi
                globali, uno per nome.
      "nginx" — un controller ingress-nginx installato da te nel cluster,
                dietro un bilanciatore di rete. Qui si prenota un indirizzo
                regionale da dare al suo Service.
  EOT
  type        = string
  default     = "gce"

  validation {
    condition     = contains(["gce", "nginx"], var.ingress_mode)
    error_message = "ingress_mode: \"gce\" o \"nginx\"."
  }
}

variable "portal_hostname" {
  description = "Nome DNS del portale, per esempio webinar.example.com."
  type        = string
}

variable "conference_hostname" {
  description = "Nome DNS della conferenza (Jitsi), per esempio meet.webinar.example.com."
  type        = string
}

variable "turn_hostname" {
  description = "Nome DNS del coturn, per esempio turn.webinar.example.com. Vuoto = nessun record DNS per il TURN."
  type        = string
  default     = ""
}

variable "dns_managed_zone" {
  description = "Nome di una zona Cloud DNS dello stesso progetto in cui creare i record A dei nomi qui sopra. Vuoto = i record li crei tu (vedi l'output dns_records)."
  type        = string
  default     = ""
}

# ── Media: bridge e TURN ─────────────────────────────────────

variable "jvb_exposure" {
  description = "Come i partecipanti raggiungono i bridge su UDP: load_balancer (un solo bridge dietro un indirizzo pubblico fisso; i nodi restano privati) oppure node_public_ip (un indirizzo pubblico per nodo del bridge, più bridge; non ancora verificato)."
  type        = string
  default     = "load_balancer"

  validation {
    condition     = contains(["load_balancer", "node_public_ip"], var.jvb_exposure)
    error_message = "jvb_exposure: load_balancer oppure node_public_ip."
  }
}

variable "jvb_udp_port" {
  description = "Porta UDP dei media: deve coincidere con jitsi-meet.jvb.UDPPort nei valori del chart. Deve stare fuori dall'intervallo dei NodePort (30000-32767): con GKE Dataplane V2 una porta dell'host in quell'intervallo può non ricevere traffico."
  type        = number
  default     = 10000

  validation {
    condition     = var.jvb_udp_port >= 1024 && (var.jvb_udp_port < 30000 || var.jvb_udp_port > 32767)
    error_message = "jvb_udp_port: almeno 1024 e fuori da 30000-32767."
  }
}

variable "jvb_stun_servers" {
  description = "Solo con jvb_exposure = node_public_ip: server STUN con cui ogni bridge scopre l'indirizzo pubblico del proprio nodo. Deve stare fuori da questo cluster: il coturn del cluster vedrebbe l'indirizzo privato e risponderebbe con quello. Il valore predefinito è il server di terzi del progetto Jitsi."
  type        = string
  default     = "meet-jit-si-turnrelay.jitsi.net:443"
}

variable "media_ingress_cidrs" {
  description = "Da dove si accettano i media UDP sui nodi dei bridge (solo node_public_ip; con load_balancer le regole le crea GKE). I partecipanti arrivano da qualunque rete: restringi solo per un'installazione interna."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "turn_enabled" {
  description = "Prenota l'indirizzo pubblico fisso per il coturn del chart (TURN su UDP 3478, TURN su TLS su TCP 443), per chi sta dietro reti che bloccano UDP. Spento come il coturn in values-gke.yaml: si accendono insieme, perché il coturn chiede una versione recente di GKE e un certificato DNS-01 (vedi README.md)."
  type        = bool
  default     = false
}

# ── Pool di nodi ─────────────────────────────────────────────

variable "apps_pool" {
  description = "Pool delle applicazioni: portale, CronJob, scaler, controller della registrazione, segnalazione di Jitsi, coturn, database e Redis se nel cluster. Sempre acceso. min e max contano i nodi di tutte le zone."
  type = object({
    machine_type = optional(string, "e2-standard-4")
    min_nodes    = optional(number, 2)
    max_nodes    = optional(number, 4)
    disk_size_gb = optional(number, 100)
  })
  default = {}
}

variable "jvb_pool" {
  description = "Pool dei bridge: da zero nodi, un bridge per nodo. Nodi normali, mai spot: una revoca fa cadere tutti i partecipanti di quel bridge."
  type = object({
    machine_type = optional(string, "n2-standard-4")
    max_nodes    = optional(number, 4)
    disk_size_gb = optional(number, 50)
  })
  default = {}
}

variable "jibri_enabled" {
  description = "Crea un pool dedicato a Jibri (registrazione composita), da zero nodi, con etichetta e taint workload=jitsi-jibri. false = Jibri va sul pool dei bridge, come nel profilo completo del chart."
  type        = bool
  default     = false
}

variable "jibri_pool" {
  description = "Pool di Jibri, se jibri_enabled."
  type = object({
    machine_type = optional(string, "n2-standard-4")
    max_nodes    = optional(number, 2)
    disk_size_gb = optional(number, 50)
  })
  default = {}
}

variable "gpu_enabled" {
  description = "Crea il pool GPU della post-produzione AI, da zero nodi. Resta spento finché nessun lavoro lo chiede. Serve la quota GPU nella regione."
  type        = bool
  default     = false
}

variable "gpu_pool" {
  description = "Pool GPU, se gpu_enabled. Il predefinito (16 vCPU, 64 GB, una L4 da 24 GB) basta a trascrizione e diarizzazione, non al modello linguistico predefinito, che chiede circa 48 GB: per quello a2-ultragpu-1g con nvidia-a100-80gb. Il nodo deve contenere le richieste del worker del chart (postprod.worker.resources: 8 CPU e 32Gi): g2-standard-8 non basta, a meno di abbassarle. zones = zone in cui quel tipo di GPU esiste davvero (gcloud compute accelerator-types list); vuoto = quelle del cluster."
  type = object({
    machine_type      = optional(string, "g2-standard-16")
    accelerator_type  = optional(string, "nvidia-l4")
    accelerator_count = optional(number, 1)
    max_nodes         = optional(number, 1)
    disk_size_gb      = optional(number, 200)
    spot              = optional(bool, false)
    zones             = optional(list(string), [])
  })
  default = {}
}

# ── Storage degli oggetti ────────────────────────────────────

variable "files_bucket_name" {
  description = "Nome del bucket dei materiali (dominio files). Vuoto = <project_id>-<name_prefix>-files."
  type        = string
  default     = ""
}

variable "recordings_bucket_name" {
  description = "Nome del bucket di registrazioni, video caricati e risultati AI (dominio recordings). Vuoto = <project_id>-<name_prefix>-recordings."
  type        = string
  default     = ""
}

variable "storage_location" {
  description = "Posizione dei bucket. Vuoto = la stessa regione del cluster, così i dati restano lì."
  type        = string
  default     = ""
}

variable "portal_origins" {
  description = "Origini del portale ammesse dal CORS del bucket delle registrazioni per i caricamenti dal browser. Vuoto = https://<portal_hostname>."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for o in var.portal_origins : can(regex("^https://[^/*]+$", o))])
    error_message = "portal_origins: origini https://<host>, senza percorso né caratteri jolly."
  }
}

variable "abort_incomplete_multipart_days" {
  description = "Dopo quanti giorni i bucket scartano le parti di un caricamento a più parti mai concluso."
  type        = number
  default     = 7
}

variable "soft_delete_retention_seconds" {
  description = "Per quanto un oggetto cancellato resta recuperabile (eliminazione temporanea di Cloud Storage). 0 = spenta: una registrazione cancellata dalla pulizia GDPR sparisce subito, come promette l'informativa. Il valore predefinito di Google sarebbe 7 giorni."
  type        = number
  default     = 0
}

variable "storage_kms_key_name" {
  description = "Chiave Cloud KMS predefinita dei bucket. null = cifratura predefinita di Google. L'agente di servizio di Cloud Storage deve poter usare la chiave."
  type        = string
  default     = null
}

variable "create_hmac_key" {
  description = "Crea la chiave HMAC con cui il portale firma le richieste S3 verso Cloud Storage. Il segreto finisce nello stato: con false la crei tu fuori da qui (vedi README.md)."
  type        = bool
  default     = true
}

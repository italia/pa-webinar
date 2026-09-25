# ── Generali ─────────────────────────────────────────────────

variable "region" {
  description = "Regione AWS del cluster e del bucket, per esempio eu-south-1 (Milano, da abilitare nell'account) o eu-central-1."
  type        = string
}

variable "name" {
  description = "Prefisso dei nomi: cluster, VPC, ruoli, gruppi di nodi. Lettere minuscole, cifre e trattini."
  type        = string
  default     = "pa-webinar"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}[a-z0-9]$", var.name))
    error_message = "name: da 3 a 32 caratteri, lettere minuscole, cifre e trattini, inizia con una lettera."
  }
}

variable "cluster_version" {
  description = "Versione minore di Kubernetes del control plane, per esempio \"1.36\". Scegline una in supporto standard: quella in supporto esteso costa a ore."
  type        = string

  validation {
    condition     = can(regex("^1\\.[0-9]{2}$", var.cluster_version))
    error_message = "cluster_version: nella forma 1.NN, per esempio \"1.36\"."
  }
}

variable "tags" {
  description = "Tag aggiunti a ogni risorsa, oltre a project e managed_by."
  type        = map(string)
  default     = {}
}

# ── Rete ─────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "Blocco della VPC. Una /16: il VPC CNI dà a ogni pod un indirizzo della VPC, e le sottoreti private sono /19."
  type        = string
  default     = "10.40.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && tonumber(split("/", var.vpc_cidr)[1]) <= 16
    error_message = "vpc_cidr: un blocco CIDR valido, /16 o più grande."
  }
}

variable "az_count" {
  description = "Zone di disponibilità usate (2 o 3). EKS ne vuole almeno due."
  type        = number
  default     = 3

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count: 2 o 3."
  }
}

variable "one_nat_gateway_per_az" {
  description = "Un NAT gateway per zona (resiste alla perdita di una zona) invece di uno solo (costa meno). Serve all'uscita dei nodi privati: immagini, SMTP, API esterne."
  type        = bool
  default     = false
}

# ── Cluster ──────────────────────────────────────────────────

variable "cluster_endpoint_public_access" {
  description = "Endpoint dell'API di Kubernetes raggiungibile da Internet, limitato a cluster_endpoint_public_access_cidrs. Con false serve una rete che arrivi alla VPC (VPN, bastione) anche per applicare questo modulo."
  type        = bool
  default     = true
}

variable "cluster_endpoint_public_access_cidrs" {
  description = "Indirizzi da cui si raggiunge l'endpoint pubblico dell'API, per esempio l'uscita della rete dell'ente. Mai 0.0.0.0/0."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for c in var.cluster_endpoint_public_access_cidrs : can(cidrhost(c, 0)) && c != "0.0.0.0/0"])
    error_message = "cluster_endpoint_public_access_cidrs: blocchi CIDR validi, e non 0.0.0.0/0."
  }
}

variable "cluster_admin_principal_arns" {
  description = "Ruoli o utenti IAM che ricevono l'amministrazione del cluster (voci di accesso EKS). Non indicare chi applica il modulo: ha già la sua voce, e una seconda fa fallire la creazione."
  type        = list(string)
  default     = []
}

variable "cluster_log_types" {
  description = "Log del control plane inviati a CloudWatch."
  type        = list(string)
  default     = ["api", "audit", "authenticator"]
}

variable "cluster_log_retention_days" {
  description = "Conservazione dei log del control plane in CloudWatch, in giorni."
  type        = number
  default     = 90
}

variable "cluster_support_type" {
  description = "STANDARD: alla fine del supporto standard EKS aggiorna da sé il control plane, e cluster_version va poi allineata a quella del cluster perché anche i nodi la seguano (README.md, \"Kubernetes upgrades\"). EXTENDED: resta sulla versione e il cluster costa di più a ore."
  type        = string
  default     = "STANDARD"

  validation {
    condition     = contains(["STANDARD", "EXTENDED"], var.cluster_support_type)
    error_message = "cluster_support_type: STANDARD o EXTENDED."
  }
}

variable "enable_network_policy" {
  description = "Fa applicare le NetworkPolicy al VPC CNI (networkPolicy.enabled del chart). Spento, le policy vengono accettate e ignorate."
  type        = bool
  default     = true
}

variable "addon_versions" {
  description = "Versioni fissate dei componenti aggiuntivi EKS, per nome (vpc-cni, kube-proxy, coredns, eks-pod-identity-agent, aws-ebs-csi-driver, metrics-server). Assente = la versione predefinita per la versione del cluster."
  type        = map(string)
  default     = {}
}

variable "enable_metrics_server_addon" {
  description = "Installa metrics-server come componente aggiuntivo EKS. Serve all'autoscaling orizzontale del portale (autoscaling.enabled del chart)."
  type        = bool
  default     = true
}

variable "node_ssm_access" {
  description = "Aggiunge al ruolo dei nodi la policy di Systems Manager, per aprire una sessione sul nodo senza SSH."
  type        = bool
  default     = false
}

# ── Pool delle applicazioni ──────────────────────────────────

variable "app_instance_types" {
  description = "Tipi di istanza del pool delle applicazioni: portale, CronJob, Prosody, Jicofo, web, database e Redis del cluster, controller."
  type        = list(string)
  default     = ["m6i.large"]
}

variable "app_min_size" {
  description = "Nodi minimi del pool delle applicazioni. Due, per le due repliche del portale in zone diverse."
  type        = number
  default     = 2
}

variable "app_max_size" {
  description = "Nodi massimi del pool delle applicazioni."
  type        = number
  default     = 4
}

variable "app_disk_size_gb" {
  description = "Disco di sistema dei nodi delle applicazioni, in GiB."
  type        = number
  default     = 50
}

# ── Bridge (JVB) ─────────────────────────────────────────────

variable "jvb_exposure" {
  description = <<-EOT
    Come i browser raggiungono il bridge sulla porta UDP:
      "nlb"            — un solo bridge dietro un Network Load Balancer UDP con
                         un Elastic IP fisso. I nodi restano privati. Tetto: un
                         bridge (JVB_MAX_REPLICAS=1).
      "node-public-ip" — un bridge per nodo, ogni nodo in una sottorete pubblica
                         con il proprio indirizzo pubblico e la porta dell'host.
                         Più bridge, ma ognuno deve scoprire il proprio indirizzo
                         pubblico con STUN. Non ancora verificato.
  EOT
  type        = string
  default     = "nlb"

  validation {
    condition     = contains(["nlb", "node-public-ip"], var.jvb_exposure)
    error_message = "jvb_exposure: \"nlb\" o \"node-public-ip\"."
  }
}

variable "jvb_instance_types" {
  description = "Tipi di istanza del pool dei bridge. Un bridge per nodo."
  type        = list(string)
  default     = ["c6i.xlarge"]
}

variable "jvb_max_size" {
  description = "Nodi massimi del pool dei bridge. Il minimo è zero: il pool si accende solo per gli eventi."
  type        = number
  default     = 2
}

variable "jvb_az_index" {
  description = "Con jvb_exposure = \"nlb\": indice (da 0) della zona che ospita il bilanciatore del bridge, il suo Elastic IP e i nodi del bridge."
  type        = number
  default     = 0

  validation {
    condition     = var.jvb_az_index >= 0 && var.jvb_az_index <= 2 && floor(var.jvb_az_index) == var.jvb_az_index
    error_message = "jvb_az_index: 0, 1 o 2, e minore di az_count."
  }
}

variable "jvb_udp_port" {
  description = "Porta UDP dei media del bridge. Apre la porta nel gruppo di sicurezza dei bridge e arriva al chart come jitsi-meet.jvb.UDPPort (helm_values)."
  type        = number
  default     = 10000

  validation {
    condition     = var.jvb_udp_port >= 1024 && var.jvb_udp_port <= 65535 && floor(var.jvb_udp_port) == var.jvb_udp_port
    error_message = "jvb_udp_port: un numero di porta fra 1024 e 65535."
  }
}

variable "public_ingress_cidrs" {
  description = <<-EOT
    Da dove arrivano i partecipanti: portale e conferenza (TCP 80 e 443), media
    del bridge (UDP), TURN. Arrivano da qualunque rete: restringi solo per
    un'installazione interna. Dietro i Network Load Balancer filtra il gruppo
    di sicurezza che AWS Load Balancer Controller crea per ciascuno, dalle
    sorgenti del Service: per il bridge e il TURN le scrive helm_values da
    questa lista, per ingress-nginx vanno in
    controller.service.loadBalancerSourceRanges (README.md). Le regole sui
    gruppi di sicurezza dei nodi sono un secondo livello, e l'unico filtro per
    i bridge con jvb_exposure = "node-public-ip".
  EOT
  type        = list(string)
  default     = ["0.0.0.0/0"]

  validation {
    condition     = length(var.public_ingress_cidrs) > 0 && alltrue([for c in var.public_ingress_cidrs : can(cidrhost(c, 0)) && !strcontains(c, ":")])
    error_message = "public_ingress_cidrs: almeno un blocco CIDR IPv4 valido."
  }
}

variable "turn_enabled" {
  description = "Prepara la rete per il coturn del chart dietro un proprio Network Load Balancer: un secondo Elastic IP e le regole UDP 3478 e TCP 443 sui nodi delle applicazioni."
  type        = bool
  default     = false
}

# ── Pool facoltativi: Jibri e GPU ────────────────────────────

variable "jibri_enabled" {
  description = "Crea il pool di Jibri (registrazione composita), da zero nodi. Jibri vuole il modulo del kernel snd-aloop: vedi README.md."
  type        = bool
  default     = false
}

variable "jibri_instance_types" {
  description = "Tipi di istanza del pool di Jibri. Un Jibri per nodo."
  type        = list(string)
  default     = ["c6i.xlarge"]
}

variable "jibri_max_size" {
  description = "Nodi massimi del pool di Jibri."
  type        = number
  default     = 2
}

variable "gpu_enabled" {
  description = "Crea il pool GPU della post-produzione AI, da zero nodi. Resta spento finché nessun lavoro lo chiede."
  type        = bool
  default     = false
}

variable "gpu_instance_types" {
  description = "Tipi di istanza del pool GPU. Il worker chiede 8 CPU e 32 GiB: il nodo deve averne di più allocabili."
  type        = list(string)
  default     = ["g5.4xlarge"]
}

variable "gpu_accelerator_type" {
  description = "Tipo di GPU di gpu_instance_types, nell'etichetta k8s.amazonaws.com/accelerator dei nodi GPU: per esempio nvidia-a10g per g5, nvidia-l4 per g6. Cluster Autoscaler la usa per riconoscere un nodo GPU la cui GPU non è ancora allocabile."
  type        = string
  default     = "nvidia-a10g"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9.-]{0,61}[a-z0-9])?$", var.gpu_accelerator_type))
    error_message = "gpu_accelerator_type: un valore di etichetta Kubernetes (lettere minuscole, cifre, punti e trattini, al massimo 63 caratteri)."
  }
}

variable "gpu_max_size" {
  description = "Nodi massimi del pool GPU."
  type        = number
  default     = 1
}

variable "gpu_disk_size_gb" {
  description = "Disco di sistema dei nodi GPU, in GiB: le immagini del worker e dei modelli sono grandi."
  type        = number
  default     = 200
}

# ── Storage degli oggetti ────────────────────────────────────

variable "s3_bucket_name" {
  description = "Nome del bucket di materiali, registrazioni e risultati AI, al massimo 63 caratteri. Vuoto = <name>-media-<account>-<regione>, che con un name lungo può superarli: il piano allora si ferma e chiede questo valore."
  type        = string
  default     = ""
}

variable "portal_origins" {
  description = "Origini del portale ammesse dal CORS del bucket per i caricamenti dal browser, per esempio [\"https://webinar.example.com\"]."
  type        = list(string)

  validation {
    condition     = length(var.portal_origins) > 0 && alltrue([for o in var.portal_origins : can(regex("^https://[^/*]+$", o))])
    error_message = "portal_origins: almeno un'origine https://<host>, senza percorso né caratteri jolly."
  }
}

variable "s3_abort_incomplete_multipart_days" {
  description = "Dopo quanti giorni il bucket scarta le parti di un caricamento dal browser mai concluso."
  type        = number
  default     = 7
}

variable "s3_create_access_key" {
  description = "Crea la chiave d'accesso dell'utente IAM dello storage. La chiave segreta finisce nello stato: con false la crei tu fuori da qui."
  type        = bool
  default     = true
}

# ── Ruoli dei controller (EKS Pod Identity) ──────────────────

variable "create_cluster_autoscaler_role" {
  description = "Crea il ruolo IAM di Cluster Autoscaler e lo lega al suo ServiceAccount (kube-system/cluster-autoscaler)."
  type        = bool
  default     = true
}

variable "create_load_balancer_controller_role" {
  description = "Crea il ruolo IAM di AWS Load Balancer Controller e lo lega al suo ServiceAccount (kube-system/aws-load-balancer-controller)."
  type        = bool
  default     = true
}

variable "cert_manager_route53_zone_ids" {
  description = "Zone Route 53 in cui cert-manager può scrivere i record della verifica DNS-01 (serve per il nome del TURN). Vuoto = nessun ruolo."
  type        = list(string)
  default     = []
}

variable "create_default_storage_class" {
  description = "Crea la StorageClass predefinita gp3 (cifrata) per il database del cluster. Con un endpoint dell'API irraggiungibile da chi applica, metti false e applicala a mano (README.md)."
  type        = bool
  default     = true
}

# Deployment Guide — eventi-dtd

## Modalita di deployment

Il chart Helm supporta tre modalita, adatte a diverse dimensioni di PA e infrastrutture.

| Modalita | Database | JVB | Recording | Node pool dedicato | Ideale per |
|---|---|---|---|---|---|
| **Semplice** | Nel cluster | 1 fisso | No | No | Demo, test, piccole PA |
| **Standard** | Esterno | 1+ fisso | Si | No | PA medie, fino a 200 partecipanti |
| **Completa** | Esterno | Scale-to-zero | Si | Si | Grandi PA, 300+ partecipanti |

## Prerequisiti comuni

- Cluster Kubernetes (AKS, GKE, EKS, k3s, o bare metal)
- `kubectl` configurato
- Helm 3.x
- Ingress controller (NGINX raccomandato)
- DNS record che punta all'IP dell'Ingress

## Modalita semplice

Tutto nel cluster, nessuna dipendenza esterna. Ideale per valutare la piattaforma.

```bash
# 1. Crea il namespace
kubectl create namespace videocall

# 2. Installa
helm upgrade --install videocall ./infra/helm/eventi-dtd \
  -f examples/values-simple.yaml \
  -n videocall \
  --set postgresql.auth.password="$(openssl rand -hex 16)" \
  --set secrets.generate.APP_SECRET="$(openssl rand -hex 32)" \
  --set secrets.generate.JITSI_JWT_SECRET="$(openssl rand -hex 32)" \
  --set secrets.generate.PII_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  --set secrets.generate.CRON_API_KEY="$(openssl rand -hex 32)" \
  --set secrets.generate.ADMIN_API_KEY="$(openssl rand -hex 32)" \
  --set app.env.NEXT_PUBLIC_APP_URL=https://videocall.tuodominio.com \
  --set "ingress.hosts[0].host=videocall.tuodominio.com"

# 3. Verifica
kubectl get pods -n videocall
curl -s https://videocall.tuodominio.com/api/health
```

## Modalita standard

Database esterno, JVB e Jibri attivi, HPA sull'app.

```bash
# 1. Crea namespace e segreti
kubectl create namespace videocall
kubectl create secret generic videocall-secrets -n videocall \
  --from-literal=DATABASE_URL="postgresql://user:pass@db-host:5432/eventi_dtd?sslmode=require" \
  --from-literal=APP_SECRET="$(openssl rand -hex 32)" \
  --from-literal=JITSI_JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=PII_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  --from-literal=CRON_API_KEY="$(openssl rand -hex 32)" \
  --from-literal=ADMIN_API_KEY="$(openssl rand -hex 32)" \
  --from-literal=JITSI_JWT_APP_ID="eventi_dtd" \
  --from-literal=JITSI_JWT_ISSUER="eventi-dtd" \
  --from-literal=JITSI_JWT_AUDIENCE="jitsi" \
  --from-literal=SMTP_HOST="smtp.eu.mailgun.org" \
  --from-literal=SMTP_PORT="587" \
  --from-literal=SMTP_SECURE="true" \
  --from-literal=SMTP_USER="postmaster@mg.tuodominio.com" \
  --from-literal=SMTP_PASSWORD="..." \
  --from-literal=SMTP_FROM="eventi@tuodominio.com" \
  --from-literal=SMTP_FROM_NAME="Eventi PA"

# 2. Installa
helm upgrade --install videocall ./infra/helm/eventi-dtd \
  -f examples/values-standard.yaml \
  -n videocall \
  --set app.env.NEXT_PUBLIC_APP_URL=https://videocall.tuodominio.com \
  --set "ingress.hosts[0].host=videocall.tuodominio.com" \
  --set "ingress.tls[0].hosts[0]=videocall.tuodominio.com" \
  --set jitsi-meet.prosody.auth.jwt.appSecret=$JITSI_JWT_SECRET

# 3. Verifica
kubectl get pods -n videocall
curl -s https://videocall.tuodominio.com/api/health
```

## Modalita completa

Database esterno, JVB su nodi dedicati con scale-to-zero, monitoring.

### Prerequisiti aggiuntivi

- Node pool dedicato per JVB/Jibri con:
  - Taint: `workload=jitsi-jvb:NoSchedule`
  - Label: `workload=jitsi-jvb`
  - Autoscaler: min 0, max 4
  - Vedi `infra/tofu/jvb-nodepool.tf` per un esempio AKS
- Porta UDP 10000 aperta verso Internet sui nodi JVB

```bash
# 1. Crea namespace e segreti (come modalita standard)
kubectl create namespace videocall
kubectl create secret generic videocall-secrets -n videocall --from-literal=...

# 2. Installa
helm upgrade --install videocall ./infra/helm/eventi-dtd \
  -f examples/values-full.yaml \
  -n videocall \
  --set app.env.NEXT_PUBLIC_APP_URL=https://videocall.tuodominio.com \
  --set "ingress.hosts[0].host=videocall.tuodominio.com" \
  --set "ingress.tls[0].hosts[0]=videocall.tuodominio.com" \
  --set jitsi-meet.prosody.auth.jwt.appSecret=$JITSI_JWT_SECRET \
  --wait --timeout 10m

# 3. Verifica
kubectl get pods -n videocall
kubectl get cronjob -n videocall  # jvb-scaler dovrebbe essere presente
```

## Networking: TURN/STUN e firewall

### Perché serve un TURN server

Il JVB (Video Bridge) comunica con i browser via **UDP porta 10000**. Se un partecipante è dietro un firewall restrittivo (es. solo porta 443 TCP aperta), la connessione diretta al JVB fallisce. Un server TURN (coturn) fa da relay:

```
Rete aperta:      Browser ──UDP 10000──→ JVB (diretto)
Firewall UDP:     Browser ──TLS 443──→ coturn ──UDP──→ JVB (relay)
Solo 443 TCP:     Browser ──TLS 443──→ coturn ──UDP──→ JVB (relay)
```

Il chart Helm include **coturn** come subchart opzionale. È fortemente raccomandato in produzione.

### Configurazione coturn (TURNS su porta 443)

```yaml
jitsi-meet:
  coturn:
    enabled: true
    service:
      type: LoadBalancer
    # Certificato TLS per TURNS (TCP 443)
    tls:
      enabled: true
      secretName: coturn-tls
    # Permetti relay verso i pod JVB nella rete overlay
    allowedPeerIPs: "10.0.0.0-10.255.255.255,192.168.0.0-192.168.255.255"
```

Prosody annuncia il server TURN ai client via XEP-0215 (External Service Discovery):
- STUN UDP 3478
- TURN UDP 3478
- TURNS TCP 443 (per client dietro firewall restrittivi)

### Configurazione JVB per ambienti cloud

In Kubernetes con overlay network (Azure CNI, Calico, Flannel), i pod JVB hanno IP interni non raggiungibili dai client. Servono due configurazioni:

```yaml
jitsi-meet:
  jvb:
    # STUN server per la discovery dell'IP pubblico
    stunServers: "turn.tuodominio.com:3478"
    # Non annunciare gli IP di pod interni ai client
    extraEnvs:
      JVB_ADVERTISE_PRIVATE_CANDIDATES: "false"
```

### Configurazione client ICE

Se i client non ricevono la configurazione STUN/TURN via XEP-0215 (dipende dalla versione di Jitsi), è possibile forzarla lato web:

```yaml
jitsi-meet:
  web:
    custom:
      configs:
        _custom_config_js: |
          config.p2p.stunServers = [
            { urls: 'stun:turn.tuodominio.com:3478' }
          ];
          config.p2p.useStunTurn = true;
          config.bridgeChannel = { preferSctp: false };
          config.useTurnUdp = true;
          config.p2p.iceTransportPolicy = 'all';
```

> **`preferSctp: false`** è importante: forza il bridge channel su WebSocket, evitando un deadlock SCTP/ICE che può causare crash della call quando un partecipante esce.

### Porte firewall

| Porta | Protocollo | Direzione | Componente | Note |
|---|---|---|---|---|
| 443 | TCP | Ingress | NGINX Ingress | Signaling HTTPS + WebSocket |
| 443 | TCP | Ingress | coturn LB | TURNS (TURN over TLS) |
| 3478 | UDP+TCP | Ingress | coturn LB | STUN/TURN |
| 10000 | UDP | Ingress | JVB LB/NodePort | Media RTP (diretto, senza TURN) |

Se tutti i client hanno **solo la porta 443 aperta**, il media funziona comunque tramite TURNS → coturn → JVB.

### Nginx proxy buffer size

Next.js genera header HTTP grandi (CSP, link preload, cookies). Se l'ingress NGINX usa i buffer di default (4k), pagine complesse come l'admin possono restituire **502 Bad Gateway**. Il chart configura `16k` di default:

```yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"
    nginx.ingress.kubernetes.io/proxy-buffers-number: "4"
```

Se si usa un values di override, assicurarsi di includere queste annotation.

## Note specifiche per cloud

### Azure AKS

```yaml
# nodeSelector per il pool "applications"
app:
  nodeSelector:
    agentpool: applications

# Node pool JVB (vedi infra/tofu/jvb-nodepool.tf)
# NSG: aprire UDP 10000 inbound sul node pool jvb
# Secrets: Azure Key Vault + External Secrets Operator raccomandato
```

Creazione node pool JVB via CLI:
```bash
az aks nodepool add --resource-group <RG> --cluster-name <CLUSTER> \
  --name jvb --node-vm-size Standard_D4s_v3 \
  --node-count 0 --min-count 0 --max-count 4 --enable-cluster-autoscaler \
  --labels workload=jitsi-jvb --node-taints workload=jitsi-jvb:NoSchedule \
  --zones 1 2 3 --mode User
```

### Google GKE

```yaml
app:
  nodeSelector:
    cloud.google.com/gke-nodepool: applications

# Creazione node pool JVB:
# gcloud container node-pools create jvb --cluster <CLUSTER> \
#   --machine-type e2-standard-4 --num-nodes 0 \
#   --enable-autoscaling --min-nodes 0 --max-nodes 4 \
#   --node-labels workload=jitsi-jvb \
#   --node-taints workload=jitsi-jvb:NoSchedule
```

### AWS EKS

```yaml
app:
  nodeSelector:
    eks.amazonaws.com/nodegroup: applications

# Creazione node group JVB:
# eksctl create nodegroup --cluster <CLUSTER> --name jvb \
#   --instance-types m5.xlarge --nodes-min 0 --nodes-max 4 \
#   --labels workload=jitsi-jvb \
#   --taints key=workload,value=jitsi-jvb,effect=NoSchedule
```

### On-premise / k3s

```yaml
app:
  nodeSelector: {}  # Nessun selector, gira su qualsiasi nodo

# k3s single-node: usa la modalita semplice
# k3s multi-node: etichetta i nodi manualmente:
#   kubectl label node <node> workload=jitsi-jvb
#   kubectl taint node <node> workload=jitsi-jvb:NoSchedule
```

Per k3s, usa `traefik` come `ingress.className` invece di `nginx`.

## Aggiornamento

```bash
# 1. Crea e pusha un nuovo tag — CI builda e pusha le immagini
git tag -a v0.3.0 -m "v0.3.0"
git push origin v0.3.0

# 2. Aggiorna il deployment
helm upgrade videocall ./infra/helm/eventi-dtd \
  -f examples/values-full.yaml \  # o il tuo file di override
  -n videocall \
  --set app.image.tag=v0.3.0
```

Le migrazioni del database vengono eseguite automaticamente dall'init container.

## Rollback

```bash
helm history videocall -n videocall
helm rollback videocall <REVISION> -n videocall
```

## Troubleshooting

### Pod in CrashLoopBackOff

```bash
kubectl logs <pod> -n videocall --previous
kubectl describe pod <pod> -n videocall
```

Cause comuni:
- `DATABASE_URL` errato o DB non raggiungibile
- Segreti mancanti
- `readOnlyRootFilesystem` senza volumi `/tmp` e `.next/cache` montati

### Migrazioni fallite

```bash
kubectl logs <pod> -n videocall -c db-migrate
```

### JVB non raggiungibile (no audio/video)

1. **Verificare che coturn sia attivo** e il certificato TLS valido:
   ```bash
   kubectl get pods -n videocall -l app.kubernetes.io/component=coturn
   kubectl get certificate -n videocall
   openssl s_client -connect turn.tuodominio.com:443 -servername turn.tuodominio.com
   ```

2. **Verificare che JVB non annunci IP privati**:
   ```bash
   kubectl exec <jvb-pod> -- cat /config/jvb.conf | grep advertise
   # Deve mostrare: advertise-private-candidates=false
   ```

3. **Verificare la configurazione client** (STUN/TURN):
   ```bash
   kubectl exec <web-pod> -- cat /config/custom-config.js
   # Deve contenere stunServers e bridgeChannel config
   ```

4. **Porta UDP 10000**: aperta sul firewall/NSG dei nodi JVB (per connessioni dirette senza TURN)

5. **Test TURNS**: se i client sono dietro firewall restrittivi, verificare che TURNS funzioni:
   ```bash
   # Da un pod nel cluster
   curl -sv https://turn.tuodominio.com:443 2>&1 | grep "subject\|issuer"
   ```

### Call crash quando un partecipante esce

Questo è tipicamente causato da un deadlock SCTP/ICE nel bridge channel. Soluzione: forzare WebSocket per il bridge channel:

```yaml
jitsi-meet:
  web:
    custom:
      configs:
        _custom_config_js: |
          config.bridgeChannel = { preferSctp: false };
```

### 502 Bad Gateway su pagine admin

Header HTTP di Next.js troppo grandi per il buffer nginx. Aggiungere alle annotation dell'ingress:

```yaml
nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"
nginx.ingress.kubernetes.io/proxy-buffers-number: "4"
```

### Pod Ready ma app in errore 500

La readiness probe `/api/ready` verifica la compatibilità dello schema DB con il modello Prisma. Se il pod è Ready ma l'app dà 500, controllare:

```bash
# Verificare che la readiness usi /api/ready (non /api/health)
kubectl get pod <pod> -o jsonpath='{.spec.containers[0].readinessProbe.httpGet.path}'

# Testare manualmente
kubectl exec <pod> -- wget -qO- http://127.0.0.1:3000/api/ready
```

Se `/api/ready` restituisce 503, la migration è incompleta. Controllare i log dell'init container:
```bash
kubectl logs <pod> -c db-migrate
```

### Scale-up lento (cold start)

- Node provisioning: ~2-3 min (inevitabile con scale-to-zero)
- Image pull: ~30s
- Soluzione: aumentare l'anticipo nella query dello scaler (default 30 min)

### Metriche non visibili in Grafana

1. `kubectl get servicemonitor -n videocall`
2. Verificare che il label `release: prometheus` corrisponda al selector
3. `kubectl port-forward svc/videocall 3000:3000 -n videocall` poi `curl localhost:3000/api/metrics`

## Configurazione registrazione video (Jibri)

Jibri è il componente per la registrazione video degli eventi. È opzionale e richiede:

1. **Storage object**: dove salvare le registrazioni
2. **PVC**: storage locale temporaneo per la registrazione in corso
3. **Risorse**: ~2 CPU, 4 GiB RAM per pod (usa /dev/shm)

### Abilitare Jibri

Nel values di produzione:

```yaml
jitsi:
  jitsi-meet:
    jibri:
      enabled: true
      replicaCount: 0  # Scale on demand
      recording:
        storage:
          type: "azure-blob"  # o s3, gcs, minio
          azure:
            connectionString: ""  # Nel secret
            containerName: "recordings"
```

### Provider di storage supportati

| Provider | Tipo | Note |
|----------|------|------|
| Azure Blob Storage | `azure-blob` | Consigliato per AKS |
| AWS S3 | `s3` | Consigliato per EKS |
| Google Cloud Storage | `gcs` | Consigliato per GKE |
| MinIO | `minio` | Self-hosted, S3-compatible |
| Locale | `local` | Solo per test, recordings perse al restart |

### Flusso recording

1. Moderatore clicca "Avvia registrazione"
2. Jitsi avvia Jibri (headless Chrome cattura audio/video)
3. Al termine: Jibri salva `.mp4` → finalize script → upload su storage
4. Webhook notifica il portale → recording URL salvata sull'evento
5. Moderatore e partecipanti vedono il link nella pagina post-evento
6. Dopo il periodo di retention GDPR, il cron job elimina la recording

### Finalize script

Lo script `infra/jitsi/jibri-finalize.sh` viene eseguito dopo ogni registrazione. In Kubernetes è montato come ConfigMap. Lo script:

- Cerca il file MP4 nella directory di output di Jibri
- Lo carica sullo storage configurato (Azure Blob, S3, GCS, MinIO)
- Notifica il portale via webhook (`POST /api/webhooks/recording`)
- Pulisce il file locale dopo l'upload (eccetto per storage `local`)

### Variabili d'ambiente per recording

| Variabile | Descrizione |
|-----------|-------------|
| `RECORDING_STORAGE_TYPE` | `azure-blob`, `s3`, `gcs`, `minio`, `local` |
| `RECORDING_AZURE_CONNECTION_STRING` | Connection string Azure Blob |
| `RECORDING_AZURE_CONTAINER` | Nome container Azure |
| `RECORDING_S3_BUCKET` | Nome bucket S3 |
| `RECORDING_S3_REGION` | Regione AWS |
| `RECORDING_WEBHOOK_URL` | URL webhook per notificare il portale |
| `CRON_API_KEY` | Chiave di autenticazione per il webhook |

## Storage per registrazioni video

### Dimensionamento

- Jibri registra a ~1.5 Mbps (720p H.264)
- 1 ora di registrazione ≈ 675 MB
- 2 ore ≈ 1.35 GB
- Con 10 eventi/mese da 2 ore: ~13.5 GB/mese

### Azure Blob Storage con CDN

Per servire il video a 300 utenti simultanei:
- Azure Blob supporta fino a 500 richieste/secondo per blob
- Con range requests, il video viene servito in chunk
- Per alta disponibilità: Azure CDN (Front Door) davanti al Blob
- Costo: ~€0.02/GB trasferimento + ~€0.02/GB storage

### Configurazione CDN (opzionale, consigliato per >100 utenti simultanei)

Se si prevede che molti utenti guarderanno le registrazioni contemporaneamente:
1. Creare un profilo Azure Front Door
2. Aggiungere un endpoint con origin = Blob Storage container
3. Configurare regole di caching (cache video per 24h)
4. Usare l'URL CDN come recordingUrl

Senza CDN, Azure Blob gestisce comunque 300 utenti ma con latenza maggiore.

### Lifecycle recordings

| Tipo | Durata | Pulizia |
|------|--------|---------|
| Temporanea (catch-up) | 24 ore se non pubblicata | Cron `/api/cron/cleanup` |
| Pubblicata | Configurabile (7/30/90 giorni o fino a retention evento) | Cron `/api/cron/cleanup` |
| Event retention | `dataRetentionDays` dopo `endsAt` | Cron `/api/cron/cleanup` |

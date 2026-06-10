# Service Inventory (trasparenza dei servizi)

La pagina pubblica **`/service-inventory`** espone, in modo leggibile e
scaricabile, **di cosa è fatta questa istanza** della piattaforma: le
dipendenze software (DEV) e i servizi del fornitore/operatore (OPS), in un
unico documento **[CycloneDX 1.6](https://cyclonedx.org/)**.

> **pa-webinar è software a riuso (AGPL-3.0).** Per questo l'inventario **non
> è incluso nell'immagine** e **non è committato** nel repository come dato di
> un ambiente specifico: la parte OPS (cloud, region, account, retention, DPA…)
> è diversa per ogni PA che installa il software. Ogni operatore pubblica il
> **proprio** documento e lo collega tramite la variabile
> `SERVICE_INVENTORY_URL`. Se la variabile non è impostata, la pagina mostra
> semplicemente "inventario non pubblicato".

---

## 1. Due nature diverse: DEV e OPS

| | Cosa contiene | Chi lo produce | Per-ambiente? |
|---|---|---|---|
| **DEV** (`components[]`) | immagini OCI, pacchetti npm, OS base, asset crittografici | la **release** del software (uguale per tutti i riusatori a una data versione) | No → generabile in CI |
| **OPS** (`services[]`) | AKS/EKS/GKE/on-prem, database, object storage, SMTP, CDN, CA TLS, monitoring, sub-processor + relativi DPA | **l'operatore** che installa | **Sì** → va scritto/derivato per il proprio deployment |

L'obiettivo a tendere: la parte **DEV generata automaticamente** in CI a ogni
release (es. [cdxgen](https://github.com/CycloneDX/cdxgen) +
[syft](https://github.com/anchore/syft)) e pubblicata come asset di release;
la parte **OPS** derivata dal proprio inventario cloud (vedi §4) e fusa con la
DEV. Finché la generazione automatica non è disponibile, il documento si cura
a mano partendo dal **template** in
[`docs/examples/service-inventory.example.json`](examples/service-inventory.example.json).

---

## 2. Come l'app risolve `SERVICE_INVENTORY_URL`

La pagina (`app/src/app/[locale]/service-inventory/page.tsx`) applica queste
regole:

| Valore di `SERVICE_INVENTORY_URL` | Comportamento |
|---|---|
| **vuoto / non impostato** | pagina "inventario non pubblicato" (nessun errore) |
| **`https://…` (URL assoluto)** | `fetch()` lato server con cache ISR di 1 ora. **Nessun rebuild dell'immagine necessario.** ✅ consigliato |
| **`/qualcosa` (path assoluto)** | letto da `public/qualcosa` **dentro l'immagine** (richiede rebuild per aggiornarlo) — modalità legacy/demo |
| altro / fetch fallita | pagina "errore di recupero" (nessun crash) |

→ **Per il riuso, usa un URL `https://` assoluto** che punti a un documento
ospitato da te (vedi §3). Così aggiorni l'inventario senza ricostruire né
ridistribuire l'immagine.

---

## 3. Dove ospitare il tuo documento OPS

Scegli in base al tuo ambiente. In tutti i casi `SERVICE_INVENTORY_URL` =
l'URL pubblico del JSON.

- **Azure Blob Storage** (container con accesso anonimo in lettura, o front di
  CDN):
  ```bash
  az storage container create -n public --account-name <acct> --public-access blob
  az storage blob upload -c public -n service-inventory.json \
    -f service-inventory.json --account-name <acct> --content-type application/json
  # SERVICE_INVENTORY_URL=https://<acct>.blob.core.windows.net/public/service-inventory.json
  ```
- **AWS S3** (oggetto pubblico o dietro CloudFront):
  ```bash
  aws s3 cp service-inventory.json s3://<bucket>/service-inventory.json \
    --content-type application/json
  # SERVICE_INVENTORY_URL=https://<bucket>.s3.<region>.amazonaws.com/service-inventory.json
  ```
- **GCP Cloud Storage**:
  ```bash
  gcloud storage cp service-inventory.json gs://<bucket>/service-inventory.json
  gcloud storage objects update gs://<bucket>/service-inventory.json \
    --add-acl-grant=entity=allUsers,role=READER
  # SERVICE_INVENTORY_URL=https://storage.googleapis.com/<bucket>/service-inventory.json
  ```
- **On-prem / qualsiasi web server**: pubblica il file su un host HTTPS che già
  gestisci (anche un bucket MinIO, un Nginx statico, una GitHub Pages).
- **Kubernetes ConfigMap + path relativo** (nel cluster, senza object storage —
  utile se lo storage non consente blob pubblici): crea una ConfigMap dal JSON e
  montala dentro `public/tenants/<tenant>/` del pod app, poi
  `SERVICE_INVENTORY_URL=/tenants/<tenant>/service-inventory.json`. Con il chart
  Helm di pa-webinar si fa via `app.extraVolumes`/`extraVolumeMounts` (ricordando
  di **re-includere** i default `tmp` e `next-cache`, perché Helm sostituisce le
  liste invece di fonderle):
  ```bash
  kubectl create configmap pa-webinar-service-inventory -n <ns> \
    --from-file=service-inventory.json=service-inventory.json \
    --dry-run=client -o yaml | kubectl apply -f -
  ```
  ```yaml
  app:
    env:
      SERVICE_INVENTORY_URL: "/tenants/<tenant>/service-inventory.json"
    extraVolumes:
      - { name: tmp,        emptyDir: { sizeLimit: 100Mi } }
      - { name: next-cache, emptyDir: { sizeLimit: 500Mi } }
      - name: service-inventory
        configMap: { name: pa-webinar-service-inventory }
    extraVolumeMounts:
      - { name: tmp,        mountPath: /tmp }
      - { name: next-cache, mountPath: /app/.next/cache }
      - name: service-inventory
        mountPath: /app/app/public/tenants/<tenant>   # public/ dell'immagine standalone (cwd Node = /app/app)
        readOnly: true
  ```
  La ConfigMap (limite 1 MiB) si aggiorna ricreandola; il volume si rinfresca
  entro ~1 min (o `kubectl rollout restart deploy/<app>` per pickup immediato).
- **Bake nell'immagine downstream** (`/tenants/<nome>/service-inventory.json` +
  path relativo): sconsigliato per il riuso, accettabile solo per build
  proprietarie; richiede rebuild a ogni modifica.

> Tieni il documento **nel tuo layer di deployment** (es. il repo privato di
> configurazione / IaC), **non** nel fork del codice applicativo.

---

## 4. Scrivere la parte OPS (`services[]`)

Parti dal template e popola `services[]`. Ogni servizio è un oggetto
CycloneDX `service` con, in più, alcune `properties` che la pagina usa per il
rendering:

| Property | A cosa serve |
|---|---|
| `pa-webinar:layer` | colloca l'elemento nello “stack” a 4 livelli: `access` / `app` / `data` / `platform` |
| `pa-webinar:stack-label` | etichetta breve nello stack (fallback: `name`) |
| `data[].classification` | `personal-data` e `recording` accendono i badge GDPR nella UI |
| `x-trust-boundary` | mostra il badge "confine di fiducia" |

E nel `metadata.properties` del documento: `pa-webinar:tenant`,
`pa-webinar:environment`, `pa-webinar:cloud-provider`, `pa-webinar:region`,
`pa-webinar:deployment-mode` (mostrati nell'intestazione).

### Ricette di discovery per provider

Usa l'inventario reale del tuo ambiente come fonte di verità — non copiare i
valori di un altro operatore.

**Azure (Resource Graph / az CLI)** — elenca le risorse del resource group del
deployment:
```bash
az graph query -q "Resources
  | where resourceGroup =~ '<rg>'
  | project name, type, location, sku=tostring(sku.name)" -o table
# oppure, per tipo:
az resource list -g <rg> --query "[].{name:name,type:type,loc:location}" -o table
az aks show -g <rg> -n <cluster> --query "{k8s:kubernetesVersion,region:location}"
az postgres flexible-server show -g <rg> -n <srv> --query "{ver:version,tls:minimumTlsVersion}"
az storage account show -n <acct> --query "{repl:sku.name,tls:minimumTlsVersion}"
```

**AWS (Resource Explorer / Tagging API)**:
```bash
aws resourcegroupstaggingapi get-resources \
  --query "ResourceTagMappingList[].ResourceARN" --output text
aws eks describe-cluster --name <cluster> --query "cluster.{ver:version,region:arn}"
aws rds describe-db-instances --query "DBInstances[].{id:DBInstanceIdentifier,engine:Engine,ver:EngineVersion}"
```

**GCP (Cloud Asset Inventory)**:
```bash
gcloud asset search-all-resources --scope=projects/<project> \
  --query="state:ACTIVE" --format="table(name,assetType,location)"
gcloud container clusters describe <cluster> --region <region> \
  --format="value(currentMasterVersion)"
```

**On-prem / self-hosted** — checklist manuale: orchestratore
(`kubectl get nodes,svc,ingress -A` / VM), database (motore + versione + TLS),
object storage (S3-compatibile/MinIO/NFS), SMTP relay, autorità di
certificazione TLS, reverse-proxy/ingress, stack di monitoring, eventuali
servizi gestiti esterni e i relativi DPA.

### Validazione

```bash
# JSON ben formato + struttura minima
jq -e '.bomFormat=="CycloneDX" and .specVersion=="1.6"
       and (.services|type=="array")' service-inventory.json
# (opzionale) validazione schema completa con cyclonedx-cli
cyclonedx validate --input-file service-inventory.json --input-version v1_6
```

---

## 5. Collegare il documento

Imposta la variabile d'ambiente dell'app:

```yaml
# values di deployment (es. Helm)
app:
  env:
    SERVICE_INVENTORY_URL: "https://<tuo-host>/service-inventory.json"
```

Riavvia/aggiorna il deployment. La pagina `/service-inventory` mostrerà il tuo
inventario; il link "scarica" punta direttamente all'URL per i consumatori che
vogliono il documento CycloneDX grezzo.

---

## 6. Roadmap

1. **DEV automatica in CI**: job di release che genera l'SBUM dei componenti
   (cdxgen + syft) e lo pubblica come asset, da fondere con la parte OPS.
2. **Generatore OPS**: comando che interroga il cloud (Azure Resource Graph /
   AWS Resource Explorer / GCP Asset Inventory) e pre-compila `services[]`.
3. **Upload da pannello admin**: per operatori non tecnici, caricamento del
   JSON dall'area amministrativa con persistenza su object storage.
4. **Firma**: BOM firmato con cosign e versionato a ogni release.

Vedi anche [`docs/GDPR.md`](GDPR.md) per le classificazioni dei dati e
[`docs/CONFIGURATION.md`](CONFIGURATION.md) per `SERVICE_INVENTORY_URL`.

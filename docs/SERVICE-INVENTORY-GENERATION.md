# Generazione dell'inventario servizi

Runbook per produrre il documento CycloneDX 1.6 servito dalla pagina `/service-inventory`. Il file è **per-tenant**: un'istanza `videocall-test` ed una `videocall-prod` producono due documenti distinti.

Ultimo aggiornamento: aprile 2026

---

## 1. Cos'è questo documento

Un singolo file JSON in formato [CycloneDX 1.6](https://cyclonedx.org/specification/overview/) (standard aperto OWASP) che elenca, per una specifica istanza:

- **DEV** — le dipendenze software che compongono l'applicazione (librerie npm, immagini OCI, pacchetti OS);
- **OPS** — i servizi gestiti da terzi su cui l'istanza si appoggia (AKS/GKE/EKS, Postgres gestito, Blob/S3/GCS, SMTP, DNS, ecc.);
- **Arricchimenti PA** — dichiarazioni di conformità (AgID, GDPR, cifratura, accesso), flussi di dati personali, asset crittografici, formulazione (Helm chart, CI/CD, pipeline di deploy).

Scopo: trasparenza verso la PA che consuma il servizio, anche oltre l'OSS già tracciato da `/security`. Un esempio completo è shippato con il codice in `app/public/tenants/videocall-test/service-inventory.json`.

## 2. Divisione DEV / OPS

| | **DEV** | **OPS** |
|---|---|---|
| Cosa descrive | Codice e dipendenze | Servizi cloud / gestiti |
| Chi lo cambia | Sviluppatori (PR) | Operatore della PA |
| Quando cambia | Ad ogni release | Al re-configure del tenant |
| Riproducibilità | Chiunque abbia il sorgente | Solo chi vede il tenant |
| Tool tipici | `cdxgen`, `syft` | `az graph`, `gcloud asset`, `aws resourcegroupstaggingapi`, `kubectl` |

Il documento finale fonde le due metà in un singolo CycloneDX: `components[]` (DEV) + `services[]` (OPS) + `metadata.declarations` (arricchimenti).

## 3. Generazione della parte DEV (automatizzabile)

### 3.1 Dipendenze npm

Installare [`@cyclonedx/cdxgen`](https://github.com/CycloneDX/cdxgen):

```bash
npx @cyclonedx/cdxgen -t js -o bom-npm.json -r app/
```

Produce un BOM CycloneDX con tutte le dipendenze dirette e transitive, licenze incluse. Per un rapporto ridotto (solo dipendenze dirette):

```bash
npx @cyclonedx/cdxgen -t js --no-recurse-packages -o bom-npm-direct.json -r app/
```

### 3.2 Immagini OCI (sha256 digest + manifest OS)

Installare [`syft`](https://github.com/anchore/syft):

```bash
syft ghcr.io/italia/eventi-dtd:0.3.44 -o cyclonedx-json=bom-container-app.json
syft docker.io/jitsi/web:stable-9258 -o cyclonedx-json=bom-container-jitsi-web.json
# ...ripetere per ogni immagine in uso
```

Il digest `sha256:…` che appare nel `purl` è l'identificatore immutabile dell'immagine effettivamente eseguita. Per ricavarlo da un cluster vivo:

```bash
kubectl -n $NS get pod -l app=... -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'
```

### 3.3 Merge DEV

```bash
jq -s '
  .[0] as $app |
  reduce .[1:][] as $bom ($app;
    .components += ($bom.components // [])
    | .dependencies += ($bom.dependencies // [])
  )
' bom-npm.json bom-container-*.json > bom-dev.json
```

## 4. Generazione della parte OPS (per-provider)

### 4.1 Azure (reference implementation)

Azure Resource Graph è l'API più veloce per inventariare una subscription. Richiede il ruolo `Reader` sulla subscription o sul resource group target.

```bash
az graph query -q "
  Resources
  | where subscriptionId == '$SUBSCRIPTION_ID'
  | where resourceGroup == '$RG'
  | project name, type, location, kind, sku, properties
" -o json > azure-inventory.json
```

Risorse tipicamente da includere nell'inventario (filtra per `type`):

- `microsoft.containerservice/managedclusters` (AKS)
- `microsoft.dbforpostgresql/flexibleservers`
- `microsoft.storage/storageaccounts`
- `microsoft.keyvault/vaults`
- `microsoft.network/dnszones`, `privatednszones`
- `microsoft.network/publicipaddresses`
- `microsoft.operationalinsights/workspaces` (Log Analytics)
- `microsoft.insights/components` (App Insights)

Implementazione di riferimento: `infra/service-inventory/azure/` in questo repo — include CronJob Kubernetes, script Python di trasformazione e upload su Azure Blob.

### 4.2 Google Cloud Platform

[Cloud Asset Inventory](https://cloud.google.com/asset-inventory/docs/overview) fornisce un export strutturato:

```bash
gcloud asset export \
  --project=$PROJECT_ID \
  --content-type=resource \
  --output-path=gs://$BUCKET/assets.json \
  --asset-types=container.googleapis.com/Cluster,\
sqladmin.googleapis.com/Instance,\
storage.googleapis.com/Bucket,\
cloudkms.googleapis.com/CryptoKey,\
dns.googleapis.com/ManagedZone
```

Lo schema è diverso da CycloneDX: servizio gestito da GCP con campi come `name`, `assetType`, `resource.data.state`, `resource.location`. Mappare `assetType` → `services[].name`, `resource.location` → proprietà `gcp:region`, ecc.

Permessi minimi: `roles/cloudasset.viewer` sul progetto.

### 4.3 Amazon Web Services

Nessuna API unica copre tutto l'inventario. Due vie:

**Via A — Resource Groups Tagging API** (semplice, copre i servizi taggati):

```bash
aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=Tenant,Values=videocall-prod \
  --output json > aws-inventory.json
```

Presuppone convenzione di tagging disciplinata su tutte le risorse.

**Via B — AWS Config Advanced Query** (completo):

```bash
aws configservice select-aggregate-resource-config \
  --configuration-aggregator-name all-accounts \
  --expression "SELECT resourceId, resourceType, awsRegion WHERE resourceType LIKE 'AWS::%'" \
  --output json > aws-config.json
```

Richiede AWS Config abilitato (costo aggiuntivo). Permessi: `config:SelectAggregateResourceConfig`.

### 4.4 Self-hosted / k3s / on-prem

Nessun'API cloud — l'inventario è un mix di `kubectl`, `helm` e censimento manuale:

```bash
# Workload del cluster
kubectl get deployments,statefulsets,daemonsets -A -o json > k8s-workload.json

# Servizi esposti (type LoadBalancer / ClusterIP)
kubectl get services -A -o json > k8s-services.json

# Release Helm
helm list -A -o json > helm-releases.json
for r in $(helm list -A -o json | jq -r '.[] | "\(.namespace)/\(.name)"'); do
  ns="${r%/*}"; name="${r##*/}"
  helm -n "$ns" get values "$name" -o json > "helm-values-$ns-$name.json"
done

# Certificati (se cert-manager)
kubectl get certificates -A -o json > certs.json
```

Da censire a mano (non sono dentro il cluster):

- Provider SMTP
- DNS (Cloudflare, provider registrar, ...)
- Provider di object storage esterno
- Backup remoti
- Monitoring esterno (UptimeRobot, StatusCake, ...)

## 5. Mappare l'output verso `services[]` di CycloneDX

Ogni servizio diventa un oggetto `services[]`. Campi rilevanti:

```json
{
  "bom-ref": "svc:<provider>/<kind>/<instance>",
  "name": "Nome leggibile del servizio",
  "version": "versione se applicabile",
  "provider": { "name": "Microsoft Corporation", "url": ["..."] },
  "group": "microsoft.containerservice",
  "description": "Breve descrizione operativa in italiano.",
  "endpoints": ["https://..."],
  "authenticated": true,
  "x-trust-boundary": true,
  "data": [
    { "classification": "personal-data", "flow": "bi-directional",
      "description": "Dati trattati + base giuridica GDPR." }
  ],
  "externalReferences": [
    { "type": "documentation", "url": "..." }
  ],
  "properties": [
    { "name": "<provider>:resource-type", "value": "..." },
    { "name": "<provider>:region", "value": "..." },
    { "name": "<provider>:sla", "value": "99.95%" },
    { "name": "<provider>:certifications",
      "value": "ISO 27001, ISO 27018, AgID Circolare 2/2018" },
    { "name": "eventi-dtd:layer", "value": "access|app|data|platform" },
    { "name": "eventi-dtd:stack-label", "value": "etichetta breve per la pagina" }
  ]
}
```

> La proprietà `eventi-dtd:layer` è letta dalla pagina `/service-inventory` per renderizzare il diagramma a quattro livelli (accesso, applicazione, dati, piattaforma). Senza questa, il servizio appare solo nella card-list. `eventi-dtd:stack-label` permette un'etichetta compatta da usare nel diagramma.

## 6. Arricchimenti PA-specifici

Dopo il merge DEV+OPS, aggiungere la sezione `metadata.declarations` con le dichiarazioni formali (esempio completo in `app/public/tenants/videocall-test/service-inventory.json`):

- **Open source** (affirm: `AGPL-3.0-only`, VCS pubblico)
- **Vulnerability scanning** (evidence: workflow GitHub Actions, Dependabot, OpenSSF Scorecard)
- **Data minimization** (evidence: `docs/GDPR.md`, retention policy)
- **Encryption at rest** (asset crittografici dichiarati come `component type: cryptographic-asset`)
- **Encryption in transit** (TLS certificate asset, TLS minimum version sui servizi gestiti)
- **Access control** (evidence: manifesti RBAC, secret management)
- **Qualified cloud provider** (Azure / GCP / AWS → AgID Circolare 2/2018)

Sezioni opzionali ma utili: `compositions[]` (completezza del documento), `vulnerabilities: []` (VEX-ready), `formulation[]` (Helm chart version + CI workflow), `annotations[]` (note pedagogiche).

## 7. Pubblicazione

La pagina `/service-inventory` risolve la variabile d'ambiente `SERVICE_INVENTORY_URL` in due modi:

- **Path locale** (es. `/tenants/videocall-test/service-inventory.json`) → letto da `app/public/` tramite `fs.readFile`. Il file viaggia con l'immagine OCI, quindi ogni release è auto-consistente. Adatto a tenant pochi e stabili.
- **URL https assoluto** (es. Azure Blob pubblico, S3 pubblico, repository Git raw) → fetch con ISR `revalidate: 3600`. Adatto a generazione automatizzata indipendente dal release-cycle dell'app.

In produzione, la forma consigliata è: CronJob genera il JSON → upload su storage pubblico → `SERVICE_INVENTORY_URL` punta a quell'URL.

## 8. Frequenza di rigenerazione

- **DEV**: ad ogni release (integrabile in `.github/workflows/release.yml`).
- **OPS**: giornaliera o settimanale (un CronJob nel cluster è sufficiente).
- **Declarations PA**: manuale, quando cambiano le evidenze (audit, nuovi controlli).

## 9. Checklist per un nuovo tenant

1. Copiare `app/public/tenants/videocall-test/service-inventory.json` in `app/public/tenants/<nuovo-tenant>/service-inventory.json`.
2. Aggiornare `metadata.component.name`, `metadata.properties[tenant|region|deployment-mode]`, `serialNumber` (nuovo UUID), `timestamp`.
3. Per la parte DEV: rigenerare con `cdxgen` + `syft` oppure riusare quella della release target (non è tenant-specific).
4. Per la parte OPS: seguire §4 per il provider target e sostituire `services[]` di conseguenza.
5. Aggiornare `metadata.declarations` con le evidenze della PA specifica.
6. Puntare `SERVICE_INVENTORY_URL` al nuovo path (via tenant Helm values) — vedi [`infra/helm/eventi-dtd/values.yaml`](../infra/helm/eventi-dtd/values.yaml).
7. Verificare la resa su `/<locale>/service-inventory` e scaricare il JSON dal link "Scarica JSON originale" per double-check.

## 10. Limitazioni note

- Il diagramma "Architettura in breve" della pagina è derivato **solo** dai componenti/servizi con proprietà `eventi-dtd:layer`. Chi non tagga dimentica gli elementi dalla vista d'insieme pur mantenendoli nelle tabelle dettagliate.
- La generazione automatica completa del DEV (npm + OCI + OS layer) richiede di eseguire `syft` dentro un contesto con accesso alle immagini — tipicamente una GitHub Action dopo `docker build`.
- La generazione OPS cross-provider (cluster multi-cloud) deve produrre un documento per provider e fonderli; non c'è uno strumento single-source.

## Vedi anche

- [CycloneDX 1.6 schema](https://cyclonedx.org/docs/1.6/json/)
- [AgID Circolare 2/2018](https://www.agid.gov.it/index.php/it/infrastrutture/cloud-pa/qualificazione-servizi-cloud-per-pa) — qualificazione servizi cloud per PA
- `docs/GDPR.md` — politiche di retention e minimizzazione dati
- `infra/service-inventory/azure/` — implementazione di riferimento Azure

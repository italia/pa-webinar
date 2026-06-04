# Azure service-inventory generator

Implementazione di riferimento per generare la metà OPS del documento `/service-inventory` su Azure. Produce un CycloneDX 1.6 completo (DEV+OPS+declarations) e lo pubblica su Azure Blob Storage.

```
┌──────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│ CronJob          │────▶│ Azure Resource Graph │     │ GitHub raw (DEV half)│
│ (daily, 04:17)   │     │ (query ARM API)      │     │ /tenants/.../bom.json│
└────────┬─────────┘     └──────────────────────┘     └──────────┬───────────┘
         │                                                       │
         ▼                                                       │
┌──────────────────────────────────────────────────────────────────┐
│ merge: replace services[] with generated OPS, bump timestamp     │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
                 ┌──────────────────────────┐
                 │ Azure Blob (public)      │
                 │ service-inventory/       │
                 │   videocall-prod/bom.json│
                 └──────────────┬───────────┘
                                │
                                ▼
                 SERVICE_INVENTORY_URL → reso dalla pagina /service-inventory
```

## Contenuto

- **`scripts/azure-to-cyclonedx.py`** — trasformatore Python che interroga Azure Resource Graph e produce un JSON con `services[]` in formato CycloneDX 1.6. Mappa i resource type Azure noti (AKS, Postgres Flexible, Storage, Key Vault, DNS, Log Analytics, ACR, …) a servizi con `pa-webinar:layer` per il diagramma di architettura.
- **`cronjob.yaml`** — manifesto Kubernetes che orchestra generazione + upload. Usa [Azure Workload Identity](https://azure.github.io/azure-workload-identity/) per autenticazione senza credenziali hardcoded.

## Prerequisiti

1. **AKS con Workload Identity abilitato** (`--enable-oidc-issuer --enable-workload-identity`).
2. **Managed Identity user-assigned** con due ruoli:
   - `Reader` sulla subscription (o resource group) target → serve a Resource Graph.
   - `Storage Blob Data Contributor` sullo storage account target → serve all'upload.
3. **Federated credential** che lega la MI alla `ServiceAccount` `service-inventory-generator` nel namespace in cui deploy-i il CronJob.
4. **Storage account + container public-read** per ospitare i JSON (`service-inventory` è un nome convenzionale).

## Quick start

```bash
# 1. Crea la Managed Identity e ottieni client-id + principal-id
az identity create \
  --name id-service-inventory \
  --resource-group rg-shared \
  --location italynorth

MI_CLIENT_ID=$(az identity show -n id-service-inventory -g rg-shared --query clientId -o tsv)
MI_PRINCIPAL_ID=$(az identity show -n id-service-inventory -g rg-shared --query principalId -o tsv)

# 2. Assegna i ruoli
az role assignment create \
  --assignee-object-id "$MI_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role Reader \
  --scope /subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG_APP

az role assignment create \
  --assignee-object-id "$MI_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" \
  --scope /subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG_STORAGE/providers/Microsoft.Storage/storageAccounts/$STORAGE_ACCOUNT

# 3. Crea la federated credential per legare MI ↔ ServiceAccount
OIDC_ISSUER=$(az aks show -n $AKS_NAME -g $AKS_RG --query oidcIssuerProfile.issuerUrl -o tsv)
az identity federated-credential create \
  --identity-name id-service-inventory \
  --resource-group rg-shared \
  --name fc-service-inventory-videocall-prod \
  --issuer "$OIDC_ISSUER" \
  --subject "system:serviceaccount:videocall-prod:service-inventory-generator" \
  --audiences api://AzureADTokenExchange

# 4. Prepara il ConfigMap con lo script (il manifest ha un placeholder vuoto)
kubectl -n videocall-prod create configmap service-inventory-scripts \
  --from-file=azure-to-cyclonedx.py=scripts/azure-to-cyclonedx.py \
  --dry-run=client -o yaml | kubectl apply -f -

# 5. Modifica cronjob.yaml sostituendo i placeholder REPLACE_WITH_...
#    (MI client id, subscription id, resource group, storage account, blob name)
# 6. Applica
kubectl -n videocall-prod apply -f cronjob.yaml

# 7. (Opzionale) Esegui subito per test
kubectl -n videocall-prod create job \
  --from=cronjob/service-inventory-generator si-test-$(date +%s)
kubectl -n videocall-prod logs -f job/si-test-...
```

Dopo il primo successo, puntare l'app via Helm values al JSON pubblicato:

```yaml
# k8s-configuration/helm/videocall/prod/values.yaml
app:
  env:
    SERVICE_INVENTORY_URL: "https://${STORAGE_ACCOUNT}.blob.core.windows.net/service-inventory/videocall-prod/service-inventory.json"
```

## Estendere la mappatura

Nuovi resource type Azure che vuoi includere nell'inventario: aggiungi una tupla a `TYPE_MAPPERS` in `scripts/azure-to-cyclonedx.py`:

```python
("microsoft.web/sites",  "Azure App Service",  "app"),
```

Per arricchimenti specifici (endpoints, data flows, versioni), estendi la sezione `to_service()`.

## Limiti noti

- **Solo Azure**: per GCP e AWS serve un generatore analogo (ricette in `docs/SERVICE-INVENTORY-GENERATION.md`).
- **DEV half statica**: il CronJob ricarica l'attuale DEV half ad ogni run; se il DEV cambia ma l'URL pointer no (es. puntando a `main` raw), la PR merge è sufficiente a propagare il cambiamento al prossimo run. Per produzione più rigida, pinnare al tag della release.
- **Container public-read**: il Blob è pubblico — il documento è di trasparenza per natura, non contiene segreti. Verificare con un revisore prima di pubblicare che nessun campo mappato includa PII o segreti applicativi.
- **No incident response**: il CronJob non è responsabile di policy/alerting; usa il normale failure budget del cluster.

## Vedi anche

- `docs/SERVICE-INVENTORY-GENERATION.md` — runbook completo (include ricette per GCP/AWS/self-hosted)
- `app/src/app/[locale]/service-inventory/page.tsx` — pagina che consuma il documento
- `app/public/tenants/videocall-test/service-inventory.json` — esempio completo DEV+OPS+declarations

{{/*
Chart name, truncated to 63 chars (Kubernetes label limit).
*/}}
{{- define "pa-webinar.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name.
If a fullnameOverride is set, use it. Otherwise compose from release + chart name.
Truncated to 63 chars.
*/}}
{{- define "pa-webinar.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label value: "name-version"
*/}}
{{- define "pa-webinar.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "pa-webinar.labels" -}}
helm.sh/chart: {{ include "pa-webinar.chart" . }}
{{ include "pa-webinar.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — used by Deployment matchLabels and Service selector.
*/}}
{{- define "pa-webinar.selectorLabels" -}}
app.kubernetes.io/name: {{ include "pa-webinar.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "pa-webinar.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "pa-webinar.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Container image reference: "repository:tag"
Defaults tag to Chart.appVersion if not set.
*/}}
{{- define "pa-webinar.image" -}}
{{- $tag := default .Chart.AppVersion .Values.app.image.tag -}}
{{- printf "%s:%s" .Values.app.image.repository $tag -}}
{{- end }}

{{/*
Migration container image reference: "repository:tag-migrate"
Uses the builder-stage image that includes npm/prisma CLI.
Defaults tag to Chart.appVersion + "-migrate" if not set.
*/}}
{{- define "pa-webinar.migrationImage" -}}
{{- $tag := .Values.app.migration.image.tag -}}
{{- if not $tag -}}
{{/*
  Stesso nome dell'immagine dell'applicazione con il suffisso: il rilascio
  pubblica il tag in questa forma. Storicamente pubblicava soltanto la forma
  con la `v` iniziale del tag git, e per quelle versioni il valore predefinito
  non si risolve: passa `app.migration.image.tag` esplicitamente, come fa la
  procedura di aggiornamento. Il nome calcolato qui non è mai cambiato, e non
  deve cambiare: c'è chi ha specchiato l'immagine nel proprio registro con
  questo nome.
*/}}
{{- $tag = printf "%s-migrate" (default .Chart.AppVersion .Values.app.image.tag) -}}
{{- end -}}
{{- printf "%s:%s" .Values.app.migration.image.repository $tag -}}
{{- end }}

{{/*
App URL for CronJob curl commands.
Points to the in-cluster Service.
*/}}
{{- define "pa-webinar.internalUrl" -}}
{{- printf "http://%s:%v" (include "pa-webinar.fullname" .) .Values.service.port -}}
{{- end }}

{{/*
Secret name — resolves the name of the Kubernetes Secret used by all resources.
Uses secrets.existingSecretName (new) with fallback to app.existingSecret (legacy).
*/}}
{{- define "pa-webinar.secretName" -}}
{{- .Values.secrets.existingSecretName | default .Values.app.existingSecret | default "videocall-secrets" -}}
{{- end }}

{{/*
Nome del Secret con le password dei datastore in cluster.
Tenuto distinto da quello dell'applicazione perché il sottochart PostgreSQL
monta per intero, come file dentro il container del database, il Secret da cui
legge la propria password.

Vuoto = stesso Secret dell'applicazione, che è il comportamento delle
installazioni esistenti: cambiarlo d'ufficio le manderebbe a cercare un Secret
che nessuno ha creato. La separazione si sceglie, valorizzando il campo.
*/}}
{{- define "pa-webinar.datastoreSecretName" -}}
{{- .Values.secrets.datastoreSecretName | default (include "pa-webinar.secretName" .) -}}
{{- end }}

{{/*
Nome del Service di un sottochart Bitnami, riprodotto come lo calcola lui
(`common.names.fullname`), override compresi.

Serve perche' l'indirizzo con cui l'applicazione raggiunge banca dati e Redis
lo compone questo chart: scriverlo a mano funziona solo finche' nessuno usa
`nameOverride` o `fullnameOverride`, e un host sbagliato non e' un errore di
resa ne' di apply — e' un pod che non parte, senza che niente dica quale
valore e' stato calcolato.

Attenzione ai default: i sottocharts dichiarano `nameOverride` con valore
vuoto, quindi la chiave ESISTE e il terzo argomento di `dig` non scatta mai.
Va usato `default`.

Argomenti: dict "nome" (il nome del chart) "valori" (i suoi valori) "release"
(il nome della release).
*/}}
{{- define "pa-webinar.subchartFullname" -}}
{{- $valori := .valori | default dict -}}
{{- $override := dig "fullnameOverride" "" $valori -}}
{{- if $override -}}
{{- $override | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $nome := default .nome (dig "nameOverride" "" $valori) -}}
{{- $rel := regexReplaceAll "(-?[^a-z\\d\\-])+-?" (lower .release) "-" -}}
{{- ternary $rel (printf "%s-%s" $rel $nome) (contains $nome $rel) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end }}

{{/*
Un pod ucciso da una disruption volontaria (drain di un nodo, eviction,
prelazione di una VM spot) non e` un fallimento del job: il lavoro non e`
stato svolto male, e` stato interrotto dall'infrastruttura. Senza questa
regola quel pod consuma il backoffLimit, il Job viene marcato Failed e
KubeJobFailed resta acceso per tutto il ttlSecondsAfterFinished.
L'aggiornamento automatico dell'immagine dei nodi ne produce una raffica a
ogni giro. I fallimenti veri (exit code non zero, deadline superata)
continuano a contare come prima.
Richiede restartPolicy: Never sul pod template.
*/}}
{{- define "pa-webinar.disruptionTolerantFailurePolicy" -}}
podFailurePolicy:
  rules:
    - action: Ignore
      onPodConditions:
        - type: DisruptionTarget
{{- end }}

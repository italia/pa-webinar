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

`status` e` obbligatorio dentro `onPodConditions`: senza, il server API
rifiuta il CronJob ("Required value: valid values: [False True Unknown]"). La
resa e la validazione lato client non se ne accorgono — e` una regola che
conosce solo il server, ed e` il motivo per cui il gate del chart fa anche
`kubectl apply --dry-run=server`.
*/}}
{{- define "pa-webinar.disruptionTolerantFailurePolicy" -}}
podFailurePolicy:
  rules:
    - action: Ignore
      onPodConditions:
        - type: DisruptionTarget
          status: "True"
{{- end }}

{{/*
Versione dell'API di External Secrets Operator per SecretStore ed ExternalSecret.

`secrets.external.apiVersion` la impone. Vuoto = quella che il cluster serve:
`v1` dove c'e' (l'operatore la introduce con la 0.16 e le versioni successive
smettono di servire `v1beta1`), `v1beta1` solo dove il cluster serve soltanto
quella. Senza un cluster da interrogare (`helm template`) vale `v1`.
*/}}
{{- define "pa-webinar.externalSecretsApiVersion" -}}
{{- $scelta := dig "apiVersion" "" (.Values.secrets.external | default dict) -}}
{{- if $scelta -}}
{{- $scelta -}}
{{- else if .Capabilities.APIVersions.Has "external-secrets.io/v1/ExternalSecret" -}}
external-secrets.io/v1
{{- else if .Capabilities.APIVersions.Has "external-secrets.io/v1beta1/ExternalSecret" -}}
external-secrets.io/v1beta1
{{- else -}}
external-secrets.io/v1
{{- end -}}
{{- end }}

{{/*
Il Service del sottochart espone l'API REST del bridge (porta 8080, dove
risponde /colibri/stats)?

Il sottochart rende un Service per il bridge solo senza hostPort e senza
hostNetwork, e la porta 8080 solo se la si aggiunge in `jvb.service.extraPorts`.
Restituisce "true" oppure niente.
*/}}
{{- define "pa-webinar.jvbRestFromSubchart" -}}
{{- $jvb := dig "jvb" dict (index .Values "jitsi-meet" | default dict) | default dict -}}
{{- $svc := dig "service" dict $jvb | default dict -}}
{{- $porta := false -}}
{{- range (dig "extraPorts" list $svc | default list) -}}
{{- if and (kindIs "map" .) (eq (toString (index . "port" | default "")) "8080") -}}
{{- $porta = true -}}
{{- end -}}
{{- end -}}
{{- if and (dig "enabled" false $svc) (not (dig "useHostPort" false $jvb)) (not (dig "useHostNetwork" false $jvb)) $porta -}}
true
{{- end -}}
{{- end }}

{{/*
Indirizzo con cui l'applicazione legge le statistiche del bridge
(JVB_HEALTH_URL): `jitsi.jvbHealthUrl` se indicato, altrimenti il Service del
sottochart quando espone la porta 8080, altrimenti il Service che questo chart
rende apposta (templates/jvb-rest-service.yaml).
*/}}
{{- define "pa-webinar.jvbHealthUrl" -}}
{{- if .Values.jitsi.jvbHealthUrl -}}
{{- .Values.jitsi.jvbHealthUrl -}}
{{- else if include "pa-webinar.jvbRestFromSubchart" . -}}
{{- printf "http://%s:8080" (include "pa-webinar.inClusterHost" (dict "nome" (printf "%s-jvb" (include "pa-webinar.jitsiFullname" .)) "root" .)) -}}
{{- else -}}
{{- printf "http://%s:8080" (include "pa-webinar.inClusterHost" (dict "nome" (printf "%s-jvb-rest" (include "pa-webinar.fullname" .)) "root" .)) -}}
{{- end -}}
{{- end }}

{{/*
Lo scaler dei bridge viene reso? Stessa condizione di
templates/cronjob-jvb-scaler.yaml, che la usa. Restituisce "true" oppure niente.

Da qui dipendono JVB_SCALER_ENABLED, il tetto dei bridge scritto per un bridge
fisso e il CronJob del ciclo di vita, che gira solo quando lo scaler non c'è.
*/}}
{{- define "pa-webinar.jvbScalerRendered" -}}
{{- if and .Values.jitsi.enabled (eq (default "simple" .Values.jitsi.mode) "full") .Values.jvbScaler.enabled -}}
true
{{- end -}}
{{- end }}

{{/*
Nome base delle risorse del sottochart jitsi-meet, calcolato come lo calcola
lui (`jitsi-meet.fullname`), override compresi. I Service si chiamano
`<nome base>-web`, `<nome base>-prosody`, `<nome base>-jvb` e così via.
*/}}
{{- define "pa-webinar.jitsiFullname" -}}
{{- $jm := index .Values "jitsi-meet" | default dict -}}
{{- $override := dig "fullnameOverride" "" $jm | default "" -}}
{{- if $override -}}
{{- $override | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $nome := dig "nameOverride" "" $jm | default "jitsi-meet" -}}
{{- if contains $nome .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $nome | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Nome di un Service della release nella forma completa
`<nome>.<namespace>.svc.<dominio del cluster>`.

Un Service che esiste si risolve subito in entrambe le forme. Uno che non
esiste no: il nome breve passa per tutti i domini di ricerca, compresi quelli
aziendali che il nodo eredita, e dove rispondono lenti la risoluzione fallita
costa secondi invece di frazioni di secondo, abbastanza da mandare una sonda
dell'applicazione al proprio limite di tempo.

Il dominio è `global.clusterDomain`, come per il sottochart jitsi-meet:
assente vale `cluster.local`, vuoto torna al nome breve.

Argomenti: dict "nome" (il nome del Service) "root" (il contesto del chart).
*/}}
{{- define "pa-webinar.inClusterHost" -}}
{{- $globale := .root.Values.global | default dict -}}
{{- $dominio := "cluster.local" -}}
{{- if hasKey $globale "clusterDomain" -}}
{{- $dominio = toString (index $globale "clusterDomain" | default "") -}}
{{- end -}}
{{- if $dominio -}}
{{- printf "%s.%s.svc.%s" .nome .root.Release.Namespace $dominio -}}
{{- else -}}
{{- .nome -}}
{{- end -}}
{{- end }}

{{/*
Indirizzi interni dei componenti della conferenza, per le sonde della pagina
di stato. Ciascuno si può imporre con il valore corrispondente in `jitsi.*`.
  - la parte web (external_api.js): il Service web del sottochart;
  - Prosody (/http-bind): il Service di Prosody del sottochart, porta BOSH;
  - Jicofo (/about/version): il Service che questo chart rende apposta
    (templates/jicofo-rest-service.yaml), perché il sottochart non ne ha;
  - Jibri: solo se Jibri è acceso o l'indirizzo è indicato, altrimenti
    niente: una sonda verso un Service inesistente costa un'attesa a ogni
    richiesta della pagina.
*/}}
{{- define "pa-webinar.jitsiWebInternalUrl" -}}
{{- if .Values.jitsi.webInternalUrl -}}
{{- .Values.jitsi.webInternalUrl -}}
{{- else -}}
{{- $jm := index .Values "jitsi-meet" | default dict -}}
{{- $porta := toString (dig "web" "service" "port" 80 $jm | default 80) -}}
{{- $host := include "pa-webinar.inClusterHost" (dict "nome" (printf "%s-web" (include "pa-webinar.jitsiFullname" .)) "root" .) -}}
{{- if eq $porta "80" -}}
{{- printf "http://%s" $host -}}
{{- else -}}
{{- printf "http://%s:%s" $host $porta -}}
{{- end -}}
{{- end -}}
{{- end }}

{{- define "pa-webinar.prosodyInternalUrl" -}}
{{- if .Values.jitsi.prosodyInternalUrl -}}
{{- .Values.jitsi.prosodyInternalUrl -}}
{{- else -}}
{{- $jm := index .Values "jitsi-meet" | default dict -}}
{{- $porta := toString (dig "prosody" "service" "ports" "bosh-insecure" 5280 $jm | default 5280) -}}
{{- printf "http://%s:%s" (include "pa-webinar.inClusterHost" (dict "nome" (printf "%s-prosody" (include "pa-webinar.jitsiFullname" .)) "root" .)) $porta -}}
{{- end -}}
{{- end }}

{{- define "pa-webinar.jicofoHealthUrl" -}}
{{- if .Values.jitsi.jicofoHealthUrl -}}
{{- .Values.jitsi.jicofoHealthUrl -}}
{{- else -}}
{{- printf "http://%s:8888" (include "pa-webinar.inClusterHost" (dict "nome" (printf "%s-jicofo-rest" (include "pa-webinar.fullname" .)) "root" .)) -}}
{{- end -}}
{{- end }}

{{- define "pa-webinar.jibriHealthUrl" -}}
{{- if .Values.jitsi.jibriHealthUrl -}}
{{- .Values.jitsi.jibriHealthUrl -}}
{{- else if and (dig "jibri" "enabled" false (index .Values "jitsi-meet" | default dict)) (not (dig "jibri" "useExternalJibri" false (index .Values "jitsi-meet" | default dict))) -}}
{{- printf "http://%s:2222" (include "pa-webinar.inClusterHost" (dict "nome" (printf "%s-jibri" (include "pa-webinar.jitsiFullname" .)) "root" .)) -}}
{{- end -}}
{{- end }}

{{/*
Autorità di certificazione in più per l'applicazione (app.extraCaCerts): un
Secret o un ConfigMap già presente nel namespace, di cui si monta una sola
chiave in sola lettura, indicata a Node con NODE_EXTRA_CA_CERTS. Serve a chi ha
SMTP, object storage o gli indirizzi pubblici del portale e della conferenza
dietro un'autorità interna. Node la legge all'avvio: dopo un cambio del file
serve un riavvio del pod.

Restituisce "true" se configurato, niente altrimenti; con Secret e ConfigMap
insieme la resa si ferma, perché non si saprebbe quale dei due vale.
*/}}
{{- define "pa-webinar.extraCaCerts" -}}
{{- $ca := dig "extraCaCerts" dict (.Values.app | default dict) | default dict -}}
{{- $secret := dig "secretName" "" $ca | default "" -}}
{{- $cm := dig "configMapName" "" $ca | default "" -}}
{{- if and $secret $cm -}}
{{- fail (printf "app.extraCaCerts indica sia secretName (%q) sia configMapName (%q): ne serve uno solo, quello che contiene il certificato dell'autorità (formato PEM, anche più certificati concatenati)." $secret $cm) -}}
{{- end -}}
{{- if or $secret $cm -}}
true
{{- end -}}
{{- end }}

{{- define "pa-webinar.extraCaCertsDir" -}}
/etc/pa-webinar/extra-ca
{{- end }}

{{- define "pa-webinar.extraCaCertsFile" -}}
ca-bundle.pem
{{- end }}

{{/*
ConfigMap con i moduli Prosody del progetto (templates/configmap-prosody-plugins.yaml).
Il nome è fisso perché lo nomina `jitsi-meet.prosody.extraVolumes` in
values.yaml, e i valori di un sottochart non possono calcolarlo.
*/}}
{{- define "pa-webinar.prosodyPluginsConfigMap" -}}
pa-webinar-prosody-plugins
{{- end }}

{{/*
Un volume di Prosody monta quel ConfigMap in /prosody-plugins-custom?
Restituisce "true" oppure niente.
*/}}
{{- define "pa-webinar.prosodyPluginsMounted" -}}
{{- $prosody := dig "prosody" dict (index .Values "jitsi-meet" | default dict) | default dict -}}
{{- $cm := include "pa-webinar.prosodyPluginsConfigMap" . -}}
{{- $volumi := list -}}
{{- range (dig "extraVolumes" list $prosody | default list) -}}
{{- if and (kindIs "map" .) (eq (toString (dig "configMap" "name" "" .)) $cm) -}}
{{- $volumi = append $volumi (toString (index . "name")) -}}
{{- end -}}
{{- end -}}
{{- $montato := false -}}
{{- range (dig "extraVolumeMounts" list $prosody | default list) -}}
{{- if and (kindIs "map" .) (has (toString (index . "name" | default "")) $volumi) (hasPrefix "/prosody-plugins-custom" (toString (index . "mountPath" | default ""))) -}}
{{- $montato = true -}}
{{- end -}}
{{- end -}}
{{- if $montato -}}
true
{{- end -}}
{{- end }}

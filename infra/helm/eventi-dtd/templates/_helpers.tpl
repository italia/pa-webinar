{{/*
Chart name, truncated to 63 chars (Kubernetes label limit).
*/}}
{{- define "eventi-dtd.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name.
If a fullnameOverride is set, use it. Otherwise compose from release + chart name.
Truncated to 63 chars.
*/}}
{{- define "eventi-dtd.fullname" -}}
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
{{- define "eventi-dtd.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "eventi-dtd.labels" -}}
helm.sh/chart: {{ include "eventi-dtd.chart" . }}
{{ include "eventi-dtd.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — used by Deployment matchLabels and Service selector.
*/}}
{{- define "eventi-dtd.selectorLabels" -}}
app.kubernetes.io/name: {{ include "eventi-dtd.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "eventi-dtd.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "eventi-dtd.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Container image reference: "repository:tag"
Defaults tag to Chart.appVersion if not set.
*/}}
{{- define "eventi-dtd.image" -}}
{{- $tag := default .Chart.AppVersion .Values.app.image.tag -}}
{{- printf "%s:%s" .Values.app.image.repository $tag -}}
{{- end }}

{{/*
Migration container image reference: "repository:tag-migrate"
Uses the builder-stage image that includes npm/prisma CLI.
Defaults tag to Chart.appVersion + "-migrate" if not set.
*/}}
{{- define "eventi-dtd.migrationImage" -}}
{{- $tag := .Values.app.migration.image.tag -}}
{{- if not $tag -}}
{{- $tag = printf "%s-migrate" (default .Chart.AppVersion .Values.app.image.tag) -}}
{{- end -}}
{{- printf "%s:%s" .Values.app.migration.image.repository $tag -}}
{{- end }}

{{/*
App URL for CronJob curl commands.
Points to the in-cluster Service.
*/}}
{{- define "eventi-dtd.internalUrl" -}}
{{- printf "http://%s:%v" (include "eventi-dtd.fullname" .) .Values.service.port -}}
{{- end }}

{{/*
Secret name — resolves the name of the Kubernetes Secret used by all resources.
Uses secrets.existingSecretName (new) with fallback to app.existingSecret (legacy).
*/}}
{{- define "eventi-dtd.secretName" -}}
{{- .Values.secrets.existingSecretName | default .Values.app.existingSecret | default "videocall-secrets" -}}
{{- end }}

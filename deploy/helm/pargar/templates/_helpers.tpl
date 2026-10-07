{{/*
Expand the name of the chart.
*/}}
{{- define "pargar.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "pargar.fullname" -}}
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

{{- define "pargar.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "pargar.labels" -}}
helm.sh/chart: {{ include "pargar.chart" . }}
{{ include "pargar.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "pargar.selectorLabels" -}}
app.kubernetes.io/name: {{ include "pargar.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "pargar.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "pargar.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "pargar.appSecretName" -}}
{{- if .Values.backend.existingSecret }}
{{- .Values.backend.existingSecret }}
{{- else }}
{{- printf "%s-app" (include "pargar.fullname" .) }}
{{- end }}
{{- end }}

{{- define "pargar.postgresSecretName" -}}
{{- if .Values.postgres.existingSecret }}
{{- .Values.postgres.existingSecret }}
{{- else }}
{{- printf "%s-postgres" (include "pargar.fullname" .) }}
{{- end }}
{{- end }}

{{- define "pargar.redisSecretName" -}}
{{- if .Values.redis.existingSecret }}
{{- .Values.redis.existingSecret }}
{{- else }}
{{- printf "%s-redis" (include "pargar.fullname" .) }}
{{- end }}
{{- end }}

{{- define "pargar.rustfsSecretName" -}}
{{- if .Values.rustfs.existingSecret }}
{{- .Values.rustfs.existingSecret }}
{{- else }}
{{- printf "%s-rustfs" (include "pargar.fullname" .) }}
{{- end }}
{{- end }}

{{- define "pargar.tlsSecretName" -}}
{{- if .Values.ingress.tls.existingSecret }}
{{- .Values.ingress.tls.existingSecret }}
{{- else }}
{{- printf "%s-tls" (include "pargar.fullname" .) }}
{{- end }}
{{- end }}

{{- define "pargar.postgresHost" -}}
{{- printf "%s-postgres" (include "pargar.fullname" .) }}
{{- end }}

{{- define "pargar.redisHost" -}}
{{- printf "%s-redis" (include "pargar.fullname" .) }}
{{- end }}

{{- define "pargar.rustfsHost" -}}
{{- printf "%s-rustfs" (include "pargar.fullname" .) }}
{{- end }}

{{/*
Resolve container image: optional global.imageRegistry + repository:tag
Usage: {{ include "pargar.image" (dict "root" . "image" .Values.backend.image) }}
*/}}
{{- define "pargar.image" -}}
{{- $registry := .root.Values.global.imageRegistry | default "" -}}
{{- $repo := .image.repository -}}
{{- $tag := .image.tag | default .root.Chart.AppVersion | toString -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" (trimSuffix "/" $registry) $repo $tag -}}
{{- else -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
{{- end }}

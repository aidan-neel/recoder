{{- define "recoder.name" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 54 | trimSuffix "-" -}}
{{- end -}}

{{- define "recoder.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end -}}

{{/*
Coerenza fra la soppressione rumore avanzata e l'immagine web servita.

La soppressione avanzata funziona solo con l'immagine web patchata, che forza a
48 kHz il contesto audio del filtro. Sull'immagine standard lo stesso filtro
ammutolisce il microfono di alcuni partecipanti senza alcun errore: nessun log,
nessun avviso nell'interfaccia, e ce se ne accorge a evento iniziato.

Le due impostazioni vivono in punti distanti del file dei valori — una è una
variabile d'ambiente dell'applicazione, l'altra il riferimento a un'immagine del
sottochart — quindi è facile cambiarne una e non l'altra. Qui l'incoerenza
diventa un errore di resa, cioè un aggiornamento che si ferma prima di partire
invece di un evento con i microfoni muti.

Il valore predefinito dell'applicazione è "spenta": si accende solo scrivendo
esattamente `"false"` (il nome della variabile è un doppio negativo).

Chi ricostruisce la patch e la pubblica con un nome proprio lo dichiara con
`jitsi.patchedWebImage: true`: il nome dell'immagine non è un criterio
sufficiente, ed è giusto che il chart non pretenda di riconoscerla. Senza
dichiarazione il riconoscimento è automatico e vale solo per l'immagine
pubblicata da questo progetto.
*/}}
{{- define "pa-webinar.validateRnnoise" -}}
{{- $enforceOff := dig "env" "NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE" "" (.Values.app | default dict) -}}
{{- if eq (lower (trim (toString $enforceOff))) "false" -}}
{{- $web := dig "web" "image" "repository" "" (index .Values "jitsi-meet" | default dict) -}}
{{- $dichiarata := dig "patchedWebImage" nil (.Values.jitsi | default dict) -}}
{{- $patchata := ternary $dichiarata (contains "pa-webinar-jitsi-web" $web) (kindIs "bool" $dichiarata) -}}
{{- if not $patchata -}}
{{- fail (printf "NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE è \"false\", cioè la soppressione rumore avanzata è ACCESA, ma l'immagine web servita (%s) non risulta patchata a 48 kHz: su alcuni browser i microfoni resterebbero muti senza alcun errore, e ce se ne accorge a evento iniziato. Spegni la soppressione togliendo quella variabile, oppure — se l'immagine è patchata ma pubblicata con un nome tuo — dichiaralo con jitsi.patchedWebImage=true." (default "predefinita del sottochart" $web)) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Coerenza fra il Secret dei datastore e i sottocharts che lo leggono.

Spostare le password in un Secret dedicato richiede due mosse: valorizzare
`secrets.datastoreSecretName` e puntarci anche `postgresql.auth.existingSecret`
e `redis.auth.existingSecret`. Farne una sola lascia i datastore a cercare la
password dove non c'è più, e il guasto arriva all'avvio del pod, staccato dalla
modifica che l'ha causato.

La mossa mancante può essere l'una o l'altra, e vanno riconosciute entrambe:
manca il puntamento dei sottocharts, oppure manca il Secret che li servirebbe.
Il secondo caso si può affermare solo in modalità `generate`, dove è il chart a
rendere i Secret; con `existing` ed `external` il Secret dei datastore è
legittimamente creato fuori dal chart e il suo nome non deve corrispondere a
niente di reso qui.
*/}}
{{- define "pa-webinar.validateDatastoreSecret" -}}
{{- $scelto := .Values.secrets.datastoreSecretName | default "" -}}
{{- $reso := eq .Values.secrets.mode "generate" -}}
{{- $applicativo := include "pa-webinar.secretName" . -}}
{{- if and $reso (not $scelto) -}}
{{/*
  Nessun Secret dedicato richiesto: in modalità `generate` le password finiscono
  nel Secret dell'applicazione, quindi un sottochart che ne indica un altro
  resterebbe in ContainerCreating su un Secret che nessun template rende.
*/}}
{{- if dig "enabled" false (.Values.postgresql | default dict) -}}
{{- $pgSecret := dig "auth" "existingSecret" "" (.Values.postgresql | default dict) -}}
{{- if and $pgSecret (ne $pgSecret $applicativo) -}}
{{- fail (printf "postgresql.auth.existingSecret è %q ma secrets.datastoreSecretName è vuoto: in modalità \"generate\" le password vengono rese in %q e nessun template rende %q, quindi il pod del database resterebbe in ContainerCreating su un Secret inesistente. Valorizza secrets.datastoreSecretName con lo stesso nome, oppure svuota postgresql.auth.existingSecret." $pgSecret $applicativo $pgSecret) -}}
{{- end -}}
{{- end -}}
{{- if dig "enabled" false (.Values.redis | default dict) -}}
{{- $redisSecret := dig "auth" "existingSecret" "" (.Values.redis | default dict) -}}
{{- if and $redisSecret (ne $redisSecret $applicativo) -}}
{{- fail (printf "redis.auth.existingSecret è %q ma secrets.datastoreSecretName è vuoto: in modalità \"generate\" la password viene resa in %q e nessun template rende %q, quindi il pod di Redis resterebbe in ContainerCreating su un Secret inesistente. Valorizza secrets.datastoreSecretName con lo stesso nome, oppure svuota redis.auth.existingSecret." $redisSecret $applicativo $redisSecret) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- if and $scelto (ne $scelto $applicativo) -}}
{{- if dig "enabled" false (.Values.postgresql | default dict) -}}
{{- $pgSecret := dig "auth" "existingSecret" "" (.Values.postgresql | default dict) -}}
{{- if ne $pgSecret $scelto -}}
{{- fail (printf "secrets.datastoreSecretName è %q ma postgresql.auth.existingSecret è %q: il database cercherebbe la password in un Secret che non la contiene più. Allinea i due valori." $scelto (default "(vuoto)" $pgSecret)) -}}
{{- end -}}
{{- end -}}
{{- if dig "enabled" false (.Values.redis | default dict) -}}
{{- $redisSecret := dig "auth" "existingSecret" "" (.Values.redis | default dict) -}}
{{- if ne $redisSecret $scelto -}}
{{- fail (printf "secrets.datastoreSecretName è %q ma redis.auth.existingSecret è %q: Redis cercherebbe la password in un Secret che non la contiene più. Allinea i due valori." $scelto (default "(vuoto)" $redisSecret)) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

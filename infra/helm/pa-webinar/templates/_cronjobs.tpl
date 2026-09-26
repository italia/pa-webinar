{{- /*
Opzioni di curl comuni ai CronJob che chiamano il portale (/api/cron/*,
/api/internal/*). All'avvio a freddo (prima installazione, nodo riavviato,
migrazioni in corso) il portale non risponde per un minuto o più: il Service
non ha ancora pod pronti e la connessione è rifiutata, poi arrivano 502 e 503
finché l'applicazione non è su. Con pochi tentativi i primi giri finivano in
errore e lasciavano pod in Error per ore. Qui curl riprova ogni 5 secondi,
per al massimo `cronjobs.portalRetrySeconds`, le connessioni rifiutate e gli
errori transitori (timeout, 408, 429, 500, 502, 503, 504); una risposta buona
interrompe subito i tentativi. Un 401, 403 o 404 (chiave sbagliata, rotta
assente) fallisce subito: ripeterlo non lo cura e nasconderebbe l'errore. Le rotte sono idempotenti (le
chiama ogni minuto il CronJob stesso), quindi ripetere una richiesta fallita
non fa danni. scripts/validate-chart.sh controlla che ogni CronJob che chiama
il portale usi queste opzioni e che la finestra stia nella sua scadenza.
*/}}
{{- define "pa-webinar.cronCurlRetry" -}}
{{- $secondi := int (dig "portalRetrySeconds" 90 (.Values.cronjobs | default dict)) -}}
{{- if lt $secondi 5 }}{{ $secondi = 5 }}{{ end -}}
--retry {{ add1 (div $secondi 5) }} --retry-delay 5 --retry-max-time {{ $secondi }} --retry-connrefused --connect-timeout 5
{{- end }}

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

{{/*
La conferenza deve poter verificare i token dell'applicazione.

Con l'autenticazione a token Prosody accetta solo token firmati con il segreto
che riceve, emessi da un issuer e per un'audience che conosce. Se manca uno dei
tre, rifiuta ogni ingresso, e il portale mostra una sala che non si apre senza
dire perche'. L'errore di resa lo dice prima dell'installazione.

Il segreto arriva a Prosody come variabile JWT_APP_SECRET, e le strade valide
sono piu' d'una: `jwt.secret` (il sottochart rende il Secret), `jwt.existingSecretName`
(un Secret con quella chiave, creato a mano o reso da questo chart con
`secrets.jitsiJwtSecretName`), una voce JWT_APP_SECRET in `prosody.extraSecrets`,
un `prosody.extraEnvFrom` o il `releaseSecretsOverride` del sottochart, una
variabile JWT_APP_SECRET in `prosody.extraEnvs` o in `extraCommonEnvs` (il
sottochart la mette nel ConfigMap comune, che Prosody carica). Di
`extraEnvFrom` e `releaseSecretsOverride` non si vede il contenuto: si accettano
sulla fiducia, perche' rifiutarle bloccherebbe l'aggiornamento di installazioni
che funzionano.

Gli identificativi (AUTH_TYPE, JWT_APP_ID, JWT_ACCEPTED_ISSUERS,
JWT_ACCEPTED_AUDIENCES) il chart li imposta in `prosody.extraEnvs`, che per
Prosody vince su `extraCommonEnvs`: un valore diverso messo solo li' verrebbe
ignorato in silenzio.
*/}}
{{- define "pa-webinar.validateJitsiJwt" -}}
{{- if .Values.jitsi.enabled }}
{{- $jm := index .Values "jitsi-meet" | default dict }}
{{- $prosody := dig "prosody" dict $jm | default dict }}
{{- $jwt := dig "jwt" dict $prosody | default dict }}
{{- $envs := dig "extraEnvs" dict $prosody | default dict }}
{{- $comuni := dig "extraCommonEnvs" dict $jm | default dict }}
{{- range $chiave := list "AUTH_TYPE" "JWT_APP_ID" "JWT_ACCEPTED_ISSUERS" "JWT_ACCEPTED_AUDIENCES" }}
{{- $locale := toString (index $envs $chiave | default "") }}
{{- $comune := toString (index $comuni $chiave | default "") }}
{{- if and $locale $comune (ne $locale $comune) }}
{{- fail (printf "jitsi-meet.extraCommonEnvs.%s è %q ma Prosody riceve %q da jitsi-meet.prosody.extraEnvs.%s, che vince: il valore comune verrebbe ignorato senza errori, e con un issuer o un'audience diversi da quelli dell'applicazione nessuno entrerebbe in sala. Imposta il valore in jitsi-meet.prosody.extraEnvs.%s." $chiave $comune $locale $chiave $chiave) }}
{{- end }}
{{- end }}
{{- $authType := lower (toString (index $envs "AUTH_TYPE" | default (index $comuni "AUTH_TYPE") | default "")) }}
{{- if and (dig "enableAuth" false $jm) (eq $authType "jwt") }}
{{- if and $jwt.secret $jwt.existingSecretName }}
{{- fail (printf "jitsi-meet.prosody.jwt.secret e jitsi-meet.prosody.jwt.existingSecretName (%q) sono entrambi valorizzati: il sottochart usa il Secret indicato e ignora il segreto passato, senza dirlo. Tieni uno solo dei due: togli existingSecretName (anche se arriva da un file di valori di esempio) oppure il segreto." (toString $jwt.existingSecretName)) }}
{{- end }}
{{- $daExtraSecrets := false }}
{{- range (dig "extraSecrets" list $prosody | default list) }}
{{- if and (kindIs "map" .) (eq (toString (index . "name" | default "")) "JWT_APP_SECRET") }}
{{- $daExtraSecrets = true }}
{{- end }}
{{- end }}
{{- $daEnvFrom := not (empty (dig "extraEnvFrom" list $prosody)) }}
{{- $override := false }}
{{- range $globale := list (.Values.global | default dict) (dig "global" dict $jm | default dict) }}
{{- $rso := dig "releaseSecretsOverride" dict $globale | default dict }}
{{- if and (dig "enabled" false $rso) (not (empty (dig "extraEnvFrom" list $rso))) }}
{{- $override = true }}
{{- end }}
{{- end }}
{{- if not (or $jwt.secret $jwt.existingSecretName $daExtraSecrets $daEnvFrom $override (index $envs "JWT_APP_SECRET") (index $comuni "JWT_APP_SECRET")) }}
{{- fail "jitsi-meet.enableAuth è attivo con AUTH_TYPE=jwt ma Prosody non ha il segreto per verificare i token: nessuno entrerebbe in sala. Indica jitsi-meet.prosody.jwt.secret con lo stesso valore di JITSI_JWT_SECRET, oppure jitsi-meet.prosody.jwt.existingSecretName con il nome di un Secret che ha la chiave JWT_APP_SECRET (in modalità \"generate\" o \"external\" lo rende il chart se secrets.jitsiJwtSecretName ha lo stesso nome), oppure una voce JWT_APP_SECRET in jitsi-meet.prosody.extraSecrets." }}
{{- end }}
{{- $reso := toString (.Values.secrets.jitsiJwtSecretName | default "") }}
{{- if and $reso (has .Values.secrets.mode (list "generate" "external")) $jwt.existingSecretName (ne (toString $jwt.existingSecretName) $reso) }}
{{- fail (printf "jitsi-meet.prosody.jwt.existingSecretName è %q ma il chart rende il segreto JWT con il nome di secrets.jitsiJwtSecretName (%q): Prosody leggerebbe un altro Secret. Allinea i due valori, oppure svuota secrets.jitsiJwtSecretName se il Secret %q lo crei tu." (toString $jwt.existingSecretName) $reso (toString $jwt.existingSecretName)) }}
{{- end }}
{{- if eq .Values.secrets.mode "generate" }}
{{- $gen := .Values.secrets.generate | default dict }}
{{- range $coppia := list (list "JITSI_JWT_ISSUER" "JWT_ACCEPTED_ISSUERS") (list "JITSI_JWT_AUDIENCE" "JWT_ACCEPTED_AUDIENCES") }}
{{- $app := toString (index $gen (index $coppia 0) | default "") }}
{{- $accettati := toString (index $envs (index $coppia 1) | default (index $comuni (index $coppia 1)) | default "") }}
{{- $lista := list }}
{{- range (splitList "," $accettati) }}
{{- $lista = append $lista (trim .) }}
{{- end }}
{{- if and $app $accettati (not (has $app $lista)) (not (has "*" $lista)) }}
{{- fail (printf "secrets.generate.%s è %q ma Prosody accetta solo %q (jitsi-meet.prosody.extraEnvs.%s): rifiuterebbe ogni token dell'applicazione e nessuno entrerebbe in sala. Allinea i due valori." (index $coppia 0) $app $accettati (index $coppia 1)) }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end -}}

{{/*
Credenziali interne della conferenza lasciate al caso.

Il sottochart genera con `randAlphaNum`, a ogni resa, ogni password XMPP interna
(Jicofo, bridge, Jibri, bot di registrazione, jigasi) e il segreto statico di
coturn che non ricevono un valore o un Secret esistente. I Secret cambiano a
ogni `helm upgrade`, Prosody porta la loro impronta nel template del pod, e
Prosody, Jicofo e il bridge ripartono: le conferenze in corso cadono, anche per
un aggiornamento che non tocca la conferenza.

Restituisce i percorsi dei valori non fissati, separati da virgola; vuoto se
sono tutti fissati.
*/}}
{{- define "pa-webinar.jitsiUnpinnedCredentials" -}}
{{- $jm := index .Values "jitsi-meet" | default dict -}}
{{- $voci := list
      (list true "jicofo" "xmpp" "password")
      (list true "jvb" "xmpp" "password")
      (list (dig "jibri" "enabled" false $jm) "jibri" "xmpp" "password")
      (list (dig "jibri" "enabled" false $jm) "jibri" "recorder" "password")
      (list (dig "coturn" "enabled" false $jm) "coturn" "staticAuth" "secret")
      (list (or (dig "jigasi" "enabled" false $jm) (dig "transcriber" "enabled" false $jm)) "jigasi" "xmpp" "password")
      (list (dig "transcriber" "enabled" false $jm) "transcriber" "xmpp" "password") -}}
{{- $mancanti := list -}}
{{- range $voce := $voci -}}
{{- if index $voce 0 -}}
{{- $blocco := dig (index $voce 1) (index $voce 2) dict $jm | default dict -}}
{{- if not (or (index $blocco (index $voce 3)) (index $blocco "existingSecretName")) -}}
{{- $mancanti = append $mancanti (printf "jitsi-meet.%s.%s.%s" (index $voce 1) (index $voce 2) (index $voce 3)) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- join ", " $mancanti -}}
{{- end -}}

{{/*
Chi lo chiede (i profili di esempio lo fanno) vuole che quelle credenziali
siano fissate: la resa si ferma, con l'elenco di cosa manca. Senza la richiesta
il chart avvisa soltanto, nelle note dopo l'installazione, perche' fermare
l'aggiornamento di un'installazione esistente sarebbe peggio del difetto.
*/}}
{{- define "pa-webinar.validateJitsiCredentials" -}}
{{- if and .Values.jitsi.enabled (dig "requirePinnedCredentials" false (.Values.jitsi | default dict)) -}}
{{- $mancanti := include "pa-webinar.jitsiUnpinnedCredentials" . -}}
{{- if $mancanti -}}
{{- fail (printf "Queste credenziali interne della conferenza non sono fissate: %s. Il sottochart le rigenera a caso a ogni resa, e ogni helm upgrade riavvierebbe Prosody, Jicofo e il bridge facendo cadere le conferenze in corso. Generale una volta (per esempio con openssl rand -hex 16), conservale con gli altri segreti e passale a ogni aggiornamento, oppure indica per ciascuna un Secret esistente con existingSecretName." $mancanti) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Classe dell'Ingress e annotazione di classe devono coincidere.

Il controller che serve un Ingress lo sceglie `spec.ingressClassName`;
l'annotazione `kubernetes.io/ingress.class` e' la forma precedente. Se sono
entrambe presenti e diverse, alla prima installazione l'API server rifiuta
l'Ingress; in un aggiornamento lo accetta, e l'host passa in silenzio al
controller della classe: se quel controller nel cluster non c'e', il portale o
la conferenza smettono di rispondere. Succede a chi sceglie il controller con
l'annotazione e lascia la classe predefinita (`nginx`). Qui diventa un errore
di resa, con l'indicazione di cosa cambiare.

Un'annotazione impostata a null senza un valore predefinito da togliere resta
nel manifesto come null, che l'API server legge come stringa vuota: per la
conferenza conta come diversa dalla classe. L'Ingress del portale invece le
annotazioni a null non le rende.
*/}}
{{- define "pa-webinar.validateIngressClass" -}}
{{- $casi := list -}}
{{- if .Values.ingress.enabled -}}
{{- $casi = append $casi (list "ingress.className" .Values.ingress.className "ingress.annotations" .Values.ingress.annotations false) -}}
{{- end -}}
{{- if .Values.jitsi.enabled -}}
{{- $web := dig "web" "ingress" dict (index .Values "jitsi-meet" | default dict) | default dict -}}
{{- if dig "enabled" false $web -}}
{{- $casi = append $casi (list "jitsi-meet.web.ingress.ingressClassName" (index $web "ingressClassName") "jitsi-meet.web.ingress.annotations" (index $web "annotations") true) -}}
{{- end -}}
{{- $ci := dig "conferenceIngress" dict (.Values.jitsi | default dict) | default dict -}}
{{- if dig "enabled" false $ci -}}
{{- $casi = append $casi (list "jitsi.conferenceIngress.className" ((index $ci "className") | default .Values.ingress.className) "jitsi.conferenceIngress.annotations" (index $ci "annotations") false) -}}
{{- end -}}
{{- $redirect := .Values.jitsi.webIngress | default dict -}}
{{- if dig "redirectUrl" "" $redirect -}}
{{- $casi = append $casi (list "jitsi.webIngress.ingressClassName" (index $redirect "ingressClassName") "jitsi.webIngress.annotations" (index $redirect "annotations") true) -}}
{{- end -}}
{{- end -}}
{{- range $caso := $casi -}}
{{- $classe := toString (index $caso 1 | default "") -}}
{{- $ann := index $caso 3 | default dict -}}
{{- $vecchia := index $ann "kubernetes.io/ingress.class" -}}
{{- $conta := or (index $caso 4) (not (kindIs "invalid" $vecchia)) -}}
{{- if and $classe (hasKey $ann "kubernetes.io/ingress.class") $conta (ne (ternary "" (toString $vecchia) (kindIs "invalid" $vecchia)) $classe) -}}
{{- fail (printf "%s è %q ma %s.kubernetes.io/ingress.class è %q. Il controller lo sceglie la classe: l'host passerebbe al controller %q, e se nel cluster non c'è smetterebbe di rispondere; a una nuova installazione l'API server rifiuta l'Ingress. Indica il controller solo nella classe (%s=%s) e togli l'annotazione kubernetes.io/ingress.class dal tuo file di valori." (index $caso 0) $classe (index $caso 2) (ternary "" (toString $vecchia) (kindIs "invalid" $vecchia)) $classe (index $caso 0) (ternary "<classe>" (toString $vecchia) (kindIs "invalid" $vecchia))) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Chi è moderatore nella sala lo decide il token del portale.

Due pezzi lavorano insieme. Jicofo senza autenticazione propria
(`jicofo.extraEnvs.JICOFO_ENABLE_AUTH: "false"`): con l'autenticazione accesa
rende moderatore chiunque sia autenticato, cioè ogni partecipante con un token.
E Prosody con i moduli che assegnano il ruolo dal token (`XMPP_MUC_MODULES`
con `token_affiliation`, e il modulo del progetto `token_affiliation_custom`).

Due incoerenze si vedono solo in sala, e qui diventano errori di resa:
  - Jicofo senza autenticazione ma Prosody senza i moduli: nessuno sarebbe
    moderatore, e il moderatore del portale non potrebbe silenziare né
    espellere nessuno;
  - il modulo del progetto richiesto ma non montato in /prosody-plugins-custom:
    Prosody non lo troverebbe, e lo direbbe solo nel proprio log. Succede a chi
    imposta `prosody.extraVolumes` o `extraVolumeMounts` in un proprio file di
    valori: sono liste, e sostituiscono quelle del chart.
*/}}
{{- define "pa-webinar.validateJitsiRoles" -}}
{{- if .Values.jitsi.enabled -}}
{{- $jm := index .Values "jitsi-meet" | default dict -}}
{{- $prosody := dig "prosody" dict $jm | default dict -}}
{{- $envs := dig "extraEnvs" dict $prosody | default dict -}}
{{- $comuni := dig "extraCommonEnvs" dict $jm | default dict -}}
{{- $moduli := list -}}
{{- range (splitList "," (toString (index $envs "XMPP_MUC_MODULES" | default (index $comuni "XMPP_MUC_MODULES") | default ""))) -}}
{{- $moduli = append $moduli (trim .) -}}
{{- end -}}
{{- $jicofo := dig "jicofo" "extraEnvs" dict $jm | default dict -}}
{{- $authJicofo := lower (toString (index $jicofo "JICOFO_ENABLE_AUTH" | default "")) -}}
{{- if and (dig "enableAuth" false $jm) (has $authJicofo (list "false" "0")) (not (or (has "token_affiliation" $moduli) (has "token_affiliation_custom" $moduli))) -}}
{{- fail "jitsi-meet.jicofo.extraEnvs.JICOFO_ENABLE_AUTH è \"false\" ma Prosody non assegna i ruoli dal token: jitsi-meet.prosody.extraEnvs.XMPP_MUC_MODULES non contiene token_affiliation. Nessuno sarebbe moderatore nella sala, e il moderatore del portale non potrebbe silenziare né espellere nessuno. Rimetti in XMPP_MUC_MODULES token_affiliation,token_affiliation_custom (più i tuoi moduli), come in values.yaml." -}}
{{- end -}}
{{- if has "token_affiliation_custom" $moduli -}}
{{- $montato := false -}}
{{- range (dig "extraVolumeMounts" list $prosody | default list) -}}
{{- if and (kindIs "map" .) (hasPrefix "/prosody-plugins-custom" (toString (index . "mountPath" | default ""))) -}}
{{- $montato = true -}}
{{- end -}}
{{- end -}}
{{- if not $montato -}}
{{- fail (printf "jitsi-meet.prosody.extraEnvs.XMPP_MUC_MODULES chiede il modulo token_affiliation_custom, ma nessun volume di Prosody è montato in /prosody-plugins-custom: Prosody non lo troverebbe. Succede quando un file di valori imposta jitsi-meet.prosody.extraVolumes o extraVolumeMounts, che sono liste e sostituiscono quelle del chart: aggiungi alle tue le due voci di values.yaml (il volume dal ConfigMap %s e il suo montaggio in /prosody-plugins-custom), oppure togli token_affiliation_custom da XMPP_MUC_MODULES." (include "pa-webinar.prosodyPluginsConfigMap" .)) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
I nomi pubblici scritti una volta (site.portalHost, site.conferenceHost) e le
chiavi esplicite devono dire la stessa cosa.

Oggi lo stesso nome si scrive in cinque o sette chiavi di forma diversa, e
un nome sbagliato in una sola non ferma niente: il portale genera link verso
un indirizzo e risponde su un altro, o la sala non si apre. Con site.* il
chart ricava le chiavi che rende lui; quelle scritte a mano restano ammesse
ma devono coincidere, e i valori di esempio di values.yaml contano come non
scritti.

Due chiavi del sottochart della conferenza non si possono ricavare, perché
Helm passa i valori di un sottochart così come sono scritti: jitsi-meet.
publicURL e, con l'Ingress del sottochart, i suoi host. Qui si confrontano, e
il messaggio dice la riga da scrivere.
*/}}
{{- define "pa-webinar.validateSite" -}}
{{- $formato := "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$" -}}
{{- $portale := include "pa-webinar.sitePortalHost" . -}}
{{- $conferenza := include "pa-webinar.siteConferenceHost" . -}}
{{- range $voce := list (list "site.portalHost" $portale "webinar.ente.it") (list "site.conferenceHost" $conferenza "meet.ente.it") -}}
{{- $v := index $voce 1 -}}
{{- if and $v (or (not (regexMatch $formato $v)) (gt (len $v) 253)) -}}
{{- fail (printf "%s è %q: serve un nome DNS in minuscolo, senza schema, porta né percorso (per esempio %s). Il chart ne ricava gli indirizzi https://." (index $voce 0) $v (index $voce 2)) -}}
{{- end -}}
{{- end -}}
{{- if and $portale (eq $portale $conferenza) -}}
{{- fail (printf "site.portalHost e site.conferenceHost sono entrambi %q: portale e conferenza servono due nomi distinti, perché entrambi rispondono sul percorso / del proprio nome." $portale) -}}
{{- end -}}
{{- $env := .Values.app.env | default dict -}}
{{- if $portale -}}
{{- $url := trimSuffix "/" (toString (index $env "NEXT_PUBLIC_APP_URL" | default "")) -}}
{{- if and $url (not (include "pa-webinar.segnaposto" $url)) (ne $url (printf "https://%s" $portale)) -}}
{{- fail (printf "app.env.NEXT_PUBLIC_APP_URL è %q ma site.portalHost è %q: il portale genererebbe link e inviti verso un indirizzo e risponderebbe su un altro. Togli app.env.NEXT_PUBLIC_APP_URL, che il chart ricava da site.portalHost, oppure scrivi https://%s." $url $portale $portale) -}}
{{- end -}}
{{- if .Values.ingress.enabled -}}
{{- if gt (len (.Values.ingress.hosts | default list)) 1 -}}
{{- fail (printf "ingress.hosts ha %d voci ma site.portalHost è impostato: il chart riscrive ogni voce con %q e l'Ingress avrebbe più regole per lo stesso nome. Lascia una sola voce in ingress.hosts (con tutti i percorsi) oppure togli site.portalHost." (len .Values.ingress.hosts) $portale) -}}
{{- end -}}
{{- range (.Values.ingress.hosts | default list) -}}
{{- $h := toString (dig "host" "" (. | default dict) | default "") -}}
{{- if and $h (not (include "pa-webinar.segnaposto" $h)) (ne $h $portale) -}}
{{- fail (printf "ingress.hosts contiene %q ma site.portalHost è %q: l'Ingress del portale risponderebbe su un nome che l'applicazione non usa. Togli ingress.hosts, che il chart ricava da site.portalHost, oppure scrivi lo stesso nome." $h $portale) -}}
{{- end -}}
{{- end -}}
{{- range (.Values.ingress.tls | default list) -}}
{{- range (dig "hosts" list (. | default dict) | default list) -}}
{{- if and . (not (include "pa-webinar.segnaposto" .)) (ne (toString .) $portale) -}}
{{- fail (printf "ingress.tls indica l'host %q ma site.portalHost è %q: il certificato sarebbe chiesto o servito per un altro nome. Togli gli host dalla voce tls (il chart mette site.portalHost) oppure scrivi lo stesso nome." (toString .) $portale) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- if $conferenza -}}
{{- $dominio := trimSuffix "/" (toString (index $env "NEXT_PUBLIC_JITSI_DOMAIN" | default "")) -}}
{{- if and $dominio (not (include "pa-webinar.segnaposto" $dominio)) (ne $dominio $conferenza) -}}
{{- fail (printf "app.env.NEXT_PUBLIC_JITSI_DOMAIN è %q ma site.conferenceHost è %q: il portale aprirebbe la sala su un nome che la conferenza non serve. Togli app.env.NEXT_PUBLIC_JITSI_DOMAIN, che il chart ricava da site.conferenceHost, oppure scrivi lo stesso nome (senza https://)." $dominio $conferenza) -}}
{{- end -}}
{{- if .Values.jitsi.enabled -}}
{{- $jm := index .Values "jitsi-meet" | default dict -}}
{{- $hostWeb := dig "web" "ingress" "hosts" list $jm | default list -}}
{{- if gt (len $hostWeb) 1 -}}
{{- fail (printf "jitsi-meet.web.ingress.hosts ha %d voci ma site.conferenceHost è impostato: ogni voce diventerebbe %q, con più regole per lo stesso nome. Lascia una sola voce oppure togli site.conferenceHost." (len $hostWeb) $conferenza) -}}
{{- end -}}
{{- $atteso := printf "https://%s" $conferenza -}}
{{- $pubblico := trimSuffix "/" (toString (dig "publicURL" "" $jm | default "")) -}}
{{- if ne $pubblico $atteso -}}
{{- if or (not $pubblico) (include "pa-webinar.segnaposto" $pubblico) -}}
{{- fail (printf "Con site.conferenceHost %q serve anche jitsi-meet.publicURL: %q. È un valore del sottochart della conferenza, e Helm passa i valori di un sottochart così come sono scritti: il chart non lo può ricavare. Aggiungi al tuo file di valori:\n  jitsi-meet:\n    publicURL: %q" $conferenza $atteso $atteso) -}}
{{- else -}}
{{- fail (printf "jitsi-meet.publicURL è %q ma site.conferenceHost è %q: la conferenza genererebbe i propri indirizzi (websocket, BOSH) su un altro nome e nessuno entrerebbe in sala. Scrivi jitsi-meet.publicURL: %q." $pubblico $conferenza $atteso) -}}
{{- end -}}
{{- end -}}
{{- $web := dig "web" "ingress" dict $jm | default dict -}}
{{- if dig "enabled" false $web -}}
{{- $host := list -}}
{{- range (dig "hosts" list $web | default list) -}}
{{- $host = append $host (toString (dig "host" "" (. | default dict) | default "")) -}}
{{- end -}}
{{- range (dig "tls" list $web | default list) -}}
{{- range (dig "hosts" list (. | default dict) | default list) -}}
{{- $host = append $host (toString .) -}}
{{- end -}}
{{- end -}}
{{- range $h := $host -}}
{{- if ne $h $conferenza -}}
{{- if or (not $h) (include "pa-webinar.segnaposto" $h) -}}
{{- fail (printf "Con site.conferenceHost %q l'Ingress della conferenza reso dal sottochart ha ancora l'host di esempio %q: Helm passa i valori del sottochart così come sono scritti, e il chart non lo può ricavare. Due strade: fai rendere l'Ingress a questo chart, che ricava l'host da solo (jitsi.conferenceIngress.enabled: true e jitsi-meet.web.ingress.enabled: false, con le annotazioni in jitsi.conferenceIngress.annotations e i certificati in jitsi.conferenceIngress.tls), oppure scrivi il nome in jitsi-meet.web.ingress.hosts (host: %q, paths: [\"/\"]) e negli host di jitsi-meet.web.ingress.tls." $conferenza $h $conferenza) -}}
{{- else -}}
{{- fail (printf "L'Ingress della conferenza reso dal sottochart (jitsi-meet.web.ingress.hosts o .tls) indica %q ma site.conferenceHost è %q: la sala si aprirebbe su un nome che nessuno serve. Scrivi lo stesso nome, oppure lascia l'Ingress a questo chart con jitsi.conferenceIngress.enabled: true e jitsi-meet.web.ingress.enabled: false." $h $conferenza) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $rinvio := .Values.jitsi.webIngress | default dict -}}
{{- if dig "redirectUrl" "" $rinvio -}}
{{- range (dig "hosts" list $rinvio | default list) -}}
{{- $h := toString (dig "host" "" (. | default dict) | default "") -}}
{{- if and $h (not (include "pa-webinar.segnaposto" $h)) (ne $h $conferenza) -}}
{{- fail (printf "jitsi.webIngress.hosts contiene %q ma site.conferenceHost è %q: il reindirizzamento dalla radice della conferenza starebbe su un altro nome. Togli gli host, che il chart ricava da site.conferenceHost, oppure scrivi lo stesso nome." $h $conferenza) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
L'Ingress della conferenza reso da questo chart (jitsi.conferenceIngress).

Tre incoerenze che nessun altro controllo vede:
  - acceso insieme a quello del sottochart: due Ingress per lo stesso host, e
    il controller ne sceglie uno senza dirlo;
  - acceso senza un nome: l'Ingress non avrebbe un host da servire;
  - impostazioni lasciate sull'Ingress del sottochart, ormai spento, che
    verrebbero ignorate in silenzio: un altro host, un certificato che non
    compare più, annotazioni diverse da quella predefinita del chart. Succede
    a chi passa da un Ingress all'altro con il file di valori di prima.
*/}}
{{- define "pa-webinar.validateConferenceIngress" -}}
{{- $ci := dig "conferenceIngress" dict (.Values.jitsi | default dict) | default dict -}}
{{- if and .Values.jitsi.enabled (dig "enabled" false $ci) -}}
{{- $jm := index .Values "jitsi-meet" | default dict -}}
{{- $web := dig "web" "ingress" dict $jm | default dict -}}
{{- if dig "enabled" false $web -}}
{{- fail "jitsi.conferenceIngress.enabled e jitsi-meet.web.ingress.enabled sono entrambi veri: due Ingress per lo stesso nome della conferenza, e il controller ne servirebbe uno senza dire quale. Spegni quello del sottochart con jitsi-meet.web.ingress.enabled: false." -}}
{{- end -}}
{{- $host := include "pa-webinar.conferenceHost" . -}}
{{- if not $host -}}
{{- fail "jitsi.conferenceIngress è acceso ma manca il nome della conferenza: valorizza site.conferenceHost (per esempio meet.ente.it), oppure app.env.NEXT_PUBLIC_JITSI_DOMAIN." -}}
{{- end -}}
{{- $segreti := list -}}
{{- range (dig "tls" list $ci | default list) -}}
{{- $voce := . | default dict -}}
{{- $segreti = append $segreti (toString (dig "secretName" "" $voce | default "")) -}}
{{- range (dig "hosts" list $voce | default list) -}}
{{- if and . (ne (toString .) $host) -}}
{{- fail (printf "jitsi.conferenceIngress.tls indica l'host %q ma il nome della conferenza è %q: togli gli host dalla voce (il chart mette il nome della conferenza) oppure scrivi lo stesso nome." (toString .) $host) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- range (dig "hosts" list $web | default list) -}}
{{- $h := toString (dig "host" "" (. | default dict) | default "") -}}
{{- if and $h (not (include "pa-webinar.segnaposto" $h)) (ne $h $host) -}}
{{- fail (printf "jitsi-meet.web.ingress.hosts indica %q, ma quell'Ingress è spento (jitsi.conferenceIngress lo sostituisce) e il nome della conferenza è %q: il valore sarebbe ignorato. Togli jitsi-meet.web.ingress.hosts e indica il nome in site.conferenceHost." $h $host) -}}
{{- end -}}
{{- end -}}
{{- range (dig "tls" list $web | default list) -}}
{{- $voce := . | default dict -}}
{{- $segreto := toString (dig "secretName" "" $voce | default "") -}}
{{- $suoi := list -}}
{{- range (dig "hosts" list $voce | default list) -}}
{{- if and . (not (include "pa-webinar.segnaposto" .)) -}}
{{- $suoi = append $suoi (toString .) -}}
{{- end -}}
{{- end -}}
{{- if or $suoi (and $segreto (ne $segreto "jitsi-tls")) -}}
{{- if not (has $segreto $segreti) -}}
{{- fail (printf "jitsi-meet.web.ingress.tls indica il Secret %q, ma quell'Ingress è spento (jitsi.conferenceIngress lo sostituisce) e il Secret non compare in jitsi.conferenceIngress.tls: la conferenza perderebbe il suo certificato. Sposta la voce in jitsi.conferenceIngress.tls (gli host si possono omettere) e togli jitsi-meet.web.ingress.tls." $segreto) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $sue := dig "annotations" dict $ci | default dict -}}
{{- range $chiave, $valore := (dig "annotations" dict $web | default dict) -}}
{{- $predefinita := and (eq $chiave "cert-manager.io/cluster-issuer") (or (kindIs "invalid" $valore) (eq (toString $valore) "letsencrypt-prod")) -}}
{{- if and (not $predefinita) (not (kindIs "invalid" $valore)) (ne (toString (index $sue $chiave | default "")) (toString $valore)) -}}
{{- fail (printf "jitsi-meet.web.ingress.annotations.%s è impostata, ma quell'Ingress è spento (jitsi.conferenceIngress lo sostituisce) e l'annotazione sarebbe ignorata. Spostala in jitsi.conferenceIngress.annotations." $chiave) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
La copia del database (backup.*): solo con il PostgreSQL del chart, e con un
numero di copie da tenere che abbia senso. Un database gestito ha le copie
del suo fornitore, e un CronJob che non trova il server fallirebbe ogni notte
senza che nessuno lo guardi.
*/}}
{{- define "pa-webinar.validateBackup" -}}
{{- $b := .Values.backup | default dict -}}
{{- if dig "enabled" false $b -}}
{{- if not (dig "enabled" false (.Values.postgresql | default dict)) -}}
{{- fail "backup.enabled richiede il PostgreSQL del chart (postgresql.enabled): la copia la fa pg_dump contro quel server. Un database gestito si copia con gli strumenti del suo fornitore." -}}
{{- end -}}
{{- if not (regexMatch "^[1-9][0-9]*$" (toString (dig "retention" "" $b))) -}}
{{- fail (printf "backup.retention è %q: serve il numero di copie da tenere, un intero da 1 in su." (toString (dig "retention" "" $b))) -}}
{{- end -}}
{{- if not (dig "schedule" "" $b) -}}
{{- fail "backup.schedule è vuoto: serve un orario in formato cron, per esempio \"30 3 * * *\"." -}}
{{- end -}}
{{- end -}}
{{- end -}}

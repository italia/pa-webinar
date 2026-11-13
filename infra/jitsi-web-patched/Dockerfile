# SPDX-License-Identifier: EUPL-1.2
# SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

# jitsi/web patchata — tre correzioni che upstream non ha, applicate al bundle
# gia' costruito perche' non esiste un punto di configurazione per nessuna:
#
#   1. soppressione rumore: la AudioContext di rnnoise nasce senza sampleRate
#      esplicito e adotta quello dell'hardware. Se non e' 48 kHz (p.es. 44,1)
#      il worklet — che non ricampiona — tratta i campioni come se lo fossero e
#      AMMUTOLISCE il microfono. Forzando il contesto a 48 kHz e' il grafo Web
#      Audio a ricampionare, e il worklet riceve il ritmo che presume.
#   2. "Nascondi la tua immagine" e' una trappola a senso unico per chi ci e'
#      gia' finito: Jitsi tiene quella scelta nel localStorage dell'origine
#      Jitsi (irraggiungibile dall'applicazione che la incorpora) e il selettore
#      la mette in OR con la configurazione, quindi `disableSelfView:false` non
#      puo' vincere. La patch rende un `false` ESPLICITO autoritativo sul valore
#      memorizzato, lasciando stare la regola sui visitatori.
#   3. le emoji volanti delle reazioni non hanno `pointer-events`, e attraversando
#      la barra dei comandi si mangiano il clic sotto di loro.
#
# COME SOPRAVVIVE A UN CAMBIO DI VERSIONE: gli identificatori del bundle
# minificato cambiano a ogni build di upstream (la variabile del contesto rumore
# e' stata `Xy`, poi `Vs`), quindi qui non si scrive nessun nome: si cercano per
# FORMA, con un'asserzione che pretende UNA sola corrispondenza. Zero = il punto
# non c'e' piu' (upstream ha cambiato struttura, o ha risolto), piu' di una =
# ambiguo: in entrambi i casi la costruzione si ferma invece di indovinare.
# Bumpare la versione e' quindi un cambio di tag, non un lavoro di archeologia.
#
# La base e' fissata anche per impronta (digest dell'indice multi-architettura):
# le assunzioni sulla forma del bundle valgono per quella build esatta, non per
# qualunque cosa il tag indichi domani. L'immagine si scarica per impronta: il
# tag da solo non la sceglie, e sovrascrivere BASE_TAG senza BASE_DIGEST
# costruisce sulla base vecchia. Questo e' l'unico posto dove la base e'
# scritta: .github/workflows/jitsi-web.yml legge questi default e si ferma se
# il tag a monte non punta piu' all'impronta.
ARG BASE_TAG=stable-11031
ARG BASE_DIGEST=sha256:2183593bbbe1b5e27c368e3737efc51915ce7742de93f594e5ca7950c864c233
FROM jitsi/web:${BASE_TAG}@${BASE_DIGEST} AS base

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS patcher
COPY --from=base /usr/share/jitsi-meet/libs/app.bundle.min.js /work/app.bundle.min.js
COPY patch-bundle.mjs /work/patch-bundle.mjs
RUN node /work/patch-bundle.mjs /work/app.bundle.min.js

FROM base
COPY --from=patcher /work/app.bundle.min.js /usr/share/jitsi-meet/libs/app.bundle.min.js

# Le emoji sono pura decorazione: niente in loro e' cliccabile, quindi
# disattivare gli eventi del puntatore non toglie alcun comportamento. Si
# AGGIUNGE una regola invece di modificarne una che non controlliamo, cosi' un
# riordino del CSS di upstream non rompe la patch. Le guardie sono fail-loud e
# non idempotenti: un marcatore gia' presente vuol dire che l'immagine di base
# non e' quella pristina che crediamo, e aggiungere una seconda copia lo
# nasconderebbe.
RUN set -eu; \
    C=/usr/share/jitsi-meet/css/all.css; \
    [ -f "$C" ] || { echo "FATALE: $C non trovato (cambiata la disposizione dell'immagine di base?)"; exit 1; }; \
    grep -qF 'pa-webinar reactions overlay' "$C" && { echo "FATALE: patch gia' presente"; exit 1; }; \
    grep -qF '.reactions-animations-container' "$C" || { echo "FATALE: .reactions-animations-container non e' in $C (cambiata l'interfaccia delle reazioni?)"; exit 1; }; \
    printf '\n/* pa-webinar reactions overlay: le emoji volanti non devono mai intercettare i clic sulla barra */\n.reactions-animations-container,.reactions-animations-container *{pointer-events:none!important}\n' >> "$C"; \
    grep -qF 'pa-webinar reactions overlay' "$C" || { echo "FATALE: l'aggiunta non e' arrivata in $C"; exit 1; }; \
    echo "OK: emoji delle reazioni a pointer-events:none"

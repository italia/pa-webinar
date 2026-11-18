// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// Configurazione della conferenza nello stack locale (docker-compose):
// nessun logo predefinito. L'immagine jitsi/web aggiunge questo file in coda
// al suo config.js all'avvio del contenitore.
config.defaultLogoUrl = '';

// La sessione del registratore (Jibri) non vede chi non conduce e chi non ha un
// consenso valido: mod_pa_media_lock lo dice nella presenza, e per tutti gli
// altri in sala non cambia niente. Da qui alla fine il testo e' lo stesso di
// jitsi-meet.web.custom.configs._custom_config_js nei valori del chart
// (scripts/validate-chart.sh li confronta).
config.hiddenFromRecorderFeatureEnabled = true;
// Nel video solo chi conduce. mod_pa_media_lock segna hidden-from-recorder chi
// non conduce, e la sessione del registratore (Jibri) non lo mette nella sala:
// niente riquadro, nome o immagine. Di chi porta anche il segno della voce (un
// partecipante con il consenso) qui si riproduce la sola voce. Gira solo nella
// pagina che Jibri apre (config.iAmRecorder) e non modifica niente di Jitsi:
// legge la conferenza da APP.conference._room, come fa Jibri stesso, e ne
// ascolta gli eventi pubblici. Se smette di funzionare manca quella voce, non
// compare nessuno in piu'. Il chart imposta RECORDING_PARTICIPANT_VOICE solo se
// trova qui la riga che definisce VOCE.
(function () {
  if (typeof window === 'undefined' || !window.location
    || !/[#&]config\.iAmRecorder=true(&|$)/.test(window.location.hash)) {
    return;
  }
  // Lo schermo di un partecipante: con lo SSRC rewriting la sessione crea i
  // riquadri delle condivisioni dalla presenza di tutti, nascosti compresi, e
  // il palco passerebbe a un riquadro vuoto. Senza, li crea dalle tracce, che
  // Jitsi non le da' per chi e' nascosto.
  config.flags = Object.assign({}, config.flags, { ssrcRewritingEnabled: false });
  var VOCE = 'pa-recorder-voice';
  function soloVoce(persona) {
    var identita = persona.getIdentity();
    return Boolean(persona.isHiddenFromRecorder()
      && identita && identita.user && identita.user[VOCE] === 'true');
  }
  function riproduci(conference) {
    var eventi = window.JitsiMeetJS.events.conference;
    var elementi = new Map();
    function togli(track) {
      var el = elementi.get(track);
      if (el) {
        elementi.delete(track);
        track.detach(el);
        el.remove();
      }
    }
    // Decide sul proprietario attuale: se una traccia passa da una persona
    // all'altra (SSRC rewriting), Jitsi la toglie e la riaggiunge.
    function valuta(track) {
      if (!track || track.isLocal() || track.getType() !== 'audio' || elementi.has(track)) {
        return;
      }
      var persona = conference.getParticipantById(track.getParticipantId());
      if (!persona || !soloVoce(persona)) {
        return;
      }
      var el = document.createElement('audio');
      el.autoplay = true;
      el.setAttribute('data-pa-recorder-voice', '');
      document.body.appendChild(el);
      elementi.set(track, el);
      track.attach(el);
      var avvio = el.play();
      if (avvio && avvio.catch) {
        avvio.catch(function (e) {
          console.error('[pa-webinar] voce di un partecipante non riprodotta', e);
        });
      }
    }
    conference.on(eventi.TRACK_ADDED, valuta);
    conference.on(eventi.TRACK_REMOVED, togli);
    // La segnalazione delle fonti puo' precedere la presenza: lib-jitsi-meet
    // assegna quelle tracce alla persona quando entra, prima di USER_JOINED.
    conference.on(eventi.USER_JOINED, function (id, persona) {
      if (persona) {
        persona.getTracks().forEach(valuta);
      }
    });
    conference.on(eventi.CONFERENCE_LEFT, function () {
      Array.from(elementi.keys()).forEach(togli);
    });
    conference.getParticipants().forEach(function (persona) {
      persona.getTracks().forEach(valuta);
    });
  }
  var agganciata = null;
  setInterval(function () {
    var app = window.APP;
    var conference = app && app.conference && app.conference._room;
    if (conference && conference !== agganciata && window.config.iAmRecorder === true) {
      agganciata = conference;
      riproduci(conference);
    }
  }, 500);
}());

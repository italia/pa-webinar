// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// Configurazione della conferenza nello stack locale (docker-compose):
// nessun logo predefinito. L'immagine jitsi/web aggiunge questo file in coda
// al suo config.js all'avvio del contenitore.
config.defaultLogoUrl = '';

// La sessione del registratore (Jibri): nel video completo niente striscia dei
// partecipanti, niente griglia, niente nomi o iniziali. Resta chi parla con la
// videocamera accesa, e lo schermo condiviso. A ogni aggiornamento di Jitsi va
// riprovato: legge parti interne del client.
if (typeof document !== 'undefined' && /[#&]config\.iAmRecorder=true/.test(location.hash)) {
  config.filmstrip = { disabled: true };
  config.disableTileView = true;
  config.hideDisplayName = true;
  const stile = document.createElement('style');
  stile.textContent = '#dominantSpeaker, #dominantSpeakerAvatarContainer { display: none !important; }';
  document.head.appendChild(stile);
  // Voce e immagine di chi non ha un consenso valido non si riproducono, quindi
  // non entrano nel video: la presenza lo dice (mod_pa_media_lock), e gli altri
  // non cambiano. L'immagine vale per chi modera: il bridge non lo tiene chiuso.
  let salaSeguita = null;
  const fuoriDalVideo = (traccia) => {
    const sala = salaSeguita;
    const persona = sala && sala.getParticipantById(traccia.getParticipantId());
    if (persona && persona.getProperty('paNoRecording') === 'true' && traccia.track) {
      traccia.track.enabled = false;
    }
  };
  setInterval(() => {
    const sala = window.APP && window.APP.conference && window.APP.conference._room;
    if (!sala) return;
    if (sala !== salaSeguita) {
      salaSeguita = sala;
      sala.on('conference.trackAdded', (traccia) => {
        if (!traccia.isLocal()) fuoriDalVideo(traccia);
      });
    }
    for (const persona of sala.getParticipants()) {
      persona.getTracks().forEach(fuoriDalVideo);
    }
  }, 100);
}

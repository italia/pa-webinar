/**
 * I sottotitoli live sono disponibili nell'istanza: l'amministrazione li ha
 * lasciati accesi e il servizio è installato. Il chart dà al portale
 * l'indirizzo dello stato del servizio (`CAPTIONS_STATUS_URL`) solo quando
 * rende il servizio: senza, nessuna sala prova ad avviarli (Jitsi
 * ripiegherebbe sulla vecchia trascrizione via telefono e darebbe errore).
 */
export function captionsInstalled(): boolean {
  return Boolean(process.env.CAPTIONS_STATUS_URL?.trim());
}

export function liveCaptionsAvailable(settings: { liveCaptionsEnabled?: boolean | null }): boolean {
  return settings.liveCaptionsEnabled !== false && captionsInstalled();
}

// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il segnale sonoro di una registrazione o trascrizione che parte o si ferma.
 * Lo suona la sala, non Jitsi: gli annunci di Jitsi sono spenti dove ci sono i
 * sottotitoli (CAPTIONS_DISABLED_SOUNDS) e sono in una lingua sola. Due note
 * brevi generate nel browser, nessun file da scaricare: salgono all'avvio e
 * scendono allo stop. Chi non puo' sentirle ha l'avviso scritto.
 */
const DURATA_NOTA_S = 0.16;
const VOLUME = 0.12;
const ATTESA_AUDIO_MS = 300;

let contesto: AudioContext | null = null;

function suona(ctx: AudioContext, acceso: boolean): void {
  const inizio = ctx.currentTime + 0.02;
  (acceso ? [660, 880] : [880, 660]).forEach((frequenza, i) => {
    const nota = ctx.createOscillator();
    const volume = ctx.createGain();
    const da = inizio + i * DURATA_NOTA_S;
    nota.frequency.value = frequenza;
    volume.gain.setValueAtTime(VOLUME, da);
    volume.gain.exponentialRampToValueAtTime(0.001, da + DURATA_NOTA_S);
    nota.connect(volume).connect(ctx.destination);
    nota.start(da);
    nota.stop(da + DURATA_NOTA_S);
  });
}

export async function suonaAvvisoCattura(acceso: boolean): Promise<void> {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    contesto ??= new Ctx();
    // Dopo il clic di ingresso il browser lo permette. Se non lo permette
    // (un ricaricamento senza clic), niente nota: resterebbe in coda su un
    // orologio fermo e suonerebbe dopo, sopra quella successiva.
    // Senza un clic la promessa puo' restare aperta: non la si aspetta oltre.
    await Promise.race([contesto.resume(), new Promise((r) => setTimeout(r, ATTESA_AUDIO_MS))]);
    if (contesto.state === 'running') suona(contesto, acceso);
  } catch {
    // Un browser senza audio non deve fermare la sala.
  }
}

import { describe, it, expect } from 'vitest';
import { HomePageMode, VideoQuality, WaitingRoomEngine } from '@prisma/client';

import { updateSettingsSchema } from './site-settings';

/**
 * Presidio sugli elenchi chiusi delle impostazioni.
 *
 * Il difetto che tiene chiuso e' gia' successo: si aggiunge un valore
 * all'enum del modello, lo si espone nel pannello, e lo schema di validazione
 * della rotta resta indietro. L'opzione compare, si clicca, e il salvataggio
 * la rifiuta — e siccome lo schema e' in modalita' stretta a cadere e' l'INTERO
 * salvataggio, non solo quel campo: l'amministrazione perde anche le modifiche
 * che stava facendo accanto.
 *
 * Confrontare a mano due elenchi non basta, perche' e' esattamente la cosa che
 * si dimentica: qui si legge l'enum del modello.
 */
describe('schema delle impostazioni', () => {
  it('accetta ogni impianto di home dichiarato nel modello', () => {
    for (const modo of Object.values(HomePageMode)) {
      const esito = updateSettingsSchema.safeParse({ homePageMode: modo });
      expect(esito.success, `${modo} rifiutato dalla rotta`).toBe(true);
    }
  });

  it('accetta ogni sala d\u2019attesa e ogni qualita\u2019 video dichiarate nel modello', () => {
    // Stessa classe di difetto, altri due elenchi chiusi: qui oggi non c'e'
    // deriva, e questo presidio serve a farla notare il giorno in cui ci sara'.
    for (const engine of Object.values(WaitingRoomEngine)) {
      expect(
        updateSettingsSchema.safeParse({ waitingRoomEngine: engine }).success,
        `${engine} rifiutato dalla rotta`,
      ).toBe(true);
    }
    for (const q of Object.values(VideoQuality)) {
      expect(
        updateSettingsSchema.safeParse({ videoQuality: q }).success,
        `${q} rifiutata dalla rotta`,
      ).toBe(true);
    }
  });

  it('rifiuta un impianto che non esiste', () => {
    expect(updateSettingsSchema.safeParse({ homePageMode: 'LANDING_INVENTATA' }).success).toBe(
      false,
    );
  });

  it('un campo sconosciuto non passa in silenzio', () => {
    // Modalita' stretta: un nome sbagliato deve fallire invece di essere
    // scartato, altrimenti si salva credendo di aver cambiato qualcosa.
    expect(updateSettingsSchema.safeParse({ campoCheNonEsiste: true }).success).toBe(false);
  });

  it('gli interruttori dell’anteprima dei link sono accettati', () => {
    const esito = updateSettingsSchema.safeParse({
      ogCardEnabled: false,
      ogShowPoster: false,
      ogShowDate: false,
      ogShowSpeakers: false,
      ogShowOrganization: false,
    });
    expect(esito.success).toBe(true);
  });
});

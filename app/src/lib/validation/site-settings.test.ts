import { describe, it, expect } from 'vitest';
import { HomePageMode, Prisma, VideoQuality, WaitingRoomEngine } from '@prisma/client';

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

describe('salvataggio di cio\' che si e\' appena letto', () => {
  it('ogni colonna delle impostazioni e\' accettata dallo schema o tolta dalla rotta', () => {
    // La GET restituisce la riga intera e il pannello la rimanda: una colonna
    // nuova dimenticata qui fa rifiutare ogni salvataggio (schema stretto).
    const tolte = new Set(['id', 'updatedAt']);
    const accettate = new Set(Object.keys(updateSettingsSchema.shape));
    const mancanti = Object.values(Prisma.SiteSettingScalarFieldEnum).filter(
      (c) => !tolte.has(c) && !accettate.has(c),
    );
    expect(mancanti).toEqual([]);
  });

  it('i link del pie\' di pagina salvati come testo JSON si leggono come elenco', () => {
    const r = updateSettingsSchema.safeParse({
      footerLinks: JSON.stringify([{ title: 'Privacy', url: '/privacy', section: 'legal' }]),
    });
    expect(r.success && r.data.footerLinks).toEqual([{ title: 'Privacy', url: '/privacy', section: 'legal' }]);
  });

  it('un testo che non e\' JSON e\' rifiutato con il campo nel percorso', () => {
    const r = updateSettingsSchema.safeParse({ footerLinks: '{non json' });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues[0]!.path).toEqual(['footerLinks']);
  });
});

describe('indirizzi senza schema', () => {
  it('il sito dell\'ente scritto senza schema si salva con https://', () => {
    const r = updateSettingsSchema.safeParse({ organizationUrl: 'www.comune-esempio.it', githubUrl: 'github.com/ente' });
    expect(r.success && r.data).toMatchObject({
      organizationUrl: 'https://www.comune-esempio.it',
      githubUrl: 'https://github.com/ente',
    });
  });

  it('nei link del pie\' di pagina un percorso resta, un indirizzo esterno prende https://', () => {
    const r = updateSettingsSchema.safeParse({
      footerLinks: [
        { title: 'Privacy', url: '/privacy' },
        { title: 'Trasparenza', url: 'www.comune.it/trasparenza' },
      ],
    });
    expect(r.success && r.data.footerLinks?.map((l) => l.url)).toEqual([
      '/privacy',
      'https://www.comune.it/trasparenza',
    ]);
  });

  it('un indirizzo vuoto per il sito dell\'ente resta vuoto', () => {
    const r = updateSettingsSchema.safeParse({ organizationUrl: '' });
    expect(r.success && r.data.organizationUrl).toBe('');
  });
});

describe('testi legali', () => {
  it('svuotare l\'ultima lingua manda {} e torna al testo predefinito', () => {
    expect(updateSettingsSchema.safeParse({ privacyPolicy: {}, accessibility: {} }).success).toBe(true);
  });
});

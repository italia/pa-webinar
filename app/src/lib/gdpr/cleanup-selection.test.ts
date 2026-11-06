// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, it, expect } from 'vitest';

import {
  CLEANABLE_EVENT_STATUSES,
  TEMP_RECORDING_TTL_MS,
  UNFINISHED_EVENT_STATUSES,
  isEventDataRetentionExpired,
  isEventEligibleForCleanup,
  isRecordingRetentionExpired,
  shouldPurgeRecordingBlob,
  tempRecordingExpiryCutoff,
  tipiDiProvaDaConservare,
  TIMEOUT_DOPO_PULIZIA_MS,
  TIMEOUT_PULIZIA_EVENTO_MS,
  tipiDiProvaDiCioCheEsiste,
} from './cleanup-selection';

/**
 * Confini della finestra di conservazione. Ogni caso qui sotto è un modo
 * concreto di sbagliare la cancellazione: da una parte si perdono dati che
 * l'informativa prometteva di conservare, dall'altra restano PII oltre la
 * retention dichiarata in `docs/GDPR.md`.
 */

const NOW = new Date('2026-07-22T03:00:00Z');
const DAY = 86_400_000;
/** `now` spostato di `days` giorni (negativi = nel passato). */
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('tempRecordingExpiryCutoff', () => {
  it('taglia a 24 ore esatte prima di adesso', () => {
    // La finestra di catch-up promessa dall'informativa è di 24 ore: un cron
    // che tagliasse a 24 minuti butterebbe via la registrazione mentre
    // l'evento è ancora in corso.
    expect(tempRecordingExpiryCutoff(NOW).toISOString()).toBe('2026-07-21T03:00:00.000Z');
    expect(NOW.getTime() - tempRecordingExpiryCutoff(NOW).getTime()).toBe(
      TEMP_RECORDING_TTL_MS
    );
  });

  it('lascia fuori una registrazione avviata da meno di 24 ore', () => {
    // Il cutoff è usato come `lt` sulla query: una registrazione più recente
    // del cutoff non entra nella selezione.
    const cutoff = tempRecordingExpiryCutoff(NOW);
    const iniziataDaUnOra = new Date(NOW.getTime() - 60 * 60 * 1000);
    const iniziataDaDueGiorni = daysFromNow(-2);
    expect(iniziataDaUnOra.getTime() < cutoff.getTime()).toBe(false);
    expect(iniziataDaDueGiorni.getTime() < cutoff.getTime()).toBe(true);
  });
});

describe('isRecordingRetentionExpired', () => {
  it('scade il video pubblicato oltre i giorni configurati', () => {
    expect(
      isRecordingRetentionExpired(
        { recordingPublishedAt: daysFromNow(-31), recordingDeleteAfterDays: 30 },
        NOW
      )
    ).toBe(true);
  });

  it('NON scade il giorno esatto della scadenza', () => {
    // "Conservato 30 giorni" vuol dire che il trentesimo giorno il video c'è
    // ancora. Un confronto >= lo farebbe sparire un giorno prima del promesso.
    expect(
      isRecordingRetentionExpired(
        { recordingPublishedAt: daysFromNow(-30), recordingDeleteAfterDays: 30 },
        NOW
      )
    ).toBe(false);
  });

  it('NON scade un video ancora dentro la finestra', () => {
    expect(
      isRecordingRetentionExpired(
        { recordingPublishedAt: daysFromNow(-3), recordingDeleteAfterDays: 30 },
        NOW
      )
    ).toBe(false);
  });

  it('senza data di pubblicazione non cancella nulla', () => {
    // Non sapendo da quando contare, l'unica alternativa alla non-scadenza
    // sarebbe cancellare un video che la pagina evento sta ancora linkando.
    expect(
      isRecordingRetentionExpired(
        { recordingPublishedAt: null, recordingDeleteAfterDays: 30 },
        NOW
      )
    ).toBe(false);
  });

  it('senza giorni configurati lascia il video alla retention dell’evento', () => {
    // `recordingDeleteAfterDays` null = nessuna scadenza PROPRIA: il video
    // vive quanto l'evento e lo cancella la fase 3, non questa.
    expect(
      isRecordingRetentionExpired(
        { recordingPublishedAt: daysFromNow(-400), recordingDeleteAfterDays: null },
        NOW
      )
    ).toBe(false);
  });

  it('tratta 0 giorni come "nessuna scadenza", non come "cancella subito"', () => {
    // L'API valida min(1) (lib/validation/schemas.ts), quindi uno 0 arriva solo
    // da un default o da una scrittura diretta. Leggerlo come "scaduto
    // all'istante della pubblicazione" farebbe sparire al primo giro di cron
    // OGNI video appena pubblicato.
    expect(
      isRecordingRetentionExpired(
        { recordingPublishedAt: daysFromNow(-1), recordingDeleteAfterDays: 0 },
        NOW
      )
    ).toBe(false);
  });
});

describe('isEventDataRetentionExpired', () => {
  it('scade i dati di un evento finito oltre la retention', () => {
    expect(
      isEventDataRetentionExpired({ endsAt: daysFromNow(-31), dataRetentionDays: 30 }, NOW)
    ).toBe(true);
  });

  it('NON tocca un evento appena concluso', () => {
    // È il caso che deve fallire rumorosamente se qualcuno inverte un segno:
    // le domande, la chat e le registrazioni di ieri servono ancora (recap,
    // pubblicazione del video, feedback) e l'informativa ne promette 30 giorni.
    expect(
      isEventDataRetentionExpired({ endsAt: daysFromNow(-1), dataRetentionDays: 30 }, NOW)
    ).toBe(false);
  });

  it('NON scade nell’istante esatto della scadenza', () => {
    expect(
      isEventDataRetentionExpired({ endsAt: daysFromNow(-30), dataRetentionDays: 30 }, NOW)
    ).toBe(false);
    // …ma un minuto dopo sì.
    expect(
      isEventDataRetentionExpired(
        { endsAt: new Date(daysFromNow(-30).getTime() - 60_000), dataRetentionDays: 30 },
        NOW
      )
    ).toBe(true);
  });

  it('rispetta una retention personalizzata più lunga', () => {
    // 100 giorni dopo la fine, con retention a 365, i dati devono esserci
    // ancora: la retention è per-evento, non una costante globale.
    expect(
      isEventDataRetentionExpired(
        { endsAt: daysFromNow(-100), dataRetentionDays: 365 },
        NOW
      )
    ).toBe(false);
    expect(
      isEventDataRetentionExpired(
        { endsAt: daysFromNow(-366), dataRetentionDays: 365 },
        NOW
      )
    ).toBe(true);
  });

  it('non cancella un evento chiuso in anticipo la cui fine è nel futuro', () => {
    // Un evento può essere ENDED (chiuso a mano dal moderatore) o posticipato
    // con `endsAt` ancora avanti: la finestra non è nemmeno cominciata.
    expect(
      isEventDataRetentionExpired({ endsAt: daysFromNow(2), dataRetentionDays: 30 }, NOW)
    ).toBe(false);
  });
});

describe('CLEANABLE_EVENT_STATUSES', () => {
  it('non contiene nessuno stato di evento ancora vivo', () => {
    // La fase 3 cancella le PII dei partecipanti: se uno stato "vivo" finisse
    // in questa lista, un evento in corso o non ancora iniziato verrebbe
    // svuotato delle sue registrazioni mentre la gente ci sta entrando.
    for (const status of [
      'DRAFT',
      'PUBLISHED',
      'PROVISIONING',
      'IDLE',
      'LIVE',
    ] as const) {
      expect(CLEANABLE_EVENT_STATUSES as readonly string[]).not.toContain(status);
    }
  });

  it('include ARCHIVED, non solo ENDED', () => {
    // La fase 3 archivia l'evento invece di cancellarlo: se la selezione
    // guardasse solo ENDED, il cron non ripasserebbe MAI su un evento già
    // archiviato e tutto ciò che una versione precedente non cancellava (la
    // chat, storicamente) resterebbe lì per sempre.
    expect(CLEANABLE_EVENT_STATUSES as readonly string[]).toContain('ARCHIVED');
    expect(CLEANABLE_EVENT_STATUSES as readonly string[]).toContain('ENDED');
  });
});

describe('isEventEligibleForCleanup', () => {
  const base = { endsAt: daysFromNow(-40), dataRetentionDays: 30, lastActiveAt: null };

  it('un evento concluso segue la sua retention come sempre', () => {
    expect(isEventEligibleForCleanup({ ...base, status: 'ENDED' }, NOW)).toBe(true);
    expect(isEventEligibleForCleanup({ ...base, status: 'ARCHIVED' }, NOW)).toBe(true);
    expect(
      isEventEligibleForCleanup({ ...base, status: 'ENDED', endsAt: daysFromNow(-10) }, NOW),
    ).toBe(false);
  });

  it('un evento mai concluso oltre fine + retention si ripulisce, qualunque stato abbia', () => {
    // Nessuno lo ha chiuso: la retention decorre dalla fine, non dallo stato.
    for (const status of UNFINISHED_EVENT_STATUSES) {
      expect(isEventEligibleForCleanup({ ...base, status }, NOW), status).toBe(true);
      expect(
        isEventEligibleForCleanup({ ...base, status, endsAt: daysFromNow(-10) }, NOW),
        status,
      ).toBe(false);
    }
  });

  it('per un evento mai concluso la finestra decorre dall’ultima attività, se più tarda della fine', () => {
    // Una sala a tempo indefinito usata ancora dopo la fine programmata.
    expect(
      isEventEligibleForCleanup(
        { ...base, status: 'LIVE', lastActiveAt: daysFromNow(-5) },
        NOW,
      ),
    ).toBe(false);
    expect(
      isEventEligibleForCleanup(
        { ...base, status: 'LIVE', lastActiveAt: daysFromNow(-31) },
        NOW,
      ),
    ).toBe(true);
  });

  it('il confine resta stretto anche per gli eventi mai conclusi', () => {
    const endsAt = daysFromNow(-30);
    expect(
      isEventEligibleForCleanup({ ...base, status: 'PUBLISHED', endsAt }, NOW),
    ).toBe(false);
  });

  it('una bozza non si ripulisce mai', () => {
    expect(isEventEligibleForCleanup({ ...base, status: 'DRAFT' }, NOW)).toBe(false);
    expect(UNFINISHED_EVENT_STATUSES as readonly string[]).not.toContain('DRAFT');
  });
});

describe('shouldPurgeRecordingBlob', () => {
  it('risparmia il video PUBBLICATO', () => {
    // È l'unico "documento reso pubblico": la sua durata di vita è governata
    // dalla fase 2 (recordingDeleteAfterDays). Cancellarlo qui lascerebbe il
    // player della pagina evento su un 404 prima della scadenza promessa.
    expect(
      shouldPurgeRecordingBlob({
        recordingUrl: 'https://blob/rec.mp4',
        recordingPublished: true,
      })
    ).toBe(false);
  });

  it('cancella il video NON pubblicato', () => {
    // Nessuno lo vede da nessuna parte e la fase 2 non lo guarda: se non lo
    // cancellasse questa fase, il blob resterebbe nello storage per sempre.
    expect(
      shouldPurgeRecordingBlob({
        recordingUrl: 'https://blob/rec.mp4',
        recordingPublished: false,
      })
    ).toBe(true);
  });

  it('non prova a cancellare quando non c’è nessun URL', () => {
    expect(
      shouldPurgeRecordingBlob({ recordingUrl: null, recordingPublished: false })
    ).toBe(false);
  });
});

describe('tipiDiProvaDaConservare', () => {
  const niente = {
    youtubeUrl: null,
    recordingUrl: null,
    recordingPublished: false,
    trascrizionePubblicata: false,
  };
  const entrambe = ['recording', 'transcription'];

  it('niente di pubblicato: nessuna prova', () => {
    expect(tipiDiProvaDaConservare(niente)).toEqual([]);
  });

  it('il video pubblicato tiene entrambe', () => {
    expect(
      tipiDiProvaDaConservare({ ...niente, recordingUrl: 'u', recordingPublished: true })
    ).toEqual(entrambe);
  });

  it('il link esterno conta come video, anche senza file', () => {
    expect(tipiDiProvaDaConservare({ ...niente, youtubeUrl: 'y' })).toEqual(entrambe);
  });

  it('il file non pubblicato non conta', () => {
    expect(tipiDiProvaDaConservare({ ...niente, recordingUrl: 'u' })).toEqual([]);
  });

  it('il flag di pubblicazione senza file non conta', () => {
    expect(tipiDiProvaDaConservare({ ...niente, recordingPublished: true })).toEqual([]);
  });

  it('la sola trascrizione pubblicata tiene la sua prova', () => {
    expect(tipiDiProvaDaConservare({ ...niente, trascrizionePubblicata: true })).toEqual([
      'transcription',
    ]);
  });

  it('video e trascrizione insieme non raddoppiano', () => {
    expect(
      tipiDiProvaDaConservare({ ...niente, youtubeUrl: 'y', trascrizionePubblicata: true })
    ).toEqual(entrambe);
  });

  it('non cambia il destino del file: il link esterno non lo tiene in vita', () => {
    const evt = { ...niente, youtubeUrl: 'y', recordingUrl: 'u' };
    expect(tipiDiProvaDaConservare(evt)).toEqual(entrambe);
    expect(shouldPurgeRecordingBlob(evt)).toBe(true);
  });
});

describe('tipiDiProvaDiCioCheEsiste', () => {
  const niente = {
    youtubeUrl: null,
    recordingUrl: null,
    tempRecordingUrl: null,
    tracceArrivate: false,
    trascrizioneEsiste: false,
  };

  it.each([
    ['il file non ancora pubblicato', { recordingUrl: 'https://file' }],
    ['la registrazione temporanea', { tempRecordingUrl: 'https://temp' }],
    ['il link esterno', { youtubeUrl: 'https://esterno' }],
    ['le tracce per persona arrivate', { tracceArrivate: true }],
  ])('%s vale come video: restano entrambe', (_nome, stato) => {
    expect(tipiDiProvaDiCioCheEsiste({ ...niente, ...stato })).toEqual([
      'recording',
      'transcription',
    ]);
  });

  it('la sola trascrizione tiene la sua prova, anche non pubblicata', () => {
    expect(tipiDiProvaDiCioCheEsiste({ ...niente, trascrizioneEsiste: true })).toEqual([
      'transcription',
    ]);
  });

  it('niente video e niente trascrizione: nessuna', () => {
    expect(tipiDiProvaDiCioCheEsiste(niente)).toEqual([]);
  });

  it('il limite di chi aspetta la pulizia supera quello della pulizia', () => {
    expect(TIMEOUT_DOPO_PULIZIA_MS).toBeGreaterThan(TIMEOUT_PULIZIA_EVENTO_MS);
  });
});

import { describe, it, expect } from 'vitest';

import {
  isEventPageVisible,
  isEventPubliclyVisible,
  isEventOpenForRegistration,
  publicEventStatusWhere,
  REGISTRABLE_STATUSES,
} from './visibility';

const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);
// Campi post-evento: per gli stati non-ENDED sono irrilevanti ma richiesti dal
// tipo, quindi si spreddano i default "pagina attiva, nessuna scadenza".
const PUB = { postEventPublic: true, postEventPublicUntil: null };

describe('isEventPubliclyVisible', () => {
  it('PUBLISHED/LIVE visibili per qualunque tipo (anche a evento finito)', () => {
    for (const status of ['PUBLISHED', 'LIVE']) {
      expect(
        isEventPubliclyVisible({ status, eventType: 'SCHEDULED', endsAt: PAST, ...PUB }),
      ).toBe(true);
      expect(
        isEventPubliclyVisible({ status, eventType: 'INSTANT', endsAt: FUTURE, ...PUB }),
      ).toBe(true);
    }
  });

  it('PROVISIONING/IDLE visibili per gli schedulati non finiti (pre-warm ≠ 404)', () => {
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(
        isEventPubliclyVisible({ status, eventType: 'SCHEDULED', endsAt: FUTURE, ...PUB }),
      ).toBe(true);
    }
  });

  it('un evento FINITO ma incagliato in IDLE/PROVISIONING (scaler giù) resta invisibile', () => {
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(
        isEventPubliclyVisible({ status, eventType: 'SCHEDULED', endsAt: PAST, ...PUB }),
      ).toBe(false);
    }
  });

  it('le instant call parcheggiate in PROVISIONING/IDLE restano nascoste', () => {
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(
        isEventPubliclyVisible({ status, eventType: 'INSTANT', endsAt: FUTURE, ...PUB }),
      ).toBe(false);
    }
  });

  it('DRAFT e ARCHIVED mai visibili', () => {
    for (const status of ['DRAFT', 'ARCHIVED']) {
      expect(
        isEventPubliclyVisible({ status, eventType: 'SCHEDULED', endsAt: FUTURE, ...PUB }),
      ).toBe(false);
    }
  });

  describe('ENDED — gate della pagina post-evento', () => {
    const base = { status: 'ENDED', eventType: 'SCHEDULED', endsAt: PAST } as const;

    it('visibile se postEventPublic è attivo e non c’è scadenza', () => {
      expect(
        isEventPubliclyVisible({ ...base, postEventPublic: true, postEventPublicUntil: null }),
      ).toBe(true);
    });

    it('nascosto (404) se il toggle admin postEventPublic è spento', () => {
      expect(
        isEventPubliclyVisible({ ...base, postEventPublic: false, postEventPublicUntil: null }),
      ).toBe(false);
    });

    it('visibile finché la finestra postEventPublicUntil è futura', () => {
      expect(
        isEventPubliclyVisible({ ...base, postEventPublic: true, postEventPublicUntil: FUTURE }),
      ).toBe(true);
    });

    it('nascosto (404) quando la finestra postEventPublicUntil è scaduta', () => {
      expect(
        isEventPubliclyVisible({ ...base, postEventPublic: true, postEventPublicUntil: PAST }),
      ).toBe(false);
    });
  });
});

describe('isEventOpenForRegistration', () => {
  it('aperta per PUBLISHED/LIVE e per PROVISIONING/IDLE schedulati non finiti', () => {
    for (const status of ['PUBLISHED', 'LIVE']) {
      expect(
        isEventOpenForRegistration({ status, eventType: 'SCHEDULED', endsAt: FUTURE }),
      ).toBe(true);
    }
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(
        isEventOpenForRegistration({ status, eventType: 'SCHEDULED', endsAt: FUTURE }),
      ).toBe(true);
    }
  });

  it('chiusa per ENDED/DRAFT/ARCHIVED, per le instant in warm-up e per gli IDLE incagliati post-fine', () => {
    for (const status of ['ENDED', 'DRAFT', 'ARCHIVED']) {
      expect(
        isEventOpenForRegistration({ status, eventType: 'SCHEDULED', endsAt: PAST }),
      ).toBe(false);
    }
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(
        isEventOpenForRegistration({ status, eventType: 'INSTANT', endsAt: FUTURE }),
      ).toBe(false);
      expect(
        isEventOpenForRegistration({ status, eventType: 'SCHEDULED', endsAt: PAST }),
      ).toBe(false);
    }
  });

  it('un evento mai aperto oltre la sua fine non accetta iscrizioni, qualunque stato abbia ancora', () => {
    // Fra `endsAt` e il giro del ciclo di vita che lo chiude, un PUBLISHED
    // rimasto tale non deve accettare iscrizioni né mandare conferme.
    expect(
      isEventOpenForRegistration({ status: 'PUBLISHED', eventType: 'SCHEDULED', endsAt: PAST }),
    ).toBe(false);
    // Il confine è stretto: alla fine esatta è già chiuso.
    const fine = new Date('2027-01-01T10:00:00Z');
    expect(
      isEventOpenForRegistration(
        { status: 'PUBLISHED', eventType: 'SCHEDULED', endsAt: fine },
        fine.getTime(),
      ),
    ).toBe(false);
    expect(
      isEventOpenForRegistration(
        { status: 'PUBLISHED', eventType: 'SCHEDULED', endsAt: fine },
        fine.getTime() - 1,
      ),
    ).toBe(true);
  });

  it('un evento LIVE oltre la fine resta aperto: la grace e le sale a tempo indefinito sono legittime', () => {
    expect(
      isEventOpenForRegistration({ status: 'LIVE', eventType: 'SCHEDULED', endsAt: PAST }),
    ).toBe(true);
  });

  it('REGISTRABLE_STATUSES (per il client) coincide con gli stati aperti lato server', () => {
    expect(REGISTRABLE_STATUSES).toEqual(['PUBLISHED', 'PROVISIONING', 'IDLE', 'LIVE']);
  });
});

describe('publicEventStatusWhere', () => {
  it('separa PUBLISHED/LIVE (sempre), warm-up schedulati non finiti, e ENDED col gate post-evento', () => {
    const where = publicEventStatusWhere();
    expect(where.OR).toHaveLength(3);
    expect(where.OR?.[0]).toEqual({
      status: { in: ['PUBLISHED', 'LIVE'] },
      eventType: { not: 'INSTANT' },
    });

    const warmup = where.OR?.[1] as {
      status: { in: string[] };
      eventType: { not: string };
      endsAt: { gt: Date };
    };
    expect(warmup.status).toEqual({ in: ['PROVISIONING', 'IDLE'] });
    expect(warmup.eventType).toEqual({ not: 'INSTANT' });
    expect(warmup.endsAt.gt).toBeInstanceOf(Date);

    const ended = where.OR?.[2] as {
      status: string;
      postEventPublic: boolean;
      OR: unknown[];
    };
    expect(ended.status).toBe('ENDED');
    expect(ended.postEventPublic).toBe(true);
    expect(ended.OR).toEqual([
      { postEventPublicUntil: null },
      { postEventPublicUntil: { gt: expect.any(Date) } },
    ]);
  });

  it('includeEnded: false esclude del tutto gli ENDED', () => {
    const where = publicEventStatusWhere({ includeEnded: false });
    expect(where.OR).toHaveLength(2);
    const serialized = (where.OR ?? []).map((c) => JSON.stringify(c));
    expect(serialized.some((s) => s.includes('ENDED'))).toBe(false);
  });

  it('includeEnded: false mostra un evento mai aperto solo prima della sua fine; LIVE sempre', () => {
    // Home e calendario pubblico: un PUBLISHED oltre la fine, non ancora
    // chiuso dal giro del ciclo di vita, non deve occupare il posto di un
    // evento in arrivo. Un evento LIVE è in corso (grace compresa).
    const where = publicEventStatusWhere({ includeEnded: false });
    expect(where.OR?.[0]).toEqual({ status: 'LIVE', eventType: { not: 'INSTANT' } });
    const futuri = where.OR?.[1] as {
      status: { in: string[] };
      eventType: { not: string };
      endsAt: { gt: Date };
    };
    expect(futuri.status).toEqual({ in: ['PUBLISHED', 'PROVISIONING', 'IDLE'] });
    expect(futuri.eventType).toEqual({ not: 'INSTANT' });
    expect(futuri.endsAt.gt).toBeInstanceOf(Date);
  });

  it('senza opzioni il PUBLISHED resta senza vincolo di tempo (elenchi, sitemap, API)', () => {
    const where = publicEventStatusWhere();
    expect(where.OR?.[0]).toEqual({
      status: { in: ['PUBLISHED', 'LIVE'] },
      eventType: { not: 'INSTANT' },
    });
  });
});

/**
 * La pagina pubblica dell'evento è una cosa diversa dal «si può stare in questa
 * stanza»: una chiamata istantanea è viva e raggiungibile dal link, ma non ha
 * una scheda da pubblicare. Tenere insieme le due domande spegnerebbe il canale
 * live e i materiali delle istantanee, che stanno DENTRO la sala.
 */
describe('isEventPageVisible', () => {
  const base = {
    endsAt: new Date(Date.now() + 3_600_000),
    postEventPublic: true,
    postEventPublicUntil: null,
  };

  it('una chiamata istantanea viva non ha pagina pubblica', () => {
    for (const status of ['PUBLISHED', 'LIVE', 'PROVISIONING', 'IDLE']) {
      const event = { ...base, status, eventType: 'INSTANT' };
      expect(isEventPageVisible(event), status).toBe(false);
      // …ma resta una stanza in cui si sta, altrimenti il canale realtime e i
      // materiali della chiamata si spegnerebbero con lei.
      if (status === 'LIVE') expect(isEventPubliclyVisible(event)).toBe(true);
    }
  });

  it('un evento a calendario non cambia comportamento', () => {
    for (const status of ['PUBLISHED', 'LIVE']) {
      expect(
        isEventPageVisible({ ...base, status, eventType: 'SCHEDULED' }),
        status,
      ).toBe(true);
    }
  });

  it('a chiamata finita la scheda esiste solo se qualcuno l\u2019ha accesa', () => {
    const finita = (postEventPublic: boolean) => ({
      ...base,
      status: 'ENDED',
      eventType: 'INSTANT',
      postEventPublic,
    });
    expect(isEventPageVisible(finita(false))).toBe(false);
    expect(isEventPageVisible(finita(true))).toBe(true);
  });
});

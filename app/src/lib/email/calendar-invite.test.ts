import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il reinvio dell'invito di calendario a tutte le persone di un evento: chi
 * lo riceve, con quale link, una volta sola per versione dell'evento.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    registration: { count: vi.fn(), findMany: vi.fn() },
    eventModerator: { count: vi.fn(), findMany: vi.fn() },
    eventOrganizer: { findFirst: vi.fn(async () => ({ name: 'Ente di prova' })) },
  },
}));
vi.mock('@/lib/email/outbox', () => ({
  enqueueEmailOnce: vi.fn(),
  enqueueEmail: vi.fn(),
}));
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({
    siteName: 'Portale eventi',
    defaultLocale: 'it',
    publicRegistrationEnabled: true,
  })),
}));
vi.mock('@/lib/crypto/pii', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  tryDecryptPII: (v: string | null) => v,
}));

import { prisma } from '@/lib/db';
import { EMAIL_LOCALES } from '@/lib/email/lingua';
import { hashEmail } from '@/lib/crypto/pii';
import { enqueueEmail, enqueueEmailOnce } from '@/lib/email/outbox';

import {
  calendarInviteEmail,
  canSendCalendarInvites,
  countCalendarInviteRecipients,
  sendCalendarInvites,
  sendStaffCalendarUpdates,
} from './calendar-invite';

const db = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn> };
  registration: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  eventModerator: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};
const enqueue = enqueueEmailOnce as unknown as ReturnType<typeof vi.fn>;
const enqueueSenzaChiave = enqueueEmail as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '0e5c3a9e-4b1d-4c7e-9f2a-6d8b1c3e5f70';
const PRIMARY_TOKEN = '7b2f9c1e-3a4d-4e5f-8a6b-9c0d1e2f3a4b';
const GRANT_TOKEN = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const UPDATED = new Date('2027-02-01T08:00:00Z');
const STARTS = new Date(Date.now() + 86_400_000);
const ENDS = new Date(Date.now() + 90_000_000);
const ORARIO = `${Math.floor(STARTS.getTime() / 1000)}-${Math.floor(ENDS.getTime() / 1000)}`;

function eventRow(over: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    slug: 'incontro-mensile',
    title: { it: 'Incontro mensile', en: 'Monthly meeting' },
    description: { it: 'Ordine del giorno' },
    status: 'PUBLISHED',
    startsAt: STARTS,
    endsAt: ENDS,
    timezone: 'Europe/Rome',
    updatedAt: UPDATED,
    accessMode: null,
    moderatorToken: PRIMARY_TOKEN,
    moderatorName: 'Relatore 1',
    moderatorEmail: 'moderatore@example.test',
    ...over,
  };
}

const REGS = [
  { id: 'reg-1', email: 'anna@example.test', accessToken: 'tok-anna', locale: 'it' },
  { id: 'reg-2', email: 'bob@example.test', accessToken: 'tok-bob', locale: 'en' },
];
const GRANTS = [
  {
    id: 'grant-1',
    name: 'Relatrice 2',
    email: 'relatrice@example.test',
    role: 'SPEAKER',
    token: GRANT_TOKEN,
  },
];

type Queued = {
  to: string;
  subject: string;
  text: string;
  html: string;
  dedupKey: string;
  metadata: Record<string, unknown>;
  calendarInvite: { method: string; content: string };
};
const sentTo = (to: string) =>
  enqueue.mock.calls.map((c) => c[0] as Queued).find((m) => m.to === to)!;
const unfold = (s: string) => s.replace(/\r\n /g, '');

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://portale.example.test';
  process.env.APP_SECRET = 'segreto-di-prova-lungo-almeno-trentadue-caratteri';
  db.event.findUnique.mockResolvedValue(eventRow());
  db.registration.count.mockResolvedValue(REGS.length);
  db.registration.findMany.mockResolvedValue(REGS);
  db.eventModerator.count.mockResolvedValue(GRANTS.length);
  db.eventModerator.findMany.mockResolvedValue(GRANTS);
  enqueue.mockResolvedValue(true);
});

describe('countCalendarInviteRecipients', () => {
  it('iscritti, concessioni attive con indirizzo e il moderatore principale', async () => {
    expect(await countCalendarInviteRecipients(EVENT_ID)).toEqual({
      registrations: 2,
      grants: 1,
      primary: 1,
      total: 4,
    });
    expect(db.eventModerator.count).toHaveBeenCalledWith({
      where: { eventId: EVENT_ID, revokedAt: null, email: { not: null } },
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('il principale senza indirizzo non si conta', async () => {
    db.event.findUnique.mockResolvedValue(eventRow({ moderatorEmail: null }));
    expect((await countCalendarInviteRecipients(EVENT_ID)).primary).toBe(0);
  });
});

describe('sendCalendarInvites', () => {
  it('ognuno riceve il suo invito: iscritti nella loro lingua, chi conduce con il suo token', async () => {
    const res = await sendCalendarInvites(EVENT_ID, { staffLocale: 'it' });
    expect(res).toMatchObject({ queued: 4, alreadyQueued: 0, failed: 0 });

    const anna = sentTo('anna@example.test');
    expect(anna.subject).toBe('Invito per il calendario: Incontro mensile');
    // Nell'email il link con la prova dell'indirizzo, nell'invito quello della sala.
    expect(anna.text).toContain('/registrations/enter?token=tok-anna');
    const annaIcs = unfold(anna.calendarInvite.content);
    expect(anna.calendarInvite.method).toBe('REQUEST');
    expect(annaIcs).toContain(
      'URL:https://portale.example.test/it/eventi/incontro-mensile/live?token=tok-anna'
    );
    expect(annaIcs).toMatch(/^ATTENDEE;[^\r\n]*:mailto:anna@example\.test\r?$/m);
    expect(annaIcs).toContain(`UID:${EVENT_ID}.registration.`);
    // Una volta per persona e per orario: non per SEQUENCE, che cresce anche
    // con i cambi di stato del ciclo di vita.
    expect(anna.dedupKey).toBe(
      `calendar-invite:${EVENT_ID}:${ORARIO}:registration:reg-1:${hashEmail('anna@example.test').slice(0, 16)}`
    );
    // Nella chiave (in chiaro nella coda) ne' indirizzi ne' token.
    for (const m of enqueue.mock.calls.map((c) => c[0] as Queued)) {
      expect(m.dedupKey).not.toMatch(/@|tok-|7b2f9c1e|1c2d3e4f/);
    }

    expect(sentTo('bob@example.test').subject).toBe(
      'Calendar invitation: Monthly meeting'
    );

    const relatrice = sentTo('relatrice@example.test');
    expect(relatrice.text).toContain(
      `/it/eventi/incontro-mensile/live?token=${GRANT_TOKEN}`
    );
    expect(relatrice.text).toContain('Questo link è personale');
    expect(unfold(relatrice.calendarInvite.content)).toContain(`UID:${EVENT_ID}.grant.`);
    expect(relatrice.metadata).toMatchObject({
      kind: 'calendar-invite',
      seat: 'SPEAKER',
    });

    const principale = sentTo('moderatore@example.test');
    const principaleIcs = unfold(principale.calendarInvite.content);
    expect(principaleIcs).toContain(
      `URL:https://portale.example.test/it/eventi/incontro-mensile/live?token=${PRIMARY_TOKEN}`
    );
    expect(principaleIcs).toContain(`UID:${EVENT_ID}.primary.`);
    // Il token di chi conduce non va in LOCATION, che i promemoria mostrano a schermo.
    expect(principaleIcs).toContain(
      'LOCATION:https://portale.example.test/it/eventi/incontro-mensile\r'
    );
    expect(annaIcs).toContain(
      'LOCATION:https://portale.example.test/it/eventi/incontro-mensile/live?token=tok-anna'
    );
    // L'oggetto e i metadati (in chiaro nella coda) non portano link.
    for (const m of enqueue.mock.calls.map((c) => c[0] as Queued)) {
      expect(m.subject).not.toMatch(/token|tok-/);
      expect(JSON.stringify(m.metadata)).not.toMatch(/token|tok-|@/);
    }
  });

  it('i destinatari si contano dalle righe lette, senza altre query', async () => {
    const res = await sendCalendarInvites(EVENT_ID, { staffLocale: 'it' });
    expect(res!.recipients).toEqual({
      registrations: 2,
      grants: 1,
      primary: 1,
      total: 4,
    });
    expect(db.registration.count).not.toHaveBeenCalled();
  });

  it('solo chi conduce, con il testo del cambio di data, sempre (senza chiave)', async () => {
    await sendStaffCalendarUpdates(EVENT_ID, { staffLocale: 'en' });
    await sendStaffCalendarUpdates(EVENT_ID, { staffLocale: 'en' });
    expect(db.registration.findMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    const mails = enqueueSenzaChiave.mock.calls.map(
      (c) => c[0] as Queued & { dedupKey?: string }
    );
    // Un ritorno a un orario gia' usato deve arrivare: nessuna chiave.
    expect(mails).toHaveLength(4);
    expect(mails.every((m) => m.dedupKey === undefined)).toBe(true);
    expect(mails.map((m) => m.to).sort()).toEqual([
      'moderatore@example.test',
      'moderatore@example.test',
      'relatrice@example.test',
      'relatrice@example.test',
    ]);
    const relatrice = mails.find((m) => m.to === 'relatrice@example.test')!;
    expect(relatrice.subject).toBe('New date: Monthly meeting');
    expect(relatrice.text).toContain('your link to join the room does not change');
  });

  it('salta il principale quando il suo link (con l’invito) parte nello stesso salvataggio', async () => {
    await sendStaffCalendarUpdates(EVENT_ID, { staffLocale: 'it', skipPrimary: true });
    const destinatari = enqueueSenzaChiave.mock.calls.map((c) => (c[0] as Queued).to);
    expect(destinatari).toEqual(['relatrice@example.test']);
  });

  it('un token rinnovato o un indirizzo corretto permettono un nuovo reinvio', async () => {
    await sendCalendarInvites(EVENT_ID, { staffLocale: 'it' });
    const prima = sentTo('moderatore@example.test').dedupKey;
    enqueue.mockClear();
    db.event.findUnique.mockResolvedValue(
      eventRow({ moderatorToken: 'token-rinnovato' })
    );
    await sendCalendarInvites(EVENT_ID, { staffLocale: 'it' });
    expect(sentTo('moderatore@example.test').dedupKey).not.toBe(prima);
  });

  it('l’aggiornamento dopo il cambio di data non lancia mai', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.event.findUnique.mockRejectedValue(new Error('db down'));
    await expect(
      sendStaffCalendarUpdates(EVENT_ID, { staffLocale: 'it' })
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('ripetere la richiesta non rispedisce: conta quelle già in coda', async () => {
    enqueue.mockResolvedValue(false);
    expect(await sendCalendarInvites(EVENT_ID, { staffLocale: 'it' })).toMatchObject({
      queued: 0,
      alreadyQueued: 4,
      failed: 0,
    });
  });

  it('una persona che non va in coda non ferma le altre', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    enqueue.mockRejectedValueOnce(new Error('pool timeout'));
    expect(await sendCalendarInvites(EVENT_ID, { staffLocale: 'it' })).toMatchObject({
      queued: 3,
      failed: 1,
    });
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/tok-|@example/);
    spy.mockRestore();
  });

  it('niente per un evento concluso, in bozza o già finito', async () => {
    for (const over of [
      { status: 'ENDED' },
      { status: 'DRAFT' },
      { endsAt: new Date(Date.now() - 60_000) },
    ]) {
      db.event.findUnique.mockResolvedValue(eventRow(over));
      const res = await sendCalendarInvites(EVENT_ID, { staffLocale: 'it' });
      expect(res).toMatchObject({ queued: 0, failed: 0 });
    }
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('null per un evento che non esiste', async () => {
    db.event.findUnique.mockResolvedValue(null);
    expect(await sendCalendarInvites(EVENT_ID, { staffLocale: 'it' })).toBeNull();
  });
});

describe('canSendCalendarInvites', () => {
  it('solo pubblicato (o in corso) e non ancora finito', () => {
    const futuro = new Date(Date.now() + 60_000);
    expect(canSendCalendarInvites({ status: 'PUBLISHED', endsAt: futuro })).toBe(true);
    expect(canSendCalendarInvites({ status: 'LIVE', endsAt: futuro })).toBe(true);
    expect(canSendCalendarInvites({ status: 'ARCHIVED', endsAt: futuro })).toBe(false);
  });
});

describe('calendarInviteEmail', () => {
  it('ha i testi in ogni lingua delle email, con il titolo protetto nell’HTML', () => {
    for (const [locale, reason] of EMAIL_LOCALES.flatMap((l) =>
      (['invite', 'date-change'] as const).map((r) => [l, r] as const)
    )) {
      const mail = calendarInviteEmail({
        locale,
        reason,
        eventTitle: 'Titolo <b>',
        eventDate: '1 marzo',
        eventTime: '10:00',
        joinUrl: 'https://portale.example.test/x?token=t&a=b',
      });
      expect(mail.subject).toContain('Titolo <b>');
      expect(mail.html).toContain('Titolo &lt;b&gt;');
      expect(mail.html).not.toContain('Titolo <b>');
      expect(mail.html).toContain(`lang="${locale}"`);
      expect(mail.text).toContain('https://portale.example.test/x?token=t&a=b');
    }
  });
});

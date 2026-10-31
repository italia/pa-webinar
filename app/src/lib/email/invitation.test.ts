// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * L'invito per email: porta alla pagina d'iscrizione compilata, salta chi e'
 * gia' iscritto, non parte da una bozza, e segna l'invio solo con l'email in
 * coda.
 */
const db = vi.hoisted(() => ({
  event: { findUnique: vi.fn() },
  eventInvitation: {
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  registration: { findMany: vi.fn() },
}));
const coda = vi.hoisted(() => ({ enqueueEmailOnce: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/email/outbox', () => coda);
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({
    siteName: 'Sito di prova',
    publicRegistrationEnabled: true,
  }),
}));
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string | null) => v,
  hashEmail: (v: string) => `h:${v}`,
}));

import {
  invitationEmail,
  invitoDaToken,
  sendInvitations,
  InvitiNonInviabili,
} from './invitation';

const evento = {
  id: 'e1',
  slug: 'evento-prova',
  title: { it: 'Evento di prova' },
  status: 'PUBLISHED',
  eventType: 'SCHEDULED',
  accessMode: 'INVITATION',
  startsAt: new Date('2099-11-10T09:00:00Z'),
  endsAt: new Date('2099-11-10T10:00:00Z'),
  timezone: 'Europe/Rome',
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://webinar.example.org');
  for (const f of [
    db.event.findUnique,
    db.eventInvitation.findMany,
    db.eventInvitation.update,
    db.eventInvitation.updateMany,
    db.eventInvitation.findUnique,
    db.registration.findMany,
    coda.enqueueEmailOnce,
  ])
    f.mockReset();
  db.event.findUnique.mockResolvedValue(evento);
  db.registration.findMany.mockResolvedValue([]);
  coda.enqueueEmailOnce.mockResolvedValue(true);
});

describe('invitationEmail', () => {
  it('nella lingua scelta, con il link e il nome protetti', () => {
    const m = invitationEmail({
      locale: 'en',
      name: 'Ada <b>',
      eventTitle: 'Webinar',
      eventDate: '10 Nov 2026',
      eventTime: '10:00',
      registerUrl: 'https://x/en/events/w/registration?invito=abc',
      onlyInvited: true,
    });
    expect(m.subject).toBe('Invitation: Webinar');
    expect(m.html).toContain('Ada &lt;b&gt;');
    expect(m.html).toContain('https://x/en/events/w/registration?invito=abc');
    expect(m.text).toContain('Registration is reserved for invited people');
  });
});

describe('sendInvitations', () => {
  it("scrive il token solo se manca, accoda una volta per giro, segna l'invio dopo la coda", async () => {
    db.eventInvitation.findMany.mockResolvedValue([
      {
        id: 'i1',
        name: 'Persona 1',
        email: 'p1@example.org',
        emailHash: 'h:p1@example.org',
        token: null,
        sentAt: null,
      },
    ]);
    db.eventInvitation.findUnique.mockResolvedValue({ token: 'salvato' });
    const ordine: string[] = [];
    db.eventInvitation.updateMany.mockImplementation(async () => {
      ordine.push('token');
    });
    db.eventInvitation.update.mockImplementation(async () => {
      ordine.push('sentAt');
    });
    coda.enqueueEmailOnce.mockImplementation(async () => {
      ordine.push('email');
      return true;
    });
    expect(await sendInvitations('e1', { locale: 'it' })).toEqual({
      sent: 1,
      skipped: 0,
      remaining: 0,
    });
    expect(ordine).toEqual(['token', 'email', 'sentAt']);
    // Il token scritto solo dove manca; l'email porta quello riletto.
    expect(db.eventInvitation.updateMany.mock.calls[0]![0].where).toEqual({
      id: 'i1',
      token: null,
    });
    const mail = coda.enqueueEmailOnce.mock.calls[0]![0] as {
      to: string;
      html: string;
      subject: string;
      text: string;
      dedupKey: string;
    };
    expect(mail.html).toContain('invito=salvato');
    expect(mail.dedupKey).toBe('event-invitation:i1:primo');
    expect(mail.to).toBe('p1@example.org');
    expect(mail.subject).toBe('Invito: Evento di prova');
    // L'iscrizione e' riservata agli invitati: l'email lo dice.
    expect(mail.text).toContain("L'iscrizione è riservata alle persone invitate");
    // Senza ids: solo chi non ha mai ricevuto l'invito.
    expect(db.eventInvitation.findMany.mock.calls[0]![0].where).toMatchObject({
      eventId: 'e1',
      sentAt: null,
    });
  });

  it("un invio uguale gia' in coda non conta e non sposta la data", async () => {
    db.eventInvitation.findMany.mockResolvedValue([
      {
        id: 'i1',
        name: null,
        email: 'p1@example.org',
        emailHash: 'h:p1@example.org',
        token: 't',
        sentAt: new Date('2026-10-30T10:00:00Z'),
      },
    ]);
    coda.enqueueEmailOnce.mockResolvedValue(false);
    expect(await sendInvitations('e1', { ids: ['i1'], locale: 'it' })).toEqual({
      sent: 0,
      skipped: 1,
      remaining: 0,
    });
    expect(
      (coda.enqueueEmailOnce.mock.calls[0]![0] as { dedupKey: string }).dedupKey
    ).toBe('event-invitation:i1:2026-10-30T10:00:00.000Z');
    expect(db.eventInvitation.update).not.toHaveBeenCalled();
  });

  it("salta chi si e' gia' iscritto: con un elenco lo conta, invitando tutti no", async () => {
    const righe = [
      {
        id: 'i1',
        name: null,
        email: 'p1@example.org',
        emailHash: 'h:p1@example.org',
        token: 'gia-dato',
        sentAt: null,
      },
      {
        id: 'i2',
        name: null,
        email: 'p2@example.org',
        emailHash: 'h:p2@example.org',
        token: null,
        sentAt: null,
      },
    ];
    db.eventInvitation.findMany.mockResolvedValue(righe);
    db.registration.findMany.mockResolvedValue([{ emailHash: 'h:p2@example.org' }]);
    expect(await sendInvitations('e1', { ids: ['i1', 'i2'], locale: 'it' })).toEqual({
      sent: 1,
      skipped: 1,
      remaining: 0,
    });
    expect((coda.enqueueEmailOnce.mock.calls[0]![0] as { html: string }).html).toContain(
      'invito=gia-dato'
    );
    expect(db.eventInvitation.updateMany).not.toHaveBeenCalled();
    expect(await sendInvitations('e1', { locale: 'it' })).toEqual({
      sent: 1,
      skipped: 0,
      remaining: 0,
    });
  });

  it('una bozza, una chiamata rapida o un evento finito non mandano inviti', async () => {
    for (const altro of [
      { status: 'DRAFT' },
      { eventType: 'INSTANT' },
      { endsAt: new Date('2020-01-01T00:00:00Z') },
    ]) {
      db.event.findUnique.mockResolvedValue({ ...evento, ...altro });
      await expect(sendInvitations('e1', { locale: 'it' })).rejects.toBeInstanceOf(
        InvitiNonInviabili
      );
    }
    expect(coda.enqueueEmailOnce).not.toHaveBeenCalled();
  });

  it("un evento che non esiste da' null", async () => {
    db.event.findUnique.mockResolvedValue(null);
    expect(await sendInvitations('e1', { locale: 'it' })).toBeNull();
  });
});

describe('invitoDaToken', () => {
  it("trova l'invito del token per quell'evento, e ignora token assurdi", async () => {
    db.eventInvitation.findFirst.mockResolvedValue({
      name: 'Persona 1',
      email: 'p1@example.org',
    });
    expect(await invitoDaToken('e1', 'abc')).toEqual({
      name: 'Persona 1',
      email: 'p1@example.org',
    });
    expect(db.eventInvitation.findFirst).toHaveBeenCalledWith({
      where: { eventId: 'e1', token: 'abc' },
      select: { name: true, email: true },
    });
    db.eventInvitation.findFirst.mockClear();
    expect(await invitoDaToken('e1', 'x'.repeat(65))).toBeNull();
    expect(await invitoDaToken('e1', null)).toBeNull();
    expect(db.eventInvitation.findFirst).not.toHaveBeenCalled();
  });
});

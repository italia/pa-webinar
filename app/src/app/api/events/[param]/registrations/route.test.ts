// @vitest-environment node
/**
 * Chi può iscriversi quando l'amministrazione spegne l'iscrizione pubblica.
 *
 * Spenta, l'elenco degli invitati dell'evento diventa l'elenco di chi può
 * iscriversi, e il link personale lo consegna solo l'email: chi compila il
 * modulo non ha provato di possedere l'indirizzo. La risposta è la stessa per
 * chiunque, così da qui non si scopre chi è invitato; chi era già iscritto
 * riceve di nuovo il link nella propria casella.
 */
import type { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { siteSettings, tx } = vi.hoisted(() => ({
  siteSettings: { publicRegistrationEnabled: true },
  tx: {
    registration: { findUnique: vi.fn(), create: vi.fn() },
    gdprAuditLog: { create: vi.fn() },
    eventInvitation: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock('@/lib/settings', () => ({ getSettings: async () => siteSettings }));
vi.mock('@/lib/persons', () => ({ upsertPersonOnRegistration: vi.fn(async () => null) }));
vi.mock('@/lib/email/confirmation', () => ({ sendConfirmationEmail: vi.fn() }));

import { prisma } from '@/lib/db';
import { hashEmail } from '@/lib/crypto/pii';
import { sendConfirmationEmail } from '@/lib/email/confirmation';
import { verifyRegistrationEntry } from '@/lib/events/registration-link';

import { POST } from './route';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const SLUG = 'evento-di-prova';

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.APP_SECRET = 'test-app-secret-per-la-rotta-delle-iscrizioni';
  process.env.NEXT_PUBLIC_APP_URL = 'https://webinar.example.gov.it';
});

let ipCounter = 0;

function iscriviti(email: string): Promise<Response> {
  ipCounter += 1;
  const request = new Request(`http://localhost:3000/api/events/${SLUG}/registrations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.1.0.${ipCounter}`,
    },
    body: JSON.stringify({ displayName: 'Anna Bianchi', email, consentGiven: true }),
  });
  return POST(request as unknown as NextRequest, {
    params: Promise.resolve({ param: SLUG }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  siteSettings.publicRegistrationEnabled = true;
  vi.mocked(prisma.event.findUnique).mockResolvedValue({
    id: EVENT_ID,
    slug: SLUG,
    status: 'PUBLISHED',
    eventType: 'SCHEDULED',
    endsAt: new Date(Date.now() + 3_600_000),
    recordingEnabled: false,
    multitrackRecordingEnabled: false,
    _count: { registrations: 0 },
  } as never);
  tx.registration.findUnique.mockResolvedValue(null);
  tx.registration.create.mockImplementation(async ({ data }: { data: object }) => ({
    id: 'reg-1',
    ...data,
  }));
  tx.gdprAuditLog.create.mockResolvedValue({});
  tx.eventInvitation.findFirst.mockResolvedValue(null);
});

/** Il link personale passato all'email, come oggetto URL. */
function linkEmail(): URL {
  const input = vi.mocked(sendConfirmationEmail).mock.calls[0]?.[0];
  if (!input) throw new Error('nessuna email accodata');
  return new URL(input.joinUrl);
}

describe('POST registrations — iscrizione pubblica', () => {
  it('accesa: chiunque si iscrive, senza guardare gli inviti', async () => {
    const res = await iscriviti('anna@example.com');
    expect(res.status).toBe(201);
    expect(tx.eventInvitation.findFirst).not.toHaveBeenCalled();
  });

  it('accesa: token, link e cookie nella risposta; nell\'email il link della sala', async () => {
    const res = await iscriviti('anna@example.com');
    const body = (await res.json()) as { accessToken: string; joinUrl: string };
    expect(body.accessToken).toBeTruthy();
    expect(body.joinUrl).toContain(`/live?token=${body.accessToken}`);
    expect(res.headers.get('Set-Cookie')).toContain(`event_access_${EVENT_ID}=`);
    expect(linkEmail().pathname).toBe(`/it/eventi/${SLUG}/live`);
  });

  it('accesa: un indirizzo già iscritto riceve «già iscritto»', async () => {
    tx.registration.findUnique.mockResolvedValue({
      id: 'reg-vecchia',
      accessToken: 'tok-vecchio',
      locale: 'it',
    });
    const res = await iscriviti('anna@example.com');
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ALREADY_REGISTERED');
  });
});

describe('POST registrations — iscrizione pubblica spenta', () => {
  beforeEach(() => {
    siteSettings.publicRegistrationEnabled = false;
  });

  /** La risposta uguale per chiunque: niente token, link o cookie. */
  async function rispostaNeutra(res: Response) {
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ eventSlug: SLUG, delivery: 'email' });
    expect(res.headers.get('Set-Cookie')).toBeNull();
  }

  it('un indirizzo non invitato: risposta neutra, nessuna iscrizione, nessuna email', async () => {
    const res = await iscriviti('anna@example.com');
    await rispostaNeutra(res);
    expect(tx.registration.create).not.toHaveBeenCalled();
    expect(sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('un indirizzo invitato si iscrive, cercato per impronta e senza badare a maiuscole', async () => {
    tx.eventInvitation.findFirst.mockResolvedValue({ id: 'inv-1' });

    const res = await iscriviti('Anna@Example.com');
    await rispostaNeutra(res);
    expect(tx.registration.create).toHaveBeenCalledTimes(1);
    const where = tx.eventInvitation.findFirst.mock.calls[0]?.[0]?.where as {
      eventId: string;
      OR: Array<Record<string, unknown>>;
    };
    expect(where.eventId).toBe(EVENT_ID);
    expect(where.OR).toContainEqual({ emailHash: hashEmail('anna@example.com') });
  });

  it("l'invitato riceve il link solo per email, firmato per legare il browser che lo apre", async () => {
    tx.eventInvitation.findFirst.mockResolvedValue({ id: 'inv-1' });

    await iscriviti('anna@example.com');
    const token = tx.registration.create.mock.calls[0]?.[0]?.data?.accessToken as string;
    const link = linkEmail();
    expect(link.pathname).toBe(`/api/events/${SLUG}/registrations/enter`);
    expect(link.searchParams.get('token')).toBe(token);
    expect(verifyRegistrationEntry(EVENT_ID, token, link.searchParams.get('sig') ?? '')).toBe(true);
    // Gli eventi di calendario, che si inoltrano, hanno il link della sala.
    const calendario = vi.mocked(sendConfirmationEmail).mock.calls[0]?.[0]?.calendarJoinUrl ?? '';
    expect(new URL(calendario).pathname).toBe(`/it/eventi/${SLUG}/live`);
    expect(new URL(calendario).searchParams.has('sig')).toBe(false);
  });

  it('chi si era già iscritto: risposta neutra e il suo link di nuovo nella sua casella', async () => {
    tx.registration.findUnique.mockResolvedValue({
      id: 'reg-vecchia',
      accessToken: 'tok-vecchio',
      locale: 'en',
    });

    const res = await iscriviti('anna@example.com');
    await rispostaNeutra(res);
    expect(tx.registration.create).not.toHaveBeenCalled();
    // Già iscritto non vuol dire invitato: non si guarda l'elenco.
    expect(tx.eventInvitation.findFirst).not.toHaveBeenCalled();
    const input = vi.mocked(sendConfirmationEmail).mock.calls[0]?.[0];
    expect(input?.registrationId).toBe('reg-vecchia');
    // Nella lingua dell'iscrizione, non in quella di chi ha compilato ora.
    expect(input?.locale).toBe('en');
    expect(linkEmail().searchParams.get('token')).toBe('tok-vecchio');
  });
});

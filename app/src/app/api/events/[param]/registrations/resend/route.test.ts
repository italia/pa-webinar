// @vitest-environment node
/**
 * Il rinvio del link personale. Risponde sempre allo stesso modo; il link che
 * rimanda è quello della sala o, con l'iscrizione pubblica spenta, quello che
 * passa dalla rotta d'ingresso e fa dell'email la prova d'identità
 * (lib/events/registration-link).
 */
import type { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { siteSettings } = vi.hoisted(() => ({
  siteSettings: { publicRegistrationEnabled: true },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/settings', () => ({ getSettings: async () => siteSettings }));
vi.mock('@/lib/email/confirmation', () => ({ sendConfirmationEmail: vi.fn() }));

import { prisma } from '@/lib/db';
import { sendConfirmationEmail } from '@/lib/email/confirmation';
import { verifyRegistrationEntry } from '@/lib/events/registration-link';

import { POST } from './route';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const SLUG = 'evento-di-prova';
const TOKEN = 'tok-personale-di-prova-123';

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-lungo-almeno-trentadue-caratteri';
  process.env.NEXT_PUBLIC_APP_URL = 'https://webinar.example.gov.it';
});

let ipCounter = 0;

function rimanda(email: string): Promise<Response> {
  ipCounter += 1;
  const request = new Request(`http://localhost:3000/api/events/${SLUG}/registrations/resend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.2.0.${ipCounter}` },
    body: JSON.stringify({ email }),
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({ param: SLUG }) });
}

function linkEmail(): URL {
  const input = vi.mocked(sendConfirmationEmail).mock.calls[0]?.[0];
  if (!input) throw new Error('nessuna email accodata');
  return new URL(input.joinUrl);
}

beforeEach(() => {
  vi.clearAllMocks();
  siteSettings.publicRegistrationEnabled = true;
  vi.mocked(prisma.event.findUnique).mockResolvedValue({ id: EVENT_ID } as never);
  vi.mocked(prisma.registration.findUnique).mockResolvedValue({
    id: 'reg-1',
    accessToken: TOKEN,
    locale: 'it',
  } as never);
});

describe('POST registrations/resend', () => {
  it('iscrizione aperta: rimanda il link della sala', async () => {
    const res = await rimanda('anna@example.com');
    expect(res.status).toBe(200);
    const link = linkEmail();
    expect(link.pathname).toBe(`/it/eventi/${SLUG}/live`);
    expect(link.searchParams.get('token')).toBe(TOKEN);
  });

  it("iscrizione pubblica spenta: rimanda il link firmato della rotta d'ingresso", async () => {
    siteSettings.publicRegistrationEnabled = false;
    const res = await rimanda('anna@example.com');
    expect(res.status).toBe(200);
    const link = linkEmail();
    expect(link.pathname).toBe(`/api/events/${SLUG}/registrations/enter`);
    expect(verifyRegistrationEntry(EVENT_ID, TOKEN, link.searchParams.get('sig') ?? '')).toBe(true);
    const calendario = vi.mocked(sendConfirmationEmail).mock.calls[0]?.[0]?.calendarJoinUrl ?? '';
    expect(new URL(calendario).pathname).toBe(`/it/eventi/${SLUG}/live`);
  });

  it('indirizzo non iscritto: stessa risposta, nessuna email', async () => {
    vi.mocked(prisma.registration.findUnique).mockResolvedValue(null);
    const res = await rimanda('nessuno@example.com');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendConfirmationEmail).not.toHaveBeenCalled();
  });
});

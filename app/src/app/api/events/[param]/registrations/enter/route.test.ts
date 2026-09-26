// @vitest-environment node
/**
 * Il link personale dell'email quando l'iscrizione pubblica è spenta.
 *
 * Con la firma giusta il browser che lo apre diventa quello dell'iscritto (il
 * cookie `event_access`); in ogni altro caso va comunque nella sala con il
 * solo token, come un link inoltrato, e nessuna risposta distingue un token
 * esistente da uno inventato.
 */
import type { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';
import { verifyEventAccess } from '@/lib/event-session';
import { signRegistrationEntry } from '@/lib/events/registration-link';

import { GET } from './route';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ALTRO_EVENTO = '22222222-2222-4222-8222-222222222222';
const SLUG = 'evento-su-invito';
const TOKEN = 'tok-personale-di-prova-123';
const BASE = 'https://webinar.example.gov.it';

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-lungo-almeno-trentadue-caratteri';
  process.env.NEXT_PUBLIC_APP_URL = BASE;
});

function apri(query: Record<string, string>): Promise<Response> {
  const qs = new URLSearchParams(query);
  const request = new Request(
    `http://localhost:3000/api/events/${SLUG}/registrations/enter?${qs}`,
  );
  return GET(request as unknown as NextRequest, {
    params: Promise.resolve({ param: SLUG }),
  });
}

/** Il valore del cookie d'accesso impostato dalla risposta, se c'è. */
function cookieAccesso(res: Response): string | undefined {
  const header = res.headers.get('Set-Cookie');
  if (!header) return undefined;
  const [coppia] = header.split(';');
  const [nome, valore] = (coppia ?? '').split('=');
  expect(nome).toBe(`event_access_${EVENT_ID}`);
  return valore;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.event.findUnique).mockResolvedValue({
    id: EVENT_ID,
    endsAt: new Date(Date.now() + 3_600_000),
  } as never);
  vi.mocked(prisma.registration.findUnique).mockResolvedValue({
    eventId: EVENT_ID,
    locale: 'it',
  } as never);
});

describe('GET registrations/enter', () => {
  it("firma valida: il browser diventa quello dell'iscritto e va nella sala", async () => {
    const res = await apri({
      token: TOKEN,
      sig: signRegistrationEntry(EVENT_ID, TOKEN),
      lang: 'en',
    });

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`${BASE}/en/events/${SLUG}/live?token=${TOKEN}`);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    // Lo stesso cookie che si riceve iscrivendosi: la sala e il token Jitsi
    // lo riconoscono come il proprietario del token.
    await expect(verifyEventAccess(EVENT_ID, cookieAccesso(res))).resolves.toBe(TOKEN);
  });

  it('senza lingua nel link: quella dell\'iscrizione', async () => {
    const res = await apri({ token: TOKEN, sig: signRegistrationEntry(EVENT_ID, TOKEN) });
    expect(res.headers.get('Location')).toBe(`${BASE}/it/eventi/${SLUG}/live?token=${TOKEN}`);
  });

  it('firma assente o sbagliata: nella sala con il solo token, senza identità', async () => {
    for (const sig of ['', 'firma-inventata', signRegistrationEntry(EVENT_ID, 'altro')]) {
      const res = await apri({ token: TOKEN, sig });
      expect(res.status).toBe(303);
      expect(res.headers.get('Location')).toBe(`${BASE}/it/eventi/${SLUG}/live?token=${TOKEN}`);
      expect(res.headers.get('Set-Cookie')).toBeNull();
    }
  });

  it("token di un altro evento o inesistente: nessun cookie, decide la sala", async () => {
    vi.mocked(prisma.registration.findUnique).mockResolvedValueOnce({
      eventId: ALTRO_EVENTO,
      locale: 'it',
    } as never);
    const altro = await apri({ token: TOKEN, sig: signRegistrationEntry(EVENT_ID, TOKEN) });
    expect(altro.status).toBe(303);
    expect(altro.headers.get('Set-Cookie')).toBeNull();

    vi.mocked(prisma.registration.findUnique).mockResolvedValueOnce(null);
    const inesistente = await apri({ token: TOKEN, sig: signRegistrationEntry(EVENT_ID, TOKEN) });
    expect(inesistente.status).toBe(303);
    expect(inesistente.headers.get('Location')).toBe(
      `${BASE}/it/eventi/${SLUG}/live?token=${TOKEN}`,
    );
    expect(inesistente.headers.get('Set-Cookie')).toBeNull();
  });

  it('senza token: alla pagina dell\'evento', async () => {
    const res = await apri({});
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`${BASE}/it/eventi/${SLUG}`);
    expect(prisma.registration.findUnique).not.toHaveBeenCalled();
  });

  it('evento inesistente: 404', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValueOnce(null);
    const res = await apri({ token: TOKEN, sig: 'x' });
    expect(res.status).toBe(404);
  });
});

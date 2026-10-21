// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * L'arrivo dal link personale della visione: posa il cookie solo per un token
 * valido di un'iscrizione esistente, e porta sempre alla pagina dell'evento.
 */
const { db, outbox } = vi.hoisted(() => ({
  db: {
    event: { findUnique: vi.fn() },
    registration: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
  outbox: {
    enqueueEmail: vi.fn(async (_mail: { to: string; html: string }) => undefined),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/auth/app-secret', () => ({
  tryGetAppSecret: () => 'segreto-di-prova-abbastanza-lungo-per-hmac',
}));
vi.mock('@/lib/env', () => ({ getPublicEnv: () => 'https://webinar.example.gov.it' }));
vi.mock('@/lib/email/outbox', () => outbox);
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ siteName: 'PA Webinar', defaultLocale: 'it' }),
}));
vi.mock('@/lib/crypto/pii', () => ({
  hashEmail: (e: string) => `h:${e.toLowerCase()}`,
  decryptPII: (v: string) => v.replace(/^cifrato:/, ''),
}));

import { issueViewingToken } from '@/lib/recording/viewing';

import { GET, POST } from './route';

const ctx = () => ({ params: Promise.resolve({ param: 'webinar' }) });
const req = (query: string) =>
  new Request(
    `https://webinar.example.gov.it/api/events/webinar/recording/access${query}`
  ) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  db.event.findUnique.mockResolvedValue({ id: 'ev-1' });
  db.registration.findFirst.mockResolvedValue({ locale: 'en' });
});

describe('GET /api/events/[slug]/recording/access', () => {
  it("token valido: cookie della visione e pagina dell'evento nella lingua dell'iscrizione", async () => {
    const token = issueViewingToken('ev-1', 'reg-1')!;
    const res = await GET(req(`?t=${encodeURIComponent(token)}`), ctx());
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(
      'https://webinar.example.gov.it/en/events/webinar'
    );
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain(`recording_access_ev-1=${token}`);
    expect(cookie).toContain('HttpOnly');
    expect(db.registration.findFirst).toHaveBeenCalledWith({
      where: { id: 'reg-1', eventId: 'ev-1' },
      select: { locale: true },
    });
  });

  it("la lingua del link vince su quella dell'iscrizione", async () => {
    const token = issueViewingToken('ev-1', 'reg-1')!;
    const res = await GET(req(`?t=${encodeURIComponent(token)}&lang=it`), ctx());
    expect(res.headers.get('Location')).toBe(
      'https://webinar.example.gov.it/it/eventi/webinar'
    );
  });

  it('token non valido o di un altro evento: alla pagina, senza cookie', async () => {
    for (const t of ['nonvalido', issueViewingToken('ev-2', 'reg-1')!]) {
      const res = await GET(req(`?t=${encodeURIComponent(t)}`), ctx());
      expect(res.status).toBe(303);
      expect(res.headers.get('Set-Cookie')).toBeNull();
    }
    expect(db.registration.findFirst).not.toHaveBeenCalled();
  });

  it('iscrizione cancellata: niente cookie', async () => {
    db.registration.findFirst.mockResolvedValue(null);
    const res = await GET(
      req(`?t=${encodeURIComponent(issueViewingToken('ev-1', 'reg-1')!)}`),
      ctx()
    );
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('evento inesistente: 404', async () => {
    db.event.findUnique.mockResolvedValue(null);
    const res = await GET(req('?t=x'), ctx());
    expect(res.status).toBe(404);
  });
});

describe('POST /api/events/[slug]/recording/access', () => {
  const post = (body: unknown) =>
    new Request('https://webinar.example.gov.it/api/events/webinar/recording/access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}`,
      },
      body: JSON.stringify(body),
    }) as unknown as NextRequest;
  const riservata = {
    id: 'ev-1',
    slug: 'webinar',
    title: { it: 'Webinar' },
    status: 'ENDED',
    recordingPublished: true,
    transcriptPublished: false,
    recordingAudience: 'REGISTRANTS',
    postEventPublic: true,
    postEventPublicUntil: null,
  };

  it("iscritto a una registrazione riservata: accoda l'avviso con il link personale", async () => {
    db.event.findUnique.mockResolvedValue(riservata);
    db.registration.findUnique.mockResolvedValue({
      id: 'reg-1',
      email: 'cifrato:anna@ente.it',
      locale: 'it',
    });
    const res = await POST(post({ email: 'Anna@ente.it' }), ctx());
    expect(await res.json()).toEqual({ ok: true });
    expect(db.registration.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId_emailHash: { eventId: 'ev-1', emailHash: 'h:anna@ente.it' } },
      })
    );
    const mail = outbox.enqueueEmail.mock.calls[0]?.[0] as unknown as {
      to: string;
      html: string;
    };
    expect(mail.to).toBe('anna@ente.it');
    expect(mail.html).toContain('/api/events/webinar/recording/access?t=');
  });

  it('stessa risposta senza iscrizione, con email non valida o registrazione per tutti, e nessun invio', async () => {
    db.event.findUnique.mockResolvedValue(riservata);
    db.registration.findUnique.mockResolvedValue(null);
    expect(await (await POST(post({ email: 'nessuno@ente.it' }), ctx())).json()).toEqual({
      ok: true,
    });
    expect(await (await POST(post({ email: 'non-una-email' }), ctx())).json()).toEqual({
      ok: true,
    });
    db.event.findUnique.mockResolvedValue({ ...riservata, recordingAudience: 'PUBLIC' });
    db.registration.findUnique.mockResolvedValue({
      id: 'reg-1',
      email: 'cifrato:anna@ente.it',
      locale: 'it',
    });
    expect(await (await POST(post({ email: 'anna@ente.it' }), ctx())).json()).toEqual({
      ok: true,
    });
    expect(outbox.enqueueEmail).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * I link delle email per l'esercizio dei diritti (accesso, cancellazione)
 * devono puntare all'istanza che li ha spediti, letta a runtime. Con la
 * lettura puntata di `process.env.NEXT_PUBLIC_APP_URL` il valore lo fissava il
 * build, e ogni immagine pubblicata mandava `http://localhost:3000`: il
 * link non si apriva e il percorso self-service dei diritti era rotto. La
 * regola ESLint su `process.env.NEXT_PUBLIC_*` impedisce che la lettura
 * puntata torni; qui si verifica il link che esce davvero.
 */
vi.mock('@/lib/email/outbox', () => ({ enqueueEmail: vi.fn() }));
vi.mock('@/lib/gdpr/request-token', () => ({
  issueGdprToken: (action: string) => `tok-${action}`,
}));

import { enqueueEmail } from '@/lib/email/outbox';

import { POST as erasureRequest } from './erasure/request/route';
import { POST as exportRequest } from './export/request/route';

const mockedEnqueue = enqueueEmail as unknown as ReturnType<typeof vi.fn>;
const previousUrl = process.env.NEXT_PUBLIC_APP_URL;

let ipCounter = 0;
function post(path: string, body: Record<string, unknown>): Request {
  ipCounter += 1;
  return new Request(`https://portale.example.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // IP diverso per ogni richiesta: il limite per IP non deve interferire.
      'x-forwarded-for': `198.51.100.${ipCounter}`,
    },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({}) };

function sentLink(): string {
  const mail = mockedEnqueue.mock.calls[0]?.[0] as { text: string } | undefined;
  expect(mail, 'nessuna email accodata').toBeDefined();
  const match = /https?:\/\/\S+/.exec(mail!.text);
  expect(match, 'nessun link nel testo').not.toBeNull();
  return match![0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://portale.example.test/';
});

afterEach(() => {
  if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = previousUrl;
});

describe('GDPR request emails link to the running instance', () => {
  it('export: runtime URL, localized path, no localhost', async () => {
    const res = await exportRequest(
      post('/api/gdpr/export/request', { email: 'a1@example.test', locale: 'it' }) as never,
      ctx as never,
    );
    expect(res.status).toBe(200);
    const link = sentLink();
    expect(link).toBe('https://portale.example.test/it/privacy/i-miei-dati?t=tok-export');
    expect(link).not.toContain('localhost');
  });

  it('erasure: runtime URL, localized path, no localhost', async () => {
    const res = await erasureRequest(
      post('/api/gdpr/erasure/request', { email: 'a2@example.test', locale: 'en' }) as never,
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(sentLink()).toBe('https://portale.example.test/en/privacy/my-data/erasure?t=tok-erasure');
  });

  it('follows a change of the runtime value without a rebuild', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://altro-ente.example.test';
    await exportRequest(
      post('/api/gdpr/export/request', { email: 'a3@example.test', locale: 'en' }) as never,
      ctx as never,
    );
    expect(sentLink()).toBe('https://altro-ente.example.test/en/privacy/my-data?t=tok-export');
  });
});

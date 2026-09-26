import { describe, it, expect } from 'vitest';

function normalizeRoute(pathname: string): string {
  return pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

describe('normalizeRoute', () => {
  it('replaces UUIDs with :id', () => {
    expect(normalizeRoute('/api/events/550e8400-e29b-41d4-a716-446655440000'))
      .toBe('/api/events/:id');
  });

  it('replaces numeric IDs with :id', () => {
    expect(normalizeRoute('/api/events/123/registrations'))
      .toBe('/api/events/:id/registrations');
  });

  it('leaves non-ID paths unchanged', () => {
    expect(normalizeRoute('/api/status/infrastructure'))
      .toBe('/api/status/infrastructure');
  });

  it('handles multiple UUIDs', () => {
    expect(normalizeRoute('/api/events/550e8400-e29b-41d4-a716-446655440000/qa/660e8400-e29b-41d4-a716-446655440001'))
      .toBe('/api/events/:id/qa/:id');
  });
});

/**
 * Il corpo di una rotta JSON ha un tetto suo. L'ingress lascia passare corpi
 * più grandi perché i file caricati attraverso il portale ne hanno bisogno:
 * senza questo tetto, qualunque rotta JSON pubblica leggerebbe e
 * interpreterebbe in memoria un corpo grande quanto quel limite.
 */
describe('parseJsonBody', () => {
  async function codice(p: Promise<unknown>): Promise<unknown> {
    try {
      await p;
      return null;
    } catch (err) {
      return (err as { statusCode?: number }).statusCode;
    }
  }

  it('legge un corpo JSON normale', async () => {
    const { parseJsonBody } = await import('./api-handler');
    const req = new Request('https://x.example/api', {
      method: 'POST',
      body: JSON.stringify({ testo: 'ciao', città: 'Roma' }),
    });
    await expect(parseJsonBody(req)).resolves.toEqual({ testo: 'ciao', città: 'Roma' });
  });

  it('un corpo che non è JSON: 400', async () => {
    const { parseJsonBody } = await import('./api-handler');
    const req = new Request('https://x.example/api', { method: 'POST', body: 'non json' });
    expect(await codice(parseJsonBody(req))).toBe(400);
    const vuoto = new Request('https://x.example/api', { method: 'POST' });
    expect(await codice(parseJsonBody(vuoto))).toBe(400);
  });

  it('oltre il tetto dichiarato: 413 senza leggere il corpo', async () => {
    const { parseJsonBody, JSON_BODY_MAX_BYTES } = await import('./api-handler');
    let letto = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          letto = true;
        },
      },
      // Nessuna lettura anticipata: `pull` parte solo se qualcuno legge.
      { highWaterMark: 0 },
    );
    const req = new Request('https://x.example/api', {
      method: 'POST',
      body,
      headers: { 'content-length': String(JSON_BODY_MAX_BYTES + 1) },
      // @ts-expect-error -- richiesto da undici per i corpi in streaming
      duplex: 'half',
    });
    expect(await codice(parseJsonBody(req))).toBe(413);
    expect(letto).toBe(false);
  });

  it('senza Content-Length conta i byte mentre arrivano', async () => {
    const { parseJsonBody } = await import('./api-handler');
    const pezzo = new TextEncoder().encode('x'.repeat(64));
    let inviati = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        inviati++;
        controller.enqueue(pezzo);
        if (inviati > 1000) controller.close();
      },
    });
    const req = new Request('https://x.example/api', {
      method: 'POST',
      body,
      // @ts-expect-error -- richiesto da undici per i corpi in streaming
      duplex: 'half',
    });
    expect(await codice(parseJsonBody(req, 256))).toBe(413);
    // Si ferma appena passa il tetto, non alla fine del corpo.
    expect(inviati).toBeLessThan(10);
  });
});

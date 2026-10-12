import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  evento: vi.fn(),
  posto: vi.fn(),
  consenso: vi.fn(),
  createMany: vi.fn(),
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
vi.mock('@/lib/captions/room', () => ({
  eventoDellaConferenza: m.evento,
  postoDellEndpoint: m.posto,
  consensoTrascrizione: m.consenso,
}));
vi.mock('@/lib/crypto/pii', () => ({ encryptPII: (v: string) => `cif:${v}` }));
vi.mock('@/lib/db', () => ({ prisma: { captionSegment: { createMany: m.createMany } } }));

import { POST } from './route';

const frase = (endpointId: string, text: string, messageId = `${endpointId}-1`) => ({
  messageId,
  endpointId,
  text,
  language: 'it',
  startedAt: '2026-10-20T10:00:00.000Z',
  endedAt: '2026-10-20T10:00:03.000Z',
});
const invia = (body: unknown) =>
  POST(
    new Request('http://localhost/api/internal/captions/segments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({}) } as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.evento.mockResolvedValue({ id: 'e1', liveCaptionsEnabled: true, captionsTranscriptEnabled: true });
  m.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
});

describe('POST /api/internal/captions/segments', () => {
  it('di chi ha acconsentito tiene nome e testo cifrati; degli altri solo il momento', async () => {
    m.posto.mockImplementation(async (_e: string, endpoint: string) => (endpoint === 'aa' ? 'mod-e1-x' : 'guest-1'));
    m.consenso.mockImplementation(async (_e: string, seat: string) =>
      seat === 'mod-e1-x' ? { dato: true, nome: 'Moderatrice' } : { dato: false, nome: null },
    );
    const res = await invia({ room: 'stanza', segments: [frase('aa', 'Buongiorno.'), frase('bb', 'Una domanda.')] });
    expect(res.status).toBe(200);
    const righe = m.createMany.mock.calls[0]![0].data as Array<Record<string, unknown>>;
    expect(righe[0]).toMatchObject({ seatId: 'mod-e1-x', speakerName: 'cif:Moderatrice', text: 'cif:Buongiorno.' });
    expect(righe[1]).toMatchObject({ endpointId: 'bb', seatId: null, speakerName: null, text: null });
    expect(m.createMany.mock.calls[0]![0].skipDuplicates).toBe(true);
  });

  it('una voce che Prosody non ha riconosciuto non si tiene', async () => {
    m.posto.mockResolvedValue(null);
    await invia({ room: 'stanza', segments: [frase('cc', 'Chi sono?')] });
    expect(m.consenso).not.toHaveBeenCalled();
    expect((m.createMany.mock.calls[0]![0].data as Array<Record<string, unknown>>)[0]).toMatchObject({ text: null });
  });

  it('un evento senza trascrizione, o che non c\'e\', non salva niente', async () => {
    m.evento.mockResolvedValueOnce({ id: 'e1', liveCaptionsEnabled: true, captionsTranscriptEnabled: false });
    expect(await (await invia({ room: 'stanza', segments: [frase('aa', 'x')] })).json()).toEqual({ stored: 0 });
    m.evento.mockResolvedValueOnce(null);
    expect(await (await invia({ room: 'altra', segments: [frase('aa', 'x')] })).json()).toEqual({ stored: 0 });
    expect(m.createMany).not.toHaveBeenCalled();
  });

  it('un corpo non valido e\' rifiutato', async () => {
    expect((await invia({ room: 'stanza', segments: [] })).status).toBe(422);
  });
});

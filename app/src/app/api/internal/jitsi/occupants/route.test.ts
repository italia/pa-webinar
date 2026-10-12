import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  evento: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  chiave: vi.fn(),
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: m.chiave }));
vi.mock('@/lib/captions/room', () => ({ eventoDellaStanza: m.evento }));
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn(async () => ({ liveCaptionsEnabled: true })) }));
vi.mock('@/lib/db', () => ({ prisma: { roomOccupant: { upsert: m.upsert, updateMany: m.updateMany } } }));

import { UnauthorizedError } from '@/lib/errors';
import { firmaProsody } from '@/lib/auth/prosody-signature';

import { POST } from './route';

const SEGRETO = 'segreto-della-conferenza';

const inviaFirmato = (body: Record<string, unknown>, firma?: string) => {
  const corpo = JSON.stringify(body);
  return POST(
    new Request('http://localhost/api/internal/jitsi/occupants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pa-signature': firma ?? firmaProsody(corpo, SEGRETO),
      },
      body: corpo,
    }) as unknown as NextRequest,
    { params: Promise.resolve({}) } as never,
  );
};

const invia = (body: unknown) =>
  POST(
    new Request('http://localhost/api/internal/jitsi/occupants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({}) } as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('JITSI_JWT_SECRET', SEGRETO);
  vi.stubEnv('CAPTIONS_STATUS_URL', 'http://captions/status');
  m.evento.mockResolvedValue({
    id: 'e1',
    liveCaptionsEnabled: true,
    captionsTranscriptEnabled: true,
    multitrackRecordingEnabled: false,
  });
});

describe('POST /api/internal/jitsi/occupants', () => {
  it('chi entra: l\'endpoint si lega al posto', async () => {
    const res = await invia({ room: 'stanza', endpointId: 'ab', seatId: 'mod-e1-x', action: 'joined' });
    expect(res.status).toBe(204);
    expect(m.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId_endpointId: { eventId: 'e1', endpointId: 'ab' } },
        create: expect.objectContaining({ eventId: 'e1', endpointId: 'ab', seatId: 'mod-e1-x' }),
      }),
    );
  });

  it('chi esce: si segna l\'uscita', async () => {
    await invia({ room: 'stanza', endpointId: 'ab', seatId: 'mod-e1-x', action: 'left' });
    expect(m.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: 'e1', endpointId: 'ab', leftAt: null } }),
    );
  });

  it('una stanza che non e\' di un evento si ignora', async () => {
    m.evento.mockResolvedValue(null);
    expect((await invia({ room: 'prova', endpointId: 'ab', seatId: 'x', action: 'joined' })).status).toBe(204);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it('accetta la notifica firmata da Prosody, senza la chiave delle rotte interne', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const res = await inviaFirmato({ room: 'stanza', endpointId: 'ab', seatId: 's', action: 'joined', ts });
    expect(res.status).toBe(204);
    expect(m.chiave).not.toHaveBeenCalled();
    expect(m.upsert).toHaveBeenCalled();
  });

  it('rifiuta una firma sbagliata, o fatta con un altro segreto', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = { room: 'stanza', endpointId: 'ab', seatId: 's', action: 'joined', ts };
    expect((await inviaFirmato(body, 'deadbeef')).status).toBe(401);
    expect((await inviaFirmato(body, firmaProsody(JSON.stringify(body), 'altro'))).status).toBe(401);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it('rifiuta una notifica firmata ma vecchia, o senza ora', async () => {
    const vecchia = Math.floor(Date.now() / 1000) - 3600;
    expect(
      (await inviaFirmato({ room: 'stanza', endpointId: 'ab', seatId: 's', action: 'joined', ts: vecchia })).status,
    ).toBe(401);
    expect((await inviaFirmato({ room: 'stanza', endpointId: 'ab', seatId: 's', action: 'joined' })).status).toBe(401);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it('senza firma vale la chiave delle rotte interne', async () => {
    m.chiave.mockImplementationOnce(() => {
      throw new UnauthorizedError();
    });
    expect((await invia({ room: 'stanza', endpointId: 'ab', seatId: 's', action: 'joined' })).status).toBe(401);
  });

  it('con i soli sottotitoli tiene il posto: la trascrizione si puo\' accendere a evento iniziato', async () => {
    m.evento.mockResolvedValue({
      id: 'e1',
      liveCaptionsEnabled: true,
      captionsTranscriptEnabled: false,
      multitrackRecordingEnabled: false,
    });
    await invia({ room: 'stanza', meetingId: 'riunione', endpointId: 'ab', seatId: 'reg-x', action: 'joined' });
    expect(m.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ seatId: 'reg-x', meetingId: 'riunione' }) }),
    );
  });

  it('dove il servizio dei sottotitoli non c\'e\' e senza multitraccia non tiene niente', async () => {
    vi.stubEnv('CAPTIONS_STATUS_URL', '');
    m.evento.mockResolvedValue({
      id: 'e1',
      liveCaptionsEnabled: false,
      captionsTranscriptEnabled: false,
      multitrackRecordingEnabled: false,
    });
    const res = await invia({ room: 'stanza', meetingId: 'riunione', endpointId: 'ab', seatId: 'reg-x', action: 'joined' });
    expect(res.status).toBe(204);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it('con il servizio dei sottotitoli tiene il posto anche se l\'evento li ha spenti: si accendono in diretta', async () => {
    m.evento.mockResolvedValue({
      id: 'e1',
      liveCaptionsEnabled: false,
      captionsTranscriptEnabled: false,
      multitrackRecordingEnabled: false,
    });
    await invia({ room: 'stanza', endpointId: 'ab', seatId: 'reg-x', action: 'joined' });
    expect(m.upsert).toHaveBeenCalled();
  });

  it('con la registrazione multitraccia tiene il posto', async () => {
    m.evento.mockResolvedValue({
      id: 'e1',
      liveCaptionsEnabled: false,
      captionsTranscriptEnabled: false,
      multitrackRecordingEnabled: true,
    });
    await invia({ room: 'stanza', endpointId: 'ab', seatId: 'reg-x', action: 'joined' });
    expect(m.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ seatId: 'reg-x' }) }),
    );
  });

  it('senza il servizio dei sottotitoli il flag acceso di default non basta', async () => {
    vi.stubEnv('CAPTIONS_STATUS_URL', '');
    m.evento.mockResolvedValue({
      id: 'e1',
      liveCaptionsEnabled: true,
      captionsTranscriptEnabled: true,
      multitrackRecordingEnabled: false,
    });
    expect((await invia({ room: 'stanza', endpointId: 'ab', seatId: 'reg-x', action: 'joined' })).status).toBe(204);
    expect(m.upsert).not.toHaveBeenCalled();
  });
});

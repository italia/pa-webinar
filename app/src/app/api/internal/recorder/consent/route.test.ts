// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ posto: vi.fn(),
  esclusa: vi.fn(async () => false), consenso: vi.fn() }));
const db = vi.hoisted(() => ({
  evento: vi.fn(),
  impostazioni: vi.fn(async () => ({ aiPipelineEnabled: false, liveCaptionsEnabled: true })),
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { event: { findUnique: db.evento } } }));
vi.mock('@/lib/settings', () => ({ getSettings: db.impostazioni }));
vi.mock('@/lib/captions/room', () => ({
  postoDellEndpoint: m.posto,
  consensoTrascrizione: m.consenso,
  voceEsclusa: m.esclusa,
}));

import { GET } from './route';

const EVENTO = '11111111-2222-4333-8444-555555555555';
const chiedi = (q: string) =>
  GET(new Request(`http://localhost/api/internal/recorder/consent${q}`) as unknown as NextRequest, {
    params: Promise.resolve({}),
  } as never);

const SOLO_TRACCE = {
  eventType: 'SCHEDULED',
  recordingEnabled: false,
  multitrackRecordingEnabled: true,
  captionsTranscriptEnabled: false,
  liveCaptionsEnabled: false,
  aiTranscriptEnabled: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.evento.mockResolvedValue(SOLO_TRACCE);
  db.impostazioni.mockResolvedValue({ aiPipelineEnabled: false, liveCaptionsEnabled: true });
});

describe('GET /api/internal/recorder/consent', () => {
  it('si registra solo chi ha dato il consenso', async () => {
    m.posto.mockResolvedValue('mod-x');
    m.consenso.mockResolvedValueOnce({ dato: true, nome: 'M' });
    expect(await (await chiedi(`?eventId=${EVENTO}&endpoint=ab`)).json()).toEqual({ record: true });
    // Senza trascrizione vale il consenso alla traccia audio, con ogni versione.
    expect(m.consenso).toHaveBeenLastCalledWith(EVENTO, 'mod-x', 1);
    m.consenso.mockResolvedValueOnce({ dato: false, nome: null });
    expect(await (await chiedi(`?eventId=${EVENTO}&endpoint=ab`)).json()).toEqual({ record: false });
  });

  it("dove l'evento trascrive le tracce vale solo il testo che lo comprende", async () => {
    db.evento.mockResolvedValue({ ...SOLO_TRACCE, aiTranscriptEnabled: true });
    db.impostazioni.mockResolvedValue({ aiPipelineEnabled: true, liveCaptionsEnabled: true });
    m.posto.mockResolvedValue('reg-x');
    m.consenso.mockResolvedValueOnce({ dato: false, nome: null });
    expect(await (await chiedi(`?eventId=${EVENTO}&endpoint=ab`)).json()).toEqual({ record: false });
    expect(m.consenso).toHaveBeenLastCalledWith(EVENTO, 'reg-x', 2);
  });

  it("un evento che non c'e' piu' non si registra", async () => {
    m.posto.mockResolvedValue('mod-x');
    db.evento.mockResolvedValue(null);
    expect(await (await chiedi(`?eventId=${EVENTO}&endpoint=ab`)).json()).toEqual({
      record: false,
      reason: 'unknown',
    });
  });

  it('senza consenso alla registrazione non si registra, qualunque altro abbia dato', async () => {
    m.posto.mockResolvedValue('mod-x');
    m.esclusa.mockResolvedValueOnce(true);
    expect(await (await chiedi(`?eventId=${EVENTO}&endpoint=ab`)).json()).toEqual({ record: false });
    expect(m.consenso).not.toHaveBeenCalled();
  });

  it('chi non e\' riconosciuto non si registra', async () => {
    m.posto.mockResolvedValue(null);
    expect(await (await chiedi(`?eventId=${EVENTO}&endpoint=zz`)).json()).toEqual({
      record: false,
      reason: 'unknown',
    });
    expect(m.consenso).not.toHaveBeenCalled();
  });

  it('senza evento o endpoint validi: 400', async () => {
    expect((await chiedi('?endpoint=ab')).status).toBe(400);
  });
});

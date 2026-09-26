// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { warmupFromLifecycle } from './lifecycle-warmup';

const SERVER_TIME = '2026-09-26T09:00:00.000Z';

function risposta(
  jvb: Record<string, unknown> | undefined,
  serverTime: unknown = SERVER_TIME
) {
  return { status: 'PROVISIONING', serverTime, ...(jvb && { jvb }) };
}

describe('warmupFromLifecycle', () => {
  it('porta alla sala d’attesa ogni fase che /lifecycle può restituire', () => {
    // 'scheduled' compresa: senza scaler la sala si apre all'orario d'inizio,
    // e la sala d'attesa lo dice con un orologio invece della stima di
    // accensione.
    for (const phase of ['queued', 'starting', 'ready', 'scheduled'] as const) {
      expect(warmupFromLifecycle(risposta({ phase, startedAt: null }))).toEqual({
        phase,
        startedAt: null,
        serverTime: SERVER_TIME,
      });
    }
  });

  it('conserva l’ancora del cronometro quando c’è', () => {
    const startedAt = '2026-09-26T08:58:00.000Z';
    expect(warmupFromLifecycle(risposta({ phase: 'starting', startedAt }))).toEqual({
      phase: 'starting',
      startedAt,
      serverTime: SERVER_TIME,
    });
  });

  it('fuori dal warm-up la risposta non ha telemetria: null', () => {
    expect(warmupFromLifecycle(risposta(undefined))).toBeNull();
    expect(
      warmupFromLifecycle({ status: 'LIVE', serverTime: SERVER_TIME, jvb: null })
    ).toBeNull();
  });

  it('una fase che la sala non sa raccontare diventa null, non un’etichetta sbagliata', () => {
    expect(
      warmupFromLifecycle(risposta({ phase: 'warming', startedAt: null }))
    ).toBeNull();
    expect(warmupFromLifecycle(risposta({ startedAt: null }))).toBeNull();
  });

  it('un’ancora che non è una stringa non fa partire il cronometro', () => {
    expect(
      warmupFromLifecycle(risposta({ phase: 'starting', startedAt: 12 }))?.startedAt
    ).toBeNull();
  });

  it('senza l’ora del server non c’è riferimento per il cronometro: null', () => {
    expect(
      warmupFromLifecycle({ status: 'IDLE', jvb: { phase: 'queued', startedAt: null } })
    ).toBeNull();
    expect(warmupFromLifecycle(risposta({ phase: 'queued' }, 1_700_000_000))).toBeNull();
  });

  it('una risposta che non è un oggetto: null', () => {
    expect(warmupFromLifecycle(null)).toBeNull();
    expect(warmupFromLifecycle('ok')).toBeNull();
  });
});

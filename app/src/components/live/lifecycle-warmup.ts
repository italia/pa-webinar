import type { WaitingRoomWarmup } from '@/components/live/waiting-room';

/**
 * Le fasi di warm-up che GET /api/events/[slug]/lifecycle può restituire in
 * `jvb.phase`. Tipizzato sull'interfaccia della sala d'attesa: una fase nuova
 * lato server che la sala non sa raccontare fallisce il typecheck qui, invece
 * di arrivare a schermo con un'etichetta sbagliata.
 */
const WARMUP_PHASES: readonly WaitingRoomWarmup['phase'][] = [
  'queued',
  'starting',
  'ready',
  'scheduled',
];

function isWarmupPhase(value: unknown): value is WaitingRoomWarmup['phase'] {
  return (WARMUP_PHASES as readonly unknown[]).includes(value);
}

/**
 * La telemetria di warm-up dalla risposta di /lifecycle, o null.
 *
 * Null quando la risposta non la porta (l'evento non è in PROVISIONING/IDLE) e
 * quando la fase non è una di quelle note: in quel caso la sala d'attesa
 * mostra l'attesa generica, che è vera per ogni fase, invece di una stima che
 * potrebbe non esserlo.
 */
export function warmupFromLifecycle(body: unknown): WaitingRoomWarmup | null {
  if (typeof body !== 'object' || body === null) return null;
  const { jvb, serverTime } = body as { jvb?: unknown; serverTime?: unknown };
  if (typeof jvb !== 'object' || jvb === null) return null;
  const { phase, startedAt } = jvb as { phase?: unknown; startedAt?: unknown };
  if (!isWarmupPhase(phase) || typeof serverTime !== 'string') return null;
  return {
    phase,
    startedAt: typeof startedAt === 'string' ? startedAt : null,
    serverTime,
  };
}

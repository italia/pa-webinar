/**
 * Lo stato dei sottotitoli live (ADR-018) per la pagina di stato, la mappa
 * dell'infrastruttura e la sala.
 *
 * Il servizio espone `/status` (CAPTIONS_STATUS_URL, reso dal chart solo
 * quando lo installa): il proprio stato di carico, `ok`, `degraded`,
 * `paused` (sospeso da sé per sovraccarico) o `unavailable` (il motore non
 * risponde). Lo scaler lo spegne quando nessun evento in diretta ha i
 * sottotitoli: una sonda che fallisce in quel momento è attesa, e lo stato è
 * «in attesa», non un guasto.
 */

import { captionsInstalled } from '@/lib/captions/availability';
import { prisma } from '@/lib/db';
import { JVB_BILLABLE_STATUSES } from '@/lib/jvb-sizing';
import { cachedProbe } from '@/lib/status/probes';

export type CaptionsState =
  | 'not_installed'
  | 'disabled'
  | 'standby'
  | 'starting'
  | 'operational'
  | 'degraded'
  | 'paused'
  | 'unavailable';

export interface CaptionsGatewayStatus {
  state: 'ok' | 'degraded' | 'paused' | 'unavailable';
  engine: 'up' | 'down';
  activeStreams: number;
  maxStreams: number;
  streamLimit: number;
  lagP95Ms: number | null;
  pausedUntil: number | null;
  conferences: number;
}

export interface CaptionsStatus {
  state: CaptionsState;
  /** Voci trascritte adesso, e quante al massimo. */
  activeStreams?: number;
  maxStreams?: number;
  /** Ritardo di calcolo (p95) dei sottotitoli, in ms. */
  lagP95Ms?: number | null;
  /** Fine della sospensione per sovraccarico (ISO). */
  pausedUntil?: string | null;
}

const GATEWAY_STATES = new Set(['ok', 'degraded', 'paused', 'unavailable']);

function parseGateway(body: unknown): CaptionsGatewayStatus | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.state !== 'string' || !GATEWAY_STATES.has(b.state)) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    state: b.state as CaptionsGatewayStatus['state'],
    engine: b.engine === 'down' ? 'down' : 'up',
    activeStreams: n(b.activeStreams),
    maxStreams: n(b.maxStreams),
    streamLimit: n(b.streamLimit),
    lagP95Ms: typeof b.lagP95Ms === 'number' ? b.lagP95Ms : null,
    pausedUntil: typeof b.pausedUntil === 'number' ? b.pausedUntil : null,
    conferences: n(b.conferences),
  };
}

/** `/status` del servizio, o null se non risponde. */
export function fetchCaptionsGateway(env: NodeJS.ProcessEnv = process.env): Promise<CaptionsGatewayStatus | null> {
  const url = env.CAPTIONS_STATUS_URL?.trim();
  if (!url) return Promise.resolve(null);
  return cachedProbe(`captions|${url}`, async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000), cache: 'no-store' });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      return parseGateway(await res.json());
    } catch {
      return null;
    }
  });
}

/** Lo stato, dai fatti: pura, per poterla provare. */
export function captionsStateFrom(input: {
  installed: boolean;
  siteEnabled: boolean;
  /** C'è un evento in diretta (o in avvio) con i sottotitoli accesi. */
  expected: boolean;
  gateway: CaptionsGatewayStatus | null;
}): CaptionsState {
  if (!input.installed) return 'not_installed';
  if (!input.siteEnabled) return 'disabled';
  if (!input.gateway) return input.expected ? 'starting' : 'standby';
  switch (input.gateway.state) {
    case 'ok':
      return 'operational';
    case 'degraded':
      return 'degraded';
    case 'paused':
      return 'paused';
    default:
      return 'unavailable';
  }
}

/**
 * Il servizio dovrebbe essere acceso: c'è un evento in diretta o in avvio.
 * Lo scaler lo tiene acceso per ogni evento in diretta, anche con i
 * sottotitoli spenti in sala (/api/internal/jvb-desired-replicas).
 */
export async function captionsExpected(): Promise<boolean> {
  const n = await prisma.event.count({ where: { status: { in: [...JVB_BILLABLE_STATUSES] } } });
  return n > 0;
}

/** Lo stato del componente nella pagina di stato: un guasto dei sottotitoli degrada, non interrompe. */
export const CAPTIONS_COMPONENT_STATUS: Record<
  Exclude<CaptionsState, 'not_installed'>,
  'operational' | 'degraded' | 'standby'
> = {
  operational: 'operational',
  degraded: 'degraded',
  paused: 'degraded',
  unavailable: 'degraded',
  starting: 'standby',
  standby: 'standby',
  disabled: 'standby',
};

/** Lo stato del nodo nella mappa dell'infrastruttura. */
export const CAPTIONS_NODE_STATUS: Record<
  Exclude<CaptionsState, 'not_installed'>,
  'healthy' | 'degraded' | 'down' | 'standby' | 'scaling'
> = {
  operational: 'healthy',
  degraded: 'degraded',
  paused: 'degraded',
  unavailable: 'down',
  starting: 'scaling',
  standby: 'standby',
  disabled: 'standby',
};

export async function getCaptionsStatus(settings: { liveCaptionsEnabled?: boolean | null }): Promise<CaptionsStatus> {
  const installed = captionsInstalled();
  const siteEnabled = settings.liveCaptionsEnabled !== false;
  if (!installed || !siteEnabled) {
    return { state: captionsStateFrom({ installed, siteEnabled, expected: false, gateway: null }) };
  }
  const [gateway, expected] = await Promise.all([fetchCaptionsGateway(), captionsExpected()]);
  const state = captionsStateFrom({ installed, siteEnabled, expected, gateway });
  if (!gateway) return { state };
  return {
    state,
    activeStreams: gateway.activeStreams,
    maxStreams: gateway.maxStreams,
    lagP95Ms: gateway.lagP95Ms,
    pausedUntil: gateway.pausedUntil ? new Date(gateway.pausedUntil).toISOString() : null,
  };
}

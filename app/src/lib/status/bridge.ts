/**
 * Il ponte video e il registratore visti dalle pagine di stato.
 *
 * Come si legge il ponte dipende da chi lo accende.
 *
 * - `scaler`: uno scaler accende e spegne i bridge in base agli eventi
 *   (scale-to-zero). Nessun evento, nessun bridge: «standby» è normale, e un
 *   evento che aspetta il bridge è «in preparazione».
 * - `fixed`: nessuno scaler, bridge sempre accesi, e un indirizzo
 *   (`JVB_HEALTH_URL`) per interrogarli. Il bridge risponde o no, a
 *   prescindere dagli eventi: «operativo» o «interruzione», mai «standby»
 *   né «in preparazione».
 * - `unmonitored`: nessuno scaler e nessun indirizzo (un Jitsi esterno).
 *   Lo stato non si sa: «non monitorato», mai un'interruzione, e
 *   mai «in preparazione» — la sala d'attesa ferma l'ingresso su quel valore.
 *
 * Il numero dei bridge previsti in modalità fissa è `JVB_MAX_REPLICAS`, che il
 * chart scrive dal numero di repliche del bridge quando non rende lo scaler.
 */

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { jvbScalerEnabled } from '@/lib/infrastructure';
import { JVB_BILLABLE_STATUSES, jvbMaxReplicasFromEnv, jvbsForEvent } from '@/lib/jvb-sizing';

import { baseUrl, cachedProbe } from './probes';

type Env = Record<string, string | undefined>;

export type BridgeMode = 'scaler' | 'fixed' | 'unmonitored';

export function bridgeMode(env: Env = process.env): BridgeMode {
  if (jvbScalerEnabled(env)) return 'scaler';
  return env.JVB_HEALTH_URL ? 'fixed' : 'unmonitored';
}

/**
 * `/colibri/stats` del bridge dietro `JVB_HEALTH_URL`, o null se non risponde
 * (o se l'indirizzo manca). Con più bridge dietro lo stesso Service risponde
 * uno solo: i numeri sono un limite inferiore.
 */
export function fetchColibriStats(env: Env = process.env): Promise<Record<string, unknown> | null> {
  const url = env.JVB_HEALTH_URL;
  if (!url) return Promise.resolve(null);
  return cachedProbe(`colibri|${url}`, async () => {
    try {
      const res = await fetch(`${baseUrl(url)}/colibri/stats`, {
        signal: AbortSignal.timeout(3_000),
        cache: 'no-store',
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      const body: unknown = await res.json();
      return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  });
}

export interface JibriHealth {
  healthy: boolean;
  busyStatus: string | null;
}

/** L'API di salute di Jibri dietro `JIBRI_HEALTH_URL`, o null se non risponde. */
export function fetchJibriHealth(env: Env = process.env): Promise<JibriHealth | null> {
  const url = env.JIBRI_HEALTH_URL;
  if (!url) return Promise.resolve(null);
  return cachedProbe(`jibri|${url}`, async () => {
    try {
      const res = await fetch(`${baseUrl(url)}/jibri/api/v1.0/health`, {
        signal: AbortSignal.timeout(3_000),
        cache: 'no-store',
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      const data = (await res.json()) as {
        status?: { busyStatus?: string; health?: { healthStatus?: string } };
      };
      return {
        healthy: data.status?.health?.healthStatus === 'HEALTHY',
        busyStatus: data.status?.busyStatus ?? null,
      };
    } catch {
      return null;
    }
  });
}

export interface JvbSizingSettings {
  jvbCpuCoresPerPod?: number | null;
  jvbReceiversPerCore?: number | null;
  jvbSendersPerCore?: number | null;
  defaultSenderRatioPct?: number | null;
  jvbPreScaleMinutes?: number | null;
}

export interface JvbDemandEvent {
  id: string;
  status: string;
  startsAt: Date;
  provisioningStartedAt: Date | null;
  maxParticipants: number;
  expectedSenderRatioPct: number | null;
  participantsCanStartVideo: boolean;
  recordingEnabled: boolean;
}

export interface JvbDemand {
  /** Eventi che occupano o stanno per occupare il ponte. */
  events: JvbDemandEvent[];
  /** Bridge richiesti, entro il tetto. */
  desired: number;
  maxReplicas: number;
}

/**
 * Quanti bridge chiedono gli eventi, con la stessa regola dello scaler: LIVE e
 * PROVISIONING, più i PUBLISHED che iniziano entro la finestra di pre-scale.
 */
export async function loadJvbDemand(settings: JvbSizingSettings, now: Date): Promise<JvbDemand> {
  const maxReplicas = jvbMaxReplicasFromEnv();
  const preScaleMinutes = settings.jvbPreScaleMinutes ?? 10;
  const preScaleWindow = new Date(now.getTime() + preScaleMinutes * 60 * 1000);
  const where: Prisma.EventWhereInput = {
    OR: [
      { status: { in: [...JVB_BILLABLE_STATUSES] } },
      { status: 'PUBLISHED', startsAt: { lte: preScaleWindow }, endsAt: { gte: now } },
    ],
  };
  const events = (await prisma.event.findMany({
    where,
    select: {
      id: true,
      status: true,
      startsAt: true,
      provisioningStartedAt: true,
      maxParticipants: true,
      expectedSenderRatioPct: true,
      participantsCanStartVideo: true,
      recordingEnabled: true,
    },
  })) as JvbDemandEvent[];

  const sizing = {
    cpuCoresPerPod: settings.jvbCpuCoresPerPod ?? 16,
    receiversPerCore: settings.jvbReceiversPerCore ?? 18.75,
    sendersPerCore: settings.jvbSendersPerCore ?? 3.125,
    maxReplicas,
  };
  const defaultRatio = settings.defaultSenderRatioPct ?? 30;

  let desired = 0;
  for (const ev of events) {
    desired += jvbsForEvent(
      ev.maxParticipants,
      ev.expectedSenderRatioPct ?? defaultRatio,
      ev.participantsCanStartVideo,
      sizing,
    );
  }
  desired = Math.min(desired, maxReplicas);
  if (events.length > 0 && desired === 0) desired = 1;
  return { events, desired, maxReplicas };
}

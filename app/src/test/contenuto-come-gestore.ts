// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Per i test di una rotta che mockano le guardie dello staff
 * (`@/lib/auth/staff-session`): l'accesso al contenuto
 * (lib/recording/content-access) passa per la stessa guardia, come se chi la
 * supera organizzasse l'evento. Chi la rotta rifiuta lo dice la guardia
 * mockata; la regola dell'organizzatore ha i propri test
 * (lib/recording/content-access.test.ts, test/db).
 *
 *   vi.mock('@/lib/recording/content-access', () => import('@/test/contenuto-come-gestore'));
 */
import { vi } from 'vitest';

import * as staff from '@/lib/auth/staff-session';

const guardia = staff as unknown as Record<
  string,
  ((...a: unknown[]) => Promise<unknown>) | undefined
>;

async function passa(nome: string, ...args: unknown[]): Promise<unknown> {
  // Un mock che non definisce la guardia lancia gia' leggendola.
  let fn: ((...a: unknown[]) => Promise<unknown>) | undefined;
  try {
    fn = guardia[nome];
  } catch {
    fn = undefined;
  }
  return fn ? fn(...args) : { role: 'admin', accountId: 'account-di-prova' };
}

export const requireRecordingContent = vi.fn(
  async (cookies: unknown, recordingId: string) => ({
    session: await passa('requireRecordingManager', cookies, recordingId),
    eventId: 'evento-di-prova',
    via: 'organizzatore' as const,
  })
);

export const requireSpeakerContent = vi.fn(
  async (cookies: unknown, speakerId: string) => ({
    session: await passa('requireSpeakerManager', cookies, speakerId),
    eventId: 'evento-di-prova',
    recordingId: 'registrazione-di-prova',
    via: 'organizzatore' as const,
  })
);

export const requireEventContent = vi.fn(async (cookies: unknown, eventId: string) => ({
  session: await passa('requireEventManager', cookies, eventId),
  eventId,
  via: 'organizzatore' as const,
}));

export const accessoContenutoStaff = vi.fn(async () => 'organizzatore' as const);
export const organizzaEvento = vi.fn(async () => true);
export const eventiOrganizzati = vi.fn(
  async (_s: unknown, ids: readonly string[]) => new Set(ids)
);
export const contenutoStaffDellaRichiesta = vi.fn(
  async (cookies: unknown, eventId: string) => {
    // Chi gestisce l'evento secondo il mock (`isEventManager`) qui lo organizza.
    let gestisce: ((...a: unknown[]) => Promise<unknown>) | undefined;
    try {
      gestisce = guardia.isEventManager;
    } catch {
      gestisce = undefined;
    }
    if (!gestisce || !(await gestisce(cookies, eventId))) return null;
    return {
      session: { role: 'organizer', accountId: 'account-di-prova' },
      via: 'organizzatore' as const,
    };
  }
);
export const tracciaLetturaContenuto = vi.fn(async () => undefined);
export const contenutoNegato = vi.fn();
export const DEROGHE_CONTENUTO: readonly unknown[] = [];
export const AZIONE_LETTURA_CONTENUTO = 'RECORDING_CONTENT_READ';

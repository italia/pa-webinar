// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { prisma } from '@/lib/db';

/** Quanto vale una sessione di chiamata ancora aperta, al massimo. */
const SESSIONE_RECENTE_MS = 12 * 60 * 60 * 1000;

/**
 * La sala della conferenza puo' essere aperta: l'evento e' in diretta o si
 * prepara, oppure, pubblicato, qualcuno (chi modera o interviene, che entra
 * prima) ha una sessione di chiamata aperta di recente.
 *
 * Serve alle impostazioni che decidono il blocco dei mezzi della sala al
 * primo ingresso (mod_pa_media_lock): con la sala aperta non si cambiano.
 */
export async function salaForseAperta(event: {
  id: string;
  status: string;
}): Promise<boolean> {
  if (['LIVE', 'PROVISIONING', 'IDLE'].includes(event.status)) return true;
  if (event.status !== 'PUBLISHED') return false;
  const aperta = await prisma.callSession.findFirst({
    where: {
      eventId: event.id,
      endedAt: null,
      startedAt: { gte: new Date(Date.now() - SESSIONE_RECENTE_MS) },
    },
    select: { id: true },
  });
  return aperta !== null;
}

/**
 * La sala si e' aperta almeno una volta, anche se ora e' chiusa: da li' in poi
 * qualcuno puo' essere nel video con cio' che ha letto prima di entrare. A
 * differenza di `salaForseAperta` vale anche a evento concluso, e un evento
 * concluso senza una sessione registrata conta come aperto.
 *
 * Serve a cio' che dipende da chi e' gia' stato in sala (la destinazione della
 * registrazione, lib/recording/destination).
 */
export async function salaGiaAperta(event: {
  id: string;
  status: string;
}): Promise<boolean> {
  if (['ENDED', 'ARCHIVED'].includes(event.status)) return true;
  if (await salaForseAperta(event)) return true;
  const sessione = await prisma.callSession.findFirst({
    where: { eventId: event.id },
    select: { id: true },
  });
  return sessione !== null;
}

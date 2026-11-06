// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { prisma } from '@/lib/db';

/** Gli stati a cui un evento arriva solo con la sala aperta almeno una volta. */
const STATI_DOPO_L_APERTURA = ['PROVISIONING', 'LIVE', 'IDLE', 'ENDED', 'ARCHIVED'];

/**
 * La sala di questo evento si e' aperta almeno una volta, anche se ora e'
 * chiusa: e' il momento da cui la destinazione della registrazione si puo' solo
 * restringere (`puoCambiareDestinazione`, lib/recording/destination). Per un
 * evento pubblicato lo dice la prima sessione di chiamata; una copia nasce in
 * bozza e senza sessioni.
 */
export async function salaGiaAperta(event: {
  id: string;
  status: string;
}): Promise<boolean> {
  if (STATI_DOPO_L_APERTURA.includes(event.status)) return true;
  const sessione = await prisma.callSession.findFirst({
    where: { eventId: event.id },
    select: { id: true },
  });
  return sessione !== null;
}

/**
 * Cosa il wizard deve sapere della destinazione di un evento salvato.
 *
 * La destinazione si chiede a un evento mai aperto e senza iscrizioni, copie
 * comprese: nessuno ha ancora letto il testo di una casella, e un evento che
 * registra deve dire dove va il video prima di raccogliere consensi. Se la sala
 * si e' aperta, o qualcuno si e' gia' iscritto, un evento nato prima di questa
 * scelta resta senza e si salva lo stesso. Il wizard la chiede comunque se il
 * salvataggio accende la registrazione su un evento che non registrava.
 */
export async function domandaDestinazione(event: {
  id: string;
  status: string;
}): Promise<{ salaGiaAperta: boolean; daChiedere: boolean }> {
  if (await salaGiaAperta(event)) return { salaGiaAperta: true, daChiedere: false };
  const iscrizione = await prisma.registration.findFirst({
    where: { eventId: event.id },
    select: { id: true },
  });
  return { salaGiaAperta: false, daChiedere: iscrizione === null };
}

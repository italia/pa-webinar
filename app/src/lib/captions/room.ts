/**
 * Dalla stanza della conferenza all'evento, e dall'endpoint del bridge alla
 * persona: le due corrispondenze che servono per tenere la trascrizione (o
 * registrare l'audio) solo di chi ha dato il consenso.
 */
import { prisma } from '@/lib/db';
import { tryDecryptPII } from '@/lib/crypto/pii';

const CAMPI_EVENTO = {
  id: true,
  liveCaptionsEnabled: true,
  captionsTranscriptEnabled: true,
  multitrackRecordingEnabled: true,
} as const;

/**
 * L'evento di una stanza. Jitsi porta i nomi delle stanze in minuscolo: prima
 * il nome esatto (sull'indice unico), poi senza distinguere le maiuscole.
 */
export async function eventoDellaStanza(room: string) {
  return (
    (await prisma.event.findUnique({ where: { jitsiRoomName: room }, select: CAMPI_EVENTO })) ??
    (await prisma.event.findFirst({
      where: { jitsiRoomName: { equals: room, mode: 'insensitive' } },
      select: CAMPI_EVENTO,
    }))
  );
}

/**
 * L'evento di una conferenza: dalla stanza, quando il bridge la passa (Jitsi
 * stable-10978 e successivi, con i parametri dell'URL della trascrizione),
 * altrimenti dall'id della riunione, che Prosody ha legato all'evento quando
 * qualcuno e' entrato (mod_pa_occupants).
 */
export async function eventoDellaConferenza(c: { room?: string | null; meetingId?: string | null }) {
  if (c.room) {
    const evento = await eventoDellaStanza(c.room);
    if (evento) return evento;
  }
  if (!c.meetingId) return null;
  const occupante = await prisma.roomOccupant.findFirst({
    where: { meetingId: c.meetingId },
    orderBy: { joinedAt: 'desc' },
    select: { event: { select: CAMPI_EVENTO } },
  });
  return occupante?.event ?? null;
}

/** Il posto (`context.user.id` del JWT) di chi usa quell'endpoint, se Prosody l'ha detto. */
export async function postoDellEndpoint(eventId: string, endpointId: string): Promise<string | null> {
  const occupante = await prisma.roomOccupant.findUnique({
    where: { eventId_endpointId: { eventId, endpointId } },
    select: { seatId: true },
  });
  // Vuoto per gli eventi che non hanno bisogno di sapere chi e' chi (vedi la
  // rotta degli occupanti).
  return occupante?.seatId || null;
}

const POSTO_ISCRIZIONE = /^reg-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/i;

/** L'iscrizione di un posto, se il posto viene da un link di iscrizione. */
export function iscrizioneDelPosto(seatId: string): string | null {
  return POSTO_ISCRIZIONE.exec(seatId)?.[1] ?? null;
}

export interface ConsensoTrascrizione {
  dato: boolean;
  /** Il nome con cui la persona e' entrata, quando ha dato il consenso. */
  nome: string | null;
}

/**
 * Se la persona di quel posto ha dato il consenso alla trascrizione dei
 * propri interventi. Per un'iscrizione vale quello dato all'iscrizione o in
 * sala d'attesa (che si salva una volta per iscrizione, mentre il posto cambia
 * a ogni ingresso); per gli altri, la prova salvata per quel posto.
 *
 * `versioneMinima` e' la versione del testo che il consenso deve avere
 * (lib/registration/consents): la trascrizione dai sottotitoli, con il nome,
 * chiede quella che la comprende; la traccia audio vale con ogni versione.
 */
export async function consensoTrascrizione(
  eventId: string,
  seatId: string,
  versioneMinima: number,
): Promise<ConsensoTrascrizione> {
  const iscrizione = iscrizioneDelPosto(seatId);
  if (iscrizione) {
    const [registrazione, prova] = await Promise.all([
      prisma.registration.findFirst({
        where: { id: iscrizione, eventId },
        select: { displayName: true, consentMultitrack: true, consentMultitrackVersion: true },
      }),
      prisma.multitrackConsent.findFirst({
        where: { eventId, registrationId: iscrizione, textVersion: { gte: versioneMinima } },
        select: { displayName: true },
      }),
    ]);
    if (!registrazione) return { dato: false, nome: null };
    const allIscrizione =
      registrazione.consentMultitrack === true &&
      (registrazione.consentMultitrackVersion ?? 1) >= versioneMinima;
    if (!allIscrizione && !prova) return { dato: false, nome: null };
    return {
      dato: true,
      nome: (prova ? tryDecryptPII(prova.displayName) : null) ?? tryDecryptPII(registrazione.displayName) ?? null,
    };
  }
  const prova = await prisma.multitrackConsent.findFirst({
    where: { eventId, jitsiUserId: seatId, textVersion: { gte: versioneMinima } },
    select: { displayName: true },
  });
  return prova ? { dato: true, nome: tryDecryptPII(prova.displayName) ?? null } : { dato: false, nome: null };
}

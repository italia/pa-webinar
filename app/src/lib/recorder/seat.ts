/**
 * Il posto nella conferenza del registratore multitraccia: il prefisso
 * dell'identificativo nel suo token (route recorder-claim). Chi legge chi e'
 * in sala lo riconosce da qui, non da un nome scritto a mano.
 */
export const RECORDER_SEAT_PREFIX = 'rec-bot-';

export function recorderSeat(recordingId: string): string {
  return `${RECORDER_SEAT_PREFIX}${recordingId}`;
}

export function isRecorderSeat(seatId: string): boolean {
  return seatId.startsWith(RECORDER_SEAT_PREFIX);
}

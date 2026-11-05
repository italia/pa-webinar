import { prisma } from '@/lib/db';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { PREFISSO_POSTO_MODERATORE } from '@/lib/auth/jwt';
import { iscrizioneDelPosto } from '@/lib/captions/room';

/**
 * Le prove dei consensi di un evento, per chi lo gestisce (art. 7.1 GDPR:
 * chi tratta i dati deve poter dimostrare il consenso): quelle date
 * all'iscrizione e quelle date in sala d'attesa o in sala, con l'ora del
 * ritiro quando c'e' stato (lib/live/consent-withdrawal).
 *
 * Una riga per prova, e per i periodi precedenti di un consenso ridato dopo
 * un ritiro. Chi l'ha data si dice per nome (quello con cui e'
 * entrato, o quello dell'iscrizione) e per ruolo: iscritto, ospite (anche chi
 * apre un link d'iscrizione inoltrato), chi conduce o interviene.
 */

export type TipoConsenso = 'recording' | 'transcription';
export type OrigineConsenso = 'registration' | 'room';
export type RuoloConsenso = 'registrant' | 'guest' | 'host';

export interface ProvaConsenso {
  kind: TipoConsenso;
  source: OrigineConsenso;
  role: RuoloConsenso;
  /** Null se non si e' potuto decifrare, o se non si e' chiesto (`nomi: false`). */
  name: string | null;
  givenAt: string;
  withdrawnAt: string | null;
  /** La versione del testo, per la trascrizione (lib/registration/consents). */
  textVersion: number | null;
  /** Chi ha il consenso, per contare persone e non righe: l'iscrizione,
   *  l'account dello staff o la concessione, altrimenti il posto. Non si
   *  esporta. */
  holder: string;
}

const ruoloDelPosto = (posto: string, registrationId: string | null): RuoloConsenso =>
  registrationId || iscrizioneDelPosto(posto)
    ? 'registrant'
    : posto.startsWith(PREFISSO_POSTO_MODERATORE)
      ? 'host'
      : 'guest';

const titolareDelPosto = (posto: string, registrationId: string | null): string => {
  const iscrizione = registrationId ?? iscrizioneDelPosto(posto);
  return iscrizione ? `reg:${iscrizione}` : `posto:${posto}`;
};

interface Periodo {
  consentedAt: string;
  withdrawnAt: string | null;
}
const periodiPrecedenti = (v: unknown): Periodo[] =>
  Array.isArray(v)
    ? v.filter(
        (p): p is Periodo =>
          !!p && typeof p === 'object' && typeof (p as Periodo).consentedAt === 'string'
      )
    : [];

export async function proveConsensoEvento(
  eventId: string,
  { nomi = true }: { nomi?: boolean } = {}
): Promise<ProvaConsenso[]> {
  const [iscrizioni, registrazione, trascrizione] = await Promise.all([
    prisma.registration.findMany({
      where: { eventId, OR: [{ consentRecording: true }, { consentMultitrack: true }] },
      select: {
        id: true,
        displayName: nomi,
        consentTimestamp: true,
        consentRecording: true,
        consentRecordingWithdrawnAt: true,
        consentMultitrack: true,
        consentMultitrackVersion: true,
        consentMultitrackWithdrawnAt: true,
      },
    }),
    prisma.recordingConsent.findMany({
      where: { eventId },
      select: {
        displayName: nomi,
        jitsiUserId: true,
        registrationId: true,
        eventModeratorId: true,
        staffAccountId: true,
        consentedAt: true,
        withdrawnAt: true,
        earlierPeriods: true,
      },
    }),
    prisma.multitrackConsent.findMany({
      where: { eventId },
      select: {
        displayName: nomi,
        jitsiUserId: true,
        registrationId: true,
        consentedAt: true,
        withdrawnAt: true,
        textVersion: true,
      },
    }),
  ]);
  const nome = (cifrato: string | undefined) =>
    nomi && cifrato ? tryDecryptPII(cifrato) : null;
  const righe: ProvaConsenso[] = [];
  for (const r of iscrizioni) {
    const base = {
      source: 'registration' as const,
      role: 'registrant' as const,
      name: nome(r.displayName),
      givenAt: r.consentTimestamp.toISOString(),
      holder: `reg:${r.id}`,
    };
    if (r.consentRecording) {
      righe.push({
        ...base,
        kind: 'recording',
        withdrawnAt: r.consentRecordingWithdrawnAt?.toISOString() ?? null,
        textVersion: null,
      });
    }
    if (r.consentMultitrack) {
      righe.push({
        ...base,
        kind: 'transcription',
        withdrawnAt: r.consentMultitrackWithdrawnAt?.toISOString() ?? null,
        textVersion: r.consentMultitrackVersion ?? 1,
      });
    }
  }
  for (const p of registrazione) {
    const role =
      p.eventModeratorId || p.staffAccountId
        ? 'host'
        : ruoloDelPosto(p.jitsiUserId, p.registrationId);
    const holder = p.staffAccountId
      ? `staff:${p.staffAccountId}`
      : p.eventModeratorId
        ? `concessione:${p.eventModeratorId}`
        : titolareDelPosto(p.jitsiUserId, p.registrationId);
    const name = nome(p.displayName);
    // Un consenso ridato dopo un ritiro: i periodi di prima, poi quello attuale.
    for (const periodo of periodiPrecedenti(p.earlierPeriods)) {
      righe.push({
        kind: 'recording',
        source: 'room',
        role,
        name,
        givenAt: periodo.consentedAt,
        withdrawnAt: periodo.withdrawnAt,
        textVersion: null,
        holder,
      });
    }
    righe.push({
      kind: 'recording',
      source: 'room',
      role,
      name,
      givenAt: p.consentedAt.toISOString(),
      withdrawnAt: p.withdrawnAt?.toISOString() ?? null,
      textVersion: null,
      holder,
    });
  }
  for (const p of trascrizione) {
    righe.push({
      kind: 'transcription',
      source: 'room',
      role: ruoloDelPosto(p.jitsiUserId, p.registrationId),
      name: nome(p.displayName),
      givenAt: p.consentedAt.toISOString(),
      withdrawnAt: p.withdrawnAt?.toISOString() ?? null,
      textVersion: p.textVersion,
      holder: titolareDelPosto(p.jitsiUserId, p.registrationId),
    });
  }
  return righe.sort((a, b) => a.givenAt.localeCompare(b.givenAt));
}

/**
 * Quante persone (titolari: un'iscrizione, un account dello staff o una
 * concessione, altrimenti un posto) hanno un consenso valido per tipo, e
 * quante l'hanno ritirato senza ridarlo. Una persona che rientra non conta
 * due volte; un ospite che torna in un'altra visita ha un posto nuovo e conta
 * di nuovo (nessun dato lo lega alla visita di prima). Senza nomi.
 */
export function riepilogoProve(
  righe: readonly ProvaConsenso[]
): Record<TipoConsenso, { given: number; withdrawn: number }> {
  const stato = new Map<string, boolean>();
  for (const r of righe) {
    const chiave = `${r.kind}|${r.holder}`;
    stato.set(chiave, (stato.get(chiave) ?? false) || !r.withdrawnAt);
  }
  const conta = {
    recording: { given: 0, withdrawn: 0 },
    transcription: { given: 0, withdrawn: 0 },
  };
  for (const [chiave, valido] of stato) {
    const kind = chiave.split('|')[0] as TipoConsenso;
    conta[kind][valido ? 'given' : 'withdrawn'] += 1;
  }
  return conta;
}

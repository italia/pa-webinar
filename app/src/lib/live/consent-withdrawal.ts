import { prisma } from '@/lib/db';
import { iscrizioneDelPosto } from '@/lib/captions/room';

/**
 * Il ritiro dalla sala dei consensi dati per un evento (art. 7.3 GDPR: si
 * ritira con la stessa facilita' con cui si da').
 *
 * Chi ritira prova i propri posti con i token della sala che il portale gli
 * ha consegnato in questa visita (lib/auth/jwt postoDaTokenSala). Dai posti si
 * risale a tutto cio' che porta lo stesso consenso:
 *   - l'iscrizione, per chi e' entrato dal proprio link: il consenso dato
 *     all'iscrizione e le prove legate all'iscrizione, di ogni ingresso;
 *   - per chi conduce dal link primario con la sessione del proprio account,
 *     l'account dello staff a cui e' legata la prova della registrazione, con
 *     i posti degli ingressi precedenti;
 *   - per gli altri (ospiti, link inoltrati, concessioni nominali), le prove
 *     dei posti dati. Una concessione nominale e' un posto, non una persona:
 *     il link si puo' inoltrare, e il ritiro di chi lo apre non tocca i
 *     consensi di un altro che apre lo stesso link.
 *
 * Cosa cambia:
 *   - la registrazione dell'evento (`registrazione`): la prova resta, con
 *     l'ora del ritiro, e il consenso non vale piu'; con esso si ritira anche
 *     quello alla trascrizione, che senza registrazione non ha luogo;
 *   - la trascrizione dei propri interventi (sempre): le frasi dei sottotitoli
 *     gia' salvate perdono testo, nome e posto (ne restano i tempi, come per
 *     chi non ha acconsentito), e le tracce audio per persona non passano piu'
 *     alla trascrizione (lib/captions/room endpointRitirati).
 *
 * Ogni ritiro lascia una riga nel registro GDPR dell'evento
 * (`CONSENT_WITHDRAWN`, senza dati personali): quante prove, e quando.
 *
 * Il video completo dell'evento non si modifica: chi ritira il consenso alla
 * registrazione esce dalla registrazione da quel momento (solo ascolto, o
 * fuori dalla sala), e per il tratto gia' registrato vale la richiesta di
 * cancellazione a chi organizza (docs/GDPR.md).
 */

export interface EsitoRitiro {
  /** Il consenso alla registrazione e' stato ritirato (c'era qualcosa da ritirare). */
  registrazione: boolean;
  trascrizione: boolean;
}

export async function ritiraConsensi(
  eventId: string,
  posti: readonly string[],
  cosa: { registrazione: boolean },
  adesso: Date = new Date()
): Promise<EsitoRitiro> {
  if (posti.length === 0) return { registrazione: false, trascrizione: false };
  return prisma.$transaction(async (tx) => {
    // Le prove della registrazione dei posti dati: portano l'iscrizione, la
    // concessione nominale o l'account dello staff.
    const proveDeiPosti = await tx.recordingConsent.findMany({
      where: { eventId, jitsiUserId: { in: [...posti] } },
      select: { registrationId: true, staffAccountId: true },
    });
    const iscrizioni = new Set<string>();
    for (const p of posti) {
      const r = iscrizioneDelPosto(p);
      if (r) iscrizioni.add(r);
    }
    const tracceDeiPosti = await tx.multitrackConsent.findMany({
      where: { eventId, jitsiUserId: { in: [...posti] }, registrationId: { not: null } },
      select: { registrationId: true },
    });
    for (const p of [...proveDeiPosti, ...tracceDeiPosti]) {
      if (p.registrationId) iscrizioni.add(p.registrationId);
    }
    const account = [
      ...new Set(
        proveDeiPosti.map((p) => p.staffAccountId).filter((v): v is string => !!v)
      ),
    ];
    // I posti degli ingressi precedenti dello staff dietro il link primario:
    // le prove della registrazione li legano allo stesso account.
    const postiConduce =
      account.length > 0
        ? await tx.recordingConsent.findMany({
            where: { eventId, staffAccountId: { in: account } },
            select: { jitsiUserId: true },
          })
        : [];
    const tuttiIPosti = [
      ...new Set([...posti, ...postiConduce.map((p) => p.jitsiUserId)]),
    ];
    const listaIscrizioni = [...iscrizioni];

    let proveRegistrazione = 0;
    if (cosa.registrazione) {
      const prove = await tx.recordingConsent.updateMany({
        where: {
          eventId,
          withdrawnAt: null,
          OR: [
            { jitsiUserId: { in: tuttiIPosti } },
            ...(listaIscrizioni.length > 0
              ? [{ registrationId: { in: listaIscrizioni } }]
              : []),
            ...(account.length > 0 ? [{ staffAccountId: { in: account } }] : []),
          ],
        },
        data: { withdrawnAt: adesso },
      });
      const dateAllIscrizione =
        listaIscrizioni.length > 0
          ? await tx.registration.updateMany({
              where: {
                eventId,
                id: { in: listaIscrizioni },
                consentRecording: true,
                consentRecordingWithdrawnAt: null,
              },
              data: { consentRecordingWithdrawnAt: adesso },
            })
          : { count: 0 };
      proveRegistrazione = prove.count + dateAllIscrizione.count;
    }

    const proveTracce = await tx.multitrackConsent.updateMany({
      where: {
        eventId,
        withdrawnAt: null,
        OR: [
          { jitsiUserId: { in: tuttiIPosti } },
          ...(listaIscrizioni.length > 0
            ? [{ registrationId: { in: listaIscrizioni } }]
            : []),
        ],
      },
      data: { withdrawnAt: adesso },
    });
    const tracceAllIscrizione =
      listaIscrizioni.length > 0
        ? await tx.registration.updateMany({
            where: {
              eventId,
              id: { in: listaIscrizioni },
              consentMultitrack: true,
              consentMultitrackWithdrawnAt: null,
            },
            data: { consentMultitrackWithdrawnAt: adesso },
          })
        : { count: 0 };
    // Le frasi dei sottotitoli gia' salvate: restano i tempi, come per chi
    // non ha acconsentito (lib/captions/transcript).
    const frasi = await tx.captionSegment.updateMany({
      where: {
        eventId,
        OR: [
          { seatId: { in: tuttiIPosti } },
          ...listaIscrizioni.map((r) => ({ seatId: { startsWith: `reg-${r}-` } })),
        ],
      },
      data: { seatId: null, speakerName: null, text: null },
    });
    const proveTrascrizione = proveTracce.count + tracceAllIscrizione.count;
    if (proveRegistrazione + proveTrascrizione + frasi.count > 0) {
      await tx.gdprAuditLog.create({
        data: {
          eventId,
          action: 'CONSENT_WITHDRAWN',
          recordCount: proveRegistrazione + proveTrascrizione,
          details: JSON.stringify({
            source: 'room',
            recording: proveRegistrazione,
            transcription: proveTrascrizione,
            captionSegmentsCleared: frasi.count,
          }),
        },
      });
    }
    return { registrazione: proveRegistrazione > 0, trascrizione: proveTrascrizione > 0 };
  });
}

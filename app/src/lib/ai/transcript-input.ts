/**
 * La trascrizione (e i sottotitoli) che il worker scarica per sintesi,
 * traduzioni, doppiaggi e archivio.
 *
 * Il worker legge il file nell'archivio, non la banca dati. Una trascrizione
 * corretta a mano nell'editor (`revisedAt`) ha la versione giusta solo nella
 * banca dati: prima di firmare l'indirizzo la si riscrive nell'archivio, cosi'
 * cio' che si genera dopo la correzione legge il testo corretto. Si fa qui, a
 * ogni presa in carico, e non al salvataggio nell'editor: e' l'unico punto da
 * cui passano tutti i lavori, e si ripara da se' se una scrittura precedente
 * non e' riuscita. Cio' che e' gia' stato generato resta com'e'.
 *
 * La trascrizione dai sottotitoli live non ha un file e non va ai worker: il
 * suo corpo porta dati che restano solo cifrati nella banca dati, e la
 * cancellazione di una persona riscrive solo quello. La rotta delle traduzioni
 * la rifiuta.
 */

import { prisma } from '@/lib/db';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { sha256Hex } from '@/lib/ai/transcript-format';
import { presignArtifactDownload, rewritePostprodBlob } from '@/lib/storage/postprod';

/** Oltre questo tempo la scrittura si abbandona e il lavoro parte comunque:
 *  la presa in carico risponde a un worker che aspetta al massimo 30 s. */
const TEMPO_SCRITTURA_MS = 8_000;
/** Scritture al massimo: la seconda solo se una modifica concorrente ha
 *  superato la prima (resta dentro i 30 s del worker). */
const TENTATIVI = 2;

type Registrazione = { id: string; sourceLanguage: string | null };

/**
 * Allinea il file dell'archivio alla copia nella banca dati. Dopo ogni
 * scrittura rilegge l'impronta: se nel frattempo un salvataggio dell'editor
 * (una cancellazione, per esempio) ha cambiato il testo, la scrittura appena
 * fatta e' vecchia e si ripete con il testo nuovo. Cosi' una presa in carico
 * lenta non rimette nell'archivio cio' che e' stato tolto.
 */
async function allinea(
  artifactId: string,
  blobKey: string,
  recordingId: string
): Promise<void> {
  for (let i = 0; i < TENTATIVI; i++) {
    const a = await prisma.postprodArtifact.findUnique({
      where: { id: artifactId },
      select: { inlineBody: true, contentHash: true, mimeType: true },
    });
    const corpo = a?.inlineBody ? tryDecryptPII(a.inlineBody) : null;
    const scritto = corpo
      ? await rewritePostprodBlob(
          blobKey,
          corpo,
          a?.mimeType || 'application/octet-stream',
          TEMPO_SCRITTURA_MS
        )
      : false;
    if (!scritto) {
      // Il lavoro parte comunque, sulla versione nell'archivio: fermarlo non
      // renderebbe raggiungibile l'archivio. Lo si dice nel registro.
      console.error(
        `[postprod-claim] registrazione ${recordingId}: versione corretta non riscritta nell'archivio (${blobKey}), il lavoro legge la precedente`
      );
      return;
    }
    const dopo = await prisma.postprodArtifact.findUnique({
      where: { id: artifactId },
      select: { contentHash: true },
    });
    if (!dopo || dopo.contentHash === sha256Hex(corpo!)) return;
  }
  console.error(
    `[postprod-claim] registrazione ${recordingId}: il testo e' cambiato durante ogni scrittura (${blobKey}), l'archivio puo' non avere l'ultima versione`
  );
}

export async function trascrizionePerIlWorker(
  recording: Registrazione,
  leaseMinutes: number
): Promise<{ downloadUrl: string; blobKey: string } | null> {
  const trascrizione = await prisma.postprodArtifact.findFirst({
    where: { recordingId: recording.id, type: 'TRANSCRIPT_JSON', language: null },
    select: { id: true, blobKey: true, revisedAt: true },
  });
  // Dai sottotitoli live: nessun file da dare al worker.
  if (!trascrizione || !trascrizione.blobKey) return null;
  if (trascrizione.revisedAt)
    await allinea(trascrizione.id, trascrizione.blobKey, recording.id);
  const downloadUrl = await presignArtifactDownload({
    blobKey: trascrizione.blobKey,
    expiresInMinutes: leaseMinutes,
  });
  return { downloadUrl, blobKey: trascrizione.blobKey };
}

/**
 * I sottotitoli nella lingua della registrazione, per l'archivio: corretti
 * anch'essi quando la trascrizione e' stata rivista. Si sceglie con la lingua
 * della registrazione (`sceltaSorgente`, come l'editor, che prova anche quella
 * scritta nella trascrizione); senza, i piu' recenti, cioe' quelli
 * dell'ultima trascrizione.
 */
export async function sottotitoliPerIlWorker(
  recording: Registrazione,
  leaseMinutes: number
): Promise<{ downloadUrl: string; blobKey: string; language: string | null } | null> {
  const [righe, rivista] = await Promise.all([
    prisma.postprodArtifact.findMany({
      where: { recordingId: recording.id, type: 'TRANSCRIPT_VTT' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, blobKey: true, language: true },
    }),
    prisma.postprodArtifact.findFirst({
      where: {
        recordingId: recording.id,
        type: 'TRANSCRIPT_JSON',
        language: null,
        revisedAt: { not: null },
      },
      select: { id: true },
    }),
  ]);
  const vtt = sceltaSorgente(righe, [recording.sourceLanguage]) ?? righe[0];
  if (!vtt || !vtt.blobKey) return null;
  if (rivista) await allinea(vtt.id, vtt.blobKey, recording.id);
  const downloadUrl = await presignArtifactDownload({
    blobKey: vtt.blobKey,
    expiresInMinutes: leaseMinutes,
  });
  return { downloadUrl, blobKey: vtt.blobKey, language: vtt.language };
}

/**
 * Fra i file per lingua (sottotitoli, testo semplice) quello nella lingua
 * della registrazione: la prima lingua dell'elenco che ha un file. Lo usano
 * l'editor e la presa in carico, perche' scelgano lo stesso file.
 */
export function sceltaSorgente<T extends { language: string | null }>(
  righe: T[],
  lingue: (string | null | undefined)[]
): T | undefined {
  for (const lingua of lingue) {
    if (!lingua) continue;
    const trovata = righe.find((r) => r.language === lingua);
    if (trovata) return trovata;
  }
  return undefined;
}

import type { Prisma, PostprodArtifactType } from '@prisma/client';

/**
 * Conserva il testo **come l'ha prodotto la macchina**, alla prima correzione.
 *
 * PERCHÉ. Correggendo un segmento nell'editor l'artefatto veniva sovrascritto:
 * di ciò che aveva prodotto la trascrizione automatica non restava traccia. Per
 * il verbale di un ente pubblico le due cose vanno distinte — chi legge deve
 * poter sapere che cosa ha detto la macchina e che cosa ha corretto una persona.
 *
 * SOLO LA PRIMA VOLTA. Si conserva la versione della macchina, non ogni
 * revisione: dalla seconda correzione in poi questa funzione non fa nulla. Una
 * cronologia completa sarebbe un'altra funzione, con un'altra conservazione e
 * un'altra superficie di dati personali.
 *
 * NON SI DECIFRA NULLA. Il corpo si copia com'è, cifrato, insieme al suo hash e
 * alla sua dimensione: la copia è identica byte per byte, e nessun testo in
 * chiaro attraversa questo passaggio.
 */

/** I campi dell'artefatto che servono per conservarne l'originale. */
export interface ArtefattoDaConservare {
  id: string;
  recordingId: string;
  type: PostprodArtifactType;
  language: string | null;
  inlineBody: string | null;
  contentHash: string;
  sizeBytes: bigint | null;
  modelId: string | null;
  modelVersion: string | null;
}

/**
 * Il minimo che serve del client Prisma, dichiarato per struttura invece di
 * prendere l'intero delegate: la transazione vera lo soddisfa, e un test può
 * soddisfarlo senza inventare venti metodi che questa funzione non chiama.
 */
interface Transazione {
  postprodOriginalBody: {
    createMany(args: {
      data: Prisma.PostprodOriginalBodyCreateManyInput[];
      skipDuplicates?: boolean;
    }): Promise<{ count: number }>;
  };
}

/**
 * Copia il corpo corrente degli artefatti indicati, saltando quelli che hanno
 * già un originale conservato e quelli senza corpo inline (il testo vive nel
 * solo archivio: lì non c'è nulla da copiare qui).
 *
 * Va chiamata DENTRO la transazione che riscrive gli artefatti, e **prima** che
 * i corpi vengano modificati.
 */
export async function conservaOriginali(
  tx: Transazione,
  artefatti: ArtefattoDaConservare[],
  eventId: string,
): Promise<number> {
  const daConservare = artefatti.filter((a) => a.inlineBody !== null);
  if (daConservare.length === 0) return 0;

  const risultato = await tx.postprodOriginalBody.createMany({
    data: daConservare.map((a) => ({
      artifactId: a.id,
      recordingId: a.recordingId,
      eventId,
      type: a.type,
      language: a.language,
      body: a.inlineBody as string,
      contentHash: a.contentHash,
      sizeBytes: a.sizeBytes,
      modelId: a.modelId,
      modelVersion: a.modelVersion,
    })),
    // Il vincolo di unicità su `artifactId` è ciò che rende questa funzione
    // idempotente: la seconda correzione non sovrascrive la prima versione.
    skipDuplicates: true,
  });

  return risultato.count;
}

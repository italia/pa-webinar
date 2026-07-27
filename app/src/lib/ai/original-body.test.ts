import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  applicaRedazione,
  conservaOriginali,
  type ArtefattoDaConservare,
  type SegmentoRedigibile,
} from './original-body';

/**
 * Il pezzo che rende confrontabili le due versioni di un verbale. Le due
 * proprietà che contano: si conserva la versione della MACCHINA (non l'ultima
 * revisione) e il corpo si copia CIFRATO, senza passare dal testo in chiaro.
 */
function artefatto(over: Partial<ArtefattoDaConservare> = {}): ArtefattoDaConservare {
  return {
    id: 'art-1',
    recordingId: 'rec-1',
    type: 'TRANSCRIPT_JSON',
    language: null,
    inlineBody: 'cifrato:v1:testo-della-macchina',
    contentHash: 'a'.repeat(64),
    sizeBytes: BigInt(1234),
    modelId: 'whisperx-large-v3',
    modelVersion: '3.1.1',
    ...over,
  };
}

function transazione() {
  return { postprodOriginalBody: { createMany: vi.fn().mockResolvedValue({ count: 1 }) } };
}

describe('conservaOriginali', () => {
  beforeEach(() => vi.clearAllMocks());

  it('copia il corpo così com’è, senza decifrarlo', async () => {
    const tx = transazione();
    await conservaOriginali(tx, [artefatto()], 'evt-1');

    const dati = tx.postprodOriginalBody.createMany.mock.calls[0]?.[0].data[0];
    expect(dati.body).toBe('cifrato:v1:testo-della-macchina');
    expect(dati.contentHash).toBe('a'.repeat(64));
    expect(dati.sizeBytes).toBe(BigInt(1234));
    // La provenienza è ciò che distingue la versione della macchina da quella
    // rivista: senza, l'originale non dichiara chi lo ha prodotto.
    expect(dati.modelId).toBe('whisperx-large-v3');
    expect(dati.modelVersion).toBe('3.1.1');
    expect(dati.eventId).toBe('evt-1');
  });

  it('non sovrascrive un originale già conservato', async () => {
    // Dalla seconda correzione in poi la versione della macchina è già al
    // sicuro: si conserva quella, non l'ultima revisione.
    const tx = transazione();
    await conservaOriginali(tx, [artefatto()], 'evt-1');
    expect(tx.postprodOriginalBody.createMany.mock.calls[0]?.[0].skipDuplicates).toBe(true);
  });

  it('dichiara la provenienza incerta quando non è dimostrabile', async () => {
    // Alla prima conservazione di una trascrizione già corretta prima che
    // questa funzione esistesse, quel testo NON è quello della macchina:
    // attribuirlo a un modello sarebbe peggio che non conservarlo.
    const tx = transazione();
    await conservaOriginali(tx, [artefatto()], 'evt-1', false);
    expect(tx.postprodOriginalBody.createMany.mock.calls[0]?.[0].data[0].certainMachineOrigin).toBe(
      false,
    );
  });

  it('salta gli artefatti senza corpo inline', async () => {
    // Il testo vive nel solo archivio: qui non c'è nulla da copiare, e una riga
    // con corpo vuoto direbbe il falso.
    const tx = transazione();
    const conservati = await conservaOriginali(tx, [artefatto({ inlineBody: null })], 'evt-1');
    expect(tx.postprodOriginalBody.createMany).not.toHaveBeenCalled();
    expect(conservati).toBe(0);
  });

  it('conserva più artefatti insieme, ognuno con il proprio tipo e lingua', async () => {
    const tx = transazione();
    await conservaOriginali(
      tx,
      [
        artefatto(),
        artefatto({ id: 'art-2', type: 'TRANSCRIPT_VTT', language: 'it', inlineBody: 'cifrato:vtt' }),
      ],
      'evt-1',
    );
    const righe = tx.postprodOriginalBody.createMany.mock.calls[0]?.[0].data;
    expect(righe).toHaveLength(2);
    expect(righe[1]).toMatchObject({ artifactId: 'art-2', type: 'TRANSCRIPT_VTT', language: 'it' });
  });

  it('senza artefatti da conservare non tocca il database', async () => {
    const tx = transazione();
    expect(await conservaOriginali(tx, [], 'evt-1')).toBe(0);
    expect(tx.postprodOriginalBody.createMany).not.toHaveBeenCalled();
  });
});

describe('applicaRedazione', () => {
  function segmenti(): SegmentoRedigibile[] {
    return [
      { text: 'Buongiorno a tutti', words: [{ word: 'Buongiorno' }] },
      { text: 'Il paziente si chiama Mario Rossi', words: [{ word: 'Il' }] },
      { text: 'Passiamo al punto due', words: [{ word: 'Passiamo' }] },
    ];
  }

  it('toglie il testo indicato e i tempi delle parole di quella riga', () => {
    const segs = segmenti();
    const redatti = applicaRedazione(segs, [{ index: 1, text: '[omissis]' }]);
    expect(redatti).toBe(1);
    expect(segs[1]?.text).toBe('[omissis]');
    expect('words' in segs[1]!).toBe(false);
    // Le righe non toccate restano intatte, tempi delle parole compresi.
    expect(segs[0]?.text).toBe('Buongiorno a tutti');
    expect('words' in segs[0]!).toBe(true);
  });

  it('NON riscrive una riga il cui testo non cambia', () => {
    // È il caso che rovinava tutto: l'editor manda il testo di ogni segmento
    // modificato, anche quando l'unica modifica è il relatore. Scrivere
    // comunque sostituirebbe il testo della macchina con quello già corretto
    // da una persona.
    const segs = segmenti();
    const redatti = applicaRedazione(segs, [{ index: 0, text: 'Buongiorno a tutti' }]);
    expect(redatti).toBe(0);
    expect('words' in segs[0]!).toBe(true);
  });

  it('ignora le modifiche senza testo e gli indici inesistenti', () => {
    const segs = segmenti();
    expect(applicaRedazione(segs, [{ index: 0 }, { index: 99, text: 'x' }])).toBe(0);
  });

  it('conta ogni riga davvero cambiata', () => {
    const segs = segmenti();
    const redatti = applicaRedazione(segs, [
      { index: 0, text: '' },
      { index: 2, text: 'Passiamo al punto due' },
      { index: 1, text: '[omissis]' },
    ]);
    expect(redatti).toBe(2);
  });
});

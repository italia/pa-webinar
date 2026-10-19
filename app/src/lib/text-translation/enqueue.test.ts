// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  evento: vi.fn(),
  impostazioni: vi.fn(),
  inCorso: vi.fn(),
  crea: vi.fn(),
  aggiorna: vi.fn(),
  sql: vi.fn(async () => 0),
}));
vi.mock('@/lib/db', () => {
  const tx = {
    $executeRaw: m.sql,
    postprodJob: { findFirst: m.inCorso, create: m.crea },
    event: { findUnique: m.evento, update: m.aggiorna },
  };
  return {
    prisma: {
      ...tx,
      siteSetting: { findUnique: m.impostazioni },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { accodaTraduzioneTesti, salvaTraduzioni } from './enqueue';
import { improntaSorgente } from './source';

const EVENTO = '11111111-2222-4333-8444-555555555555';
const sorgente = {
  sourceLanguage: 'it',
  title: 'Ciclo | Titolo',
  description: '## Testo',
};
const ambiente = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_MT_BASE_URL = 'http://videocall-pa-webinar-mt:8080/v1';
  m.evento.mockResolvedValue({ id: EVENTO, textTranslations: null });
  m.impostazioni.mockResolvedValue({ aiPipelineEnabled: true });
  m.inCorso.mockResolvedValue(null);
  m.crea.mockResolvedValue({ id: 'job-1' });
});
afterEach(() => {
  process.env = { ...ambiente };
});

describe('accodaTraduzioneTesti', () => {
  it("accoda un lavoro TRANSLATE_TEXT dell'evento con il testo e la sua impronta, uno alla volta", async () => {
    const esito = await accodaTraduzioneTesti(EVENTO, sorgente, ['fr', 'en', 'it', 'en']);
    expect(esito).toEqual({ stato: 'accodato', jobId: 'job-1' });
    // Il lucchetto dell'evento prima di guardare i lavori in corso.
    expect(JSON.stringify(m.sql.mock.calls[0])).toContain(
      `event-text-translation:${EVENTO}`
    );
    const dati = m.crea.mock.calls[0]![0].data;
    expect(dati).toMatchObject({
      eventId: EVENTO,
      kind: 'TRANSLATE_TEXT',
      status: 'PENDING',
      payload: {
        eventId: EVENTO,
        sourceLanguage: 'it',
        targetLanguages: ['en', 'fr'],
        title: 'Ciclo | Titolo',
        description: '## Testo',
        sourceHash: await improntaSorgente(sorgente),
      },
    });
    expect(dati.idempotencyKey).toMatch(
      new RegExp(`^text-translation:${EVENTO}:[0-9a-f]{64}:en,fr:\\d+$`)
    );
  });

  it("una traduzione gia' in corso: la seconda richiesta la ritrova, con il suo testo", async () => {
    m.inCorso.mockResolvedValue({ id: 'job-0', payload: { sourceHash: 'x' } });
    expect(await accodaTraduzioneTesti(EVENTO, sorgente, ['en'])).toEqual({
      stato: 'in-corso',
      jobId: 'job-0',
      sourceHash: null,
    });
    expect(m.crea).not.toHaveBeenCalled();
  });

  it("la stessa richiesta con la proposta gia' pronta non accoda niente", async () => {
    const impronta = await improntaSorgente(sorgente);
    m.evento.mockResolvedValue({
      id: EVENTO,
      textTranslations: {
        version: 1,
        sourceLanguage: 'it',
        sourceHash: impronta,
        generatedAt: '',
        model: { id: null, version: null },
        title: { en: 'Cycle | Title', fr: 'Cycle | Titre' },
        description: { en: '## Text', fr: '## Texte' },
      },
    });
    expect(await accodaTraduzioneTesti(EVENTO, sorgente, ['en', 'fr'])).toEqual({
      stato: 'pronto',
    });
    // Una lingua in piu': si accoda.
    expect((await accodaTraduzioneTesti(EVENTO, sorgente, ['en', 'de'])).stato).toBe(
      'accodato'
    );
    // Un altro testo: si accoda.
    expect(
      (await accodaTraduzioneTesti(EVENTO, { ...sorgente, title: 'Altro' }, ['en'])).stato
    ).toBe('accodato');
  });

  it('pipeline spenta o motore assente: niente in coda', async () => {
    m.impostazioni.mockResolvedValueOnce({ aiPipelineEnabled: false });
    expect(await accodaTraduzioneTesti(EVENTO, sorgente, ['en'])).toEqual({
      stato: 'ai-spenta',
    });
    delete process.env.AI_MT_BASE_URL;
    expect(await accodaTraduzioneTesti(EVENTO, sorgente, ['en'])).toEqual({
      stato: 'motore-assente',
    });
    m.evento.mockResolvedValueOnce(null);
    expect(await accodaTraduzioneTesti(EVENTO, sorgente, ['en'])).toEqual({
      stato: 'evento-assente',
    });
    expect(m.crea).not.toHaveBeenCalled();
  });
});

describe('salvaTraduzioni', () => {
  const base = {
    eventId: EVENTO,
    sourceLanguage: 'it',
    sourceHash: 'h1',
    sourceTitle: 'Ciclo | Titolo',
    modelId: 'modello',
    modelVersion: null,
  };

  it('salva la proposta normalizzata e non tocca titolo e descrizione', async () => {
    const salvata = await salvaTraduzioni({
      ...base,
      title: { en: 'Cycle | The | Title', de: '   ' },
      description: { en: 'Text\r\n' },
    });
    expect(salvata).toMatchObject({
      title: { en: 'Cycle | The Title' },
      description: { en: 'Text' },
    });
    const dati = m.aggiorna.mock.calls[0]![0].data;
    expect(Object.keys(dati)).toEqual(['textTranslations']);
  });

  it('dallo stesso testo le lingue si aggiungono; da un altro testo la proposta si sostituisce', async () => {
    const prima = {
      version: 1,
      sourceLanguage: 'it',
      sourceHash: 'h1',
      generatedAt: '',
      model: { id: null, version: null },
      title: { fr: 'Titre' },
      description: { fr: 'Texte' },
    };
    m.evento.mockResolvedValue({ textTranslations: prima });
    const unita = await salvaTraduzioni({
      ...base,
      title: { en: 'Title' },
      description: {},
    });
    expect(unita?.title).toEqual({ fr: 'Titre', en: 'Title' });
    expect(unita?.description).toEqual({ fr: 'Texte' });
    const nuova = await salvaTraduzioni({
      ...base,
      sourceHash: 'h2',
      title: { en: 'Title' },
      description: {},
    });
    expect(nuova?.title).toEqual({ en: 'Title' });
    expect(nuova?.description).toEqual({});
  });
});

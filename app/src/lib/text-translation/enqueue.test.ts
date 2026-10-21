// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  evento: vi.fn(),
  impostazioni: vi.fn(),
  inCorso: vi.fn(),
  crea: vi.fn(),
  aggiorna: vi.fn(),
  sql: vi.fn(async () => 0),
  riga: vi.fn(async () => []),
}));
vi.mock('@/lib/db', () => {
  const tx = {
    $executeRaw: m.sql,
    $queryRaw: m.riga,
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

import { prisma } from '@/lib/db';

import { accodaTraduzioneTesti, applicaTraduzioni, salvaTraduzioni } from './enqueue';
import type { TextTranslations } from './proposals';
import { improntaSorgente } from './source';

const EVENTO = '11111111-2222-4333-8444-555555555555';
const sorgente = {
  sourceLanguage: 'it',
  title: 'Ciclo | Titolo',
  description: '## Testo',
};
const IMPRONTA = improntaSorgente(sorgente);
const ambiente = { ...process.env };
const tx = prisma as unknown as Parameters<typeof applicaTraduzioni>[1];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_MT_BASE_URL = 'http://videocall-pa-webinar-mt:8080/v1';
  m.evento.mockResolvedValue({
    title: { it: 'Ciclo | Titolo', en: 'Mine', fr: 'Auto' },
    description: { it: '## Testo', en: 'Mine too', fr: 'Auto' },
    textLocaleState: {
      en: { origin: 'HUMAN', sourceHash: 'x', at: '2026-10-20T09:00:00.000Z' },
      fr: { origin: 'MACHINE', sourceHash: 'x', at: '2026-10-20T09:00:00.000Z' },
    },
    textTranslations: null,
    aiTargetLocales: 'en,fr,de',
    eventType: 'SCHEDULED',
    status: 'PUBLISHED',
  });
  m.impostazioni.mockResolvedValue({
    aiPipelineEnabled: true,
    defaultLocale: 'it',
    availableLocales: ['it', 'en', 'fr', 'de', 'es'],
    aiDefaultTargetLocales: 'en',
  });
  m.inCorso.mockResolvedValue(null);
  m.crea.mockResolvedValue({ id: 'job-1' });
});
afterEach(() => {
  process.env = { ...ambiente };
});

describe('accodaTraduzioneTesti — «Riprova»', () => {
  it('traduce il testo principale salvato, solo nelle lingue della pagina vuote o automatiche', async () => {
    const esito = await accodaTraduzioneTesti(EVENTO, {
      lingue: ['en', 'fr', 'de', 'it'],
    });
    expect(esito).toEqual({ stato: 'accodato', jobId: 'job-1', lingue: ['de', 'fr'] });
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
        targetLanguages: ['de', 'fr'],
        title: 'Ciclo | Titolo',
        description: '## Testo',
        sourceHash: IMPRONTA,
      },
    });
    // Il testo di una persona non si tocca.
    expect(m.aggiorna).not.toHaveBeenCalled();
  });

  it('solo le lingue della pagina; niente per chiamate istantanee ed eventi archiviati', async () => {
    // es e' attiva sul sito ma non e' fra le lingue dell'evento.
    expect(await accodaTraduzioneTesti(EVENTO, { lingue: ['es'] })).toEqual({
      stato: 'nessuna',
    });
    for (const extra of [{ eventType: 'INSTANT' }, { status: 'ARCHIVED' }]) {
      m.evento.mockResolvedValueOnce({
        title: { it: 'Titolo' },
        description: {},
        textLocaleState: null,
        aiTargetLocales: 'de',
        eventType: 'SCHEDULED',
        status: 'PUBLISHED',
        ...extra,
      });
      expect(await accodaTraduzioneTesti(EVENTO, { lingue: ['de'] })).toEqual({
        stato: 'nessuna',
      });
    }
    expect(m.crea).not.toHaveBeenCalled();
  });

  it('solo lingue di una persona: niente da tradurre', async () => {
    expect(await accodaTraduzioneTesti(EVENTO, { lingue: ['en'] })).toEqual({
      stato: 'nessuna',
    });
    expect(m.crea).not.toHaveBeenCalled();
  });

  it("una traduzione gia' in corso: non si accoda niente", async () => {
    m.inCorso.mockResolvedValue({ id: 'job-0' });
    expect(await accodaTraduzioneTesti(EVENTO, { lingue: ['de'] })).toEqual({
      stato: 'in-corso',
      jobId: 'job-0',
    });
    expect(m.crea).not.toHaveBeenCalled();
  });

  it('pipeline spenta, motore assente, evento assente, testo assente', async () => {
    m.impostazioni.mockResolvedValueOnce({ aiPipelineEnabled: false });
    expect(await accodaTraduzioneTesti(EVENTO, { lingue: ['de'] })).toEqual({
      stato: 'ai-spenta',
    });
    m.evento.mockResolvedValueOnce(null);
    expect(await accodaTraduzioneTesti(EVENTO, { lingue: ['de'] })).toEqual({
      stato: 'evento-assente',
    });
    m.evento.mockResolvedValueOnce({
      title: { it: ' ' },
      description: {},
      textLocaleState: null,
      aiTargetLocales: 'de',
      eventType: 'SCHEDULED',
      status: 'PUBLISHED',
    });
    expect(await accodaTraduzioneTesti(EVENTO, { lingue: ['de'] })).toEqual({
      stato: 'senza-testo',
    });
    delete process.env.AI_MT_BASE_URL;
    expect(await accodaTraduzioneTesti(EVENTO, { lingue: ['de'] })).toEqual({
      stato: 'motore-assente',
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

  it('salva la versione automatica normalizzata', async () => {
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

  it('dallo stesso testo le lingue si aggiungono; da un altro testo la versione si sostituisce', async () => {
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

describe('applicaTraduzioni — la consegna in titolo e descrizione', () => {
  const proposta = (
    title: Record<string, string>,
    description: Record<string, string>
  ): TextTranslations => ({
    version: 1,
    sourceLanguage: 'it',
    sourceHash: IMPRONTA,
    generatedAt: '',
    model: { id: 'modello', version: null },
    title,
    description,
  });
  const consegna = (p: TextTranslations, targetLanguages = ['en', 'fr', 'de']) =>
    applicaTraduzioni(
      {
        eventId: EVENTO,
        sourceLanguage: 'it',
        sourceHash: IMPRONTA,
        targetLanguages,
        proposta: p,
        modelId: 'modello',
      },
      tx
    );

  it('scrive le lingue vuote e quelle automatiche, mai sopra il testo di una persona', async () => {
    const esito = await consegna(
      proposta(
        { en: 'Cycle | Title', fr: 'Cycle | Titre', de: 'Zyklus | Titel' },
        { en: '## Text', fr: '## Texte', de: '## Text DE' }
      )
    );
    expect(esito).toEqual({ applicate: ['de', 'fr'], superata: false });
    // La riga bloccata prima di leggere.
    expect(m.riga).toHaveBeenCalledTimes(1);
    const dati = m.aggiorna.mock.calls[0]![0].data;
    expect(dati.title).toEqual({
      it: 'Ciclo | Titolo',
      en: 'Mine',
      fr: 'Cycle | Titre',
      de: 'Zyklus | Titel',
    });
    expect(dati.description.en).toBe('Mine too');
    expect(dati.textLocaleState.en.origin).toBe('HUMAN');
    expect(dati.textLocaleState.de).toMatchObject({
      origin: 'MACHINE',
      sourceHash: IMPRONTA,
      model: 'modello',
    });
    expect(dati.textLocaleState.fr).toMatchObject({
      origin: 'MACHINE',
      sourceHash: IMPRONTA,
    });
  });

  it('il testo principale e cambiato dopo la richiesta: resta la versione automatica e basta', async () => {
    m.evento.mockResolvedValueOnce({
      title: { it: 'Un altro titolo' },
      description: { it: '## Testo' },
      textLocaleState: null,
    });
    expect(await consegna(proposta({ de: 'Titel' }, { de: 'Text' }))).toEqual({
      applicate: [],
      superata: true,
    });
    expect(m.aggiorna).not.toHaveBeenCalled();
  });

  it('una lingua senza il titolo o la descrizione che il testo principale ha non si scrive', async () => {
    expect(await consegna(proposta({ de: 'Titel' }, {}))).toEqual({
      applicate: [],
      superata: false,
    });
    expect(await consegna(proposta({ de: '   ' }, { de: 'Text' }))).toEqual({
      applicate: [],
      superata: false,
    });
    expect(m.aggiorna).not.toHaveBeenCalled();
  });

  it('una lingua tolta dalle lingue dell evento mentre si traduceva non torna', async () => {
    m.evento.mockResolvedValueOnce({
      title: { it: 'Ciclo | Titolo' },
      description: { it: '## Testo' },
      textLocaleState: null,
      aiTargetLocales: 'de',
    });
    const esito = await consegna(
      proposta({ fr: 'Titre', de: 'Titel' }, { fr: 'Texte', de: 'Text' }),
      ['fr', 'de']
    );
    expect(esito.applicate).toEqual(['de']);
    expect(m.aggiorna.mock.calls[0]![0].data.title).not.toHaveProperty('fr');
  });

  it('solo le lingue chieste dal lavoro', async () => {
    const esito = await consegna(
      proposta({ de: 'Titel', es: 'Título' }, { de: 'Text', es: 'Texto' }),
      ['de']
    );
    expect(esito.applicate).toEqual(['de']);
    expect(m.aggiorna.mock.calls[0]![0].data.title).not.toHaveProperty('es');
  });
});

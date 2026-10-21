// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  evento: vi.fn(),
  impostazioni: vi.fn(),
  lavoro: vi.fn(),
  crea: vi.fn(),
  sql: vi.fn(async () => 0),
  audit: vi.fn(async () => undefined),
}));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: m.audit }));
vi.mock('@/lib/db', () => {
  const tx = {
    $executeRaw: m.sql,
    postprodJob: { findFirst: m.lavoro, create: m.crea },
  };
  return {
    prisma: {
      ...tx,
      event: { findUnique: m.evento },
      siteSetting: { findUnique: m.impostazioni },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { calcolaStatoTesti, riconciliaTraduzioni } from './auto';
import { improntaSorgente, testoSorgente } from './source';

const EVENTO = '11111111-2222-4333-8444-555555555555';
const ambiente = { ...process.env };
const titoli = { it: 'Ciclo | Titolo', en: 'Mine', fr: 'Auto vecchia', de: 'Auto' };
const descrizioni = { it: 'Testo', en: 'Mine', fr: 'Vecchia', de: 'Auto' };
const IMPRONTA = improntaSorgente(testoSorgente('it', titoli, descrizioni));
const evento = (extra: Record<string, unknown> = {}) => ({
  status: 'DRAFT',
  eventType: 'SCHEDULED',
  title: titoli,
  description: descrizioni,
  textLocaleState: {
    en: { origin: 'HUMAN', sourceHash: 'vecchia', at: '' },
    fr: { origin: 'MACHINE', sourceHash: 'vecchia', at: '' },
    de: { origin: 'MACHINE', sourceHash: IMPRONTA, at: '' },
  },
  aiTargetLocales: 'en,fr,de,es,uk',
  ...extra,
});
const richiesta = new Request('http://x/api/events');

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_MT_BASE_URL = 'http://videocall-pa-webinar-mt:8080/v1';
  m.evento.mockResolvedValue(evento());
  m.impostazioni.mockResolvedValue({
    aiPipelineEnabled: true,
    defaultLocale: 'it',
    availableLocales: ['it', 'en', 'fr', 'de', 'es'],
    aiDefaultTargetLocales: 'en',
  });
  m.lavoro.mockResolvedValue(null);
  m.crea.mockResolvedValue({ id: 'job-1' });
});
afterEach(() => {
  process.env = { ...ambiente };
});

describe('riconciliaTraduzioni — la traduzione al salvataggio', () => {
  it('chiede solo le lingue della pagina vuote o automatiche da un altro testo', async () => {
    expect(await riconciliaTraduzioni(EVENTO, { request: richiesta })).toEqual({
      avviata: true,
      lingue: ['es', 'fr'],
    });
    const dati = m.crea.mock.calls[0]![0].data;
    expect(dati.payload).toMatchObject({
      sourceLanguage: 'it',
      targetLanguages: ['es', 'fr'],
      title: 'Ciclo | Titolo',
      sourceHash: IMPRONTA,
    });
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EVENT_TEXT_TRANSLATION_REQUESTED',
        target: EVENTO,
        details: expect.objectContaining({
          automatic: true,
          targetLanguages: ['es', 'fr'],
        }),
      })
    );
  });

  it('senza lingue salvate usa quelle predefinite del sito; nessuna lingua (vuoto) e una scelta', async () => {
    m.evento.mockResolvedValue(
      evento({ aiTargetLocales: null, title: { it: 'T' }, description: {} })
    );
    expect((await riconciliaTraduzioni(EVENTO)).lingue).toEqual(['en']);
    m.evento.mockResolvedValue(
      evento({ aiTargetLocales: '', title: { it: 'T' }, description: {} })
    );
    expect((await riconciliaTraduzioni(EVENTO)).avviata).toBe(false);
  });

  it('niente senza motore, a pipeline spenta, per le chiamate istantanee e gli archiviati', async () => {
    m.impostazioni.mockResolvedValueOnce({ aiPipelineEnabled: false });
    expect((await riconciliaTraduzioni(EVENTO)).avviata).toBe(false);
    m.evento.mockResolvedValueOnce(evento({ eventType: 'INSTANT' }));
    expect((await riconciliaTraduzioni(EVENTO)).avviata).toBe(false);
    m.evento.mockResolvedValueOnce(evento({ status: 'ARCHIVED' }));
    expect((await riconciliaTraduzioni(EVENTO)).avviata).toBe(false);
    delete process.env.AI_MT_BASE_URL;
    m.evento.mockClear();
    expect((await riconciliaTraduzioni(EVENTO)).avviata).toBe(false);
    // Senza motore non si legge nemmeno la banca dati.
    expect(m.evento).not.toHaveBeenCalled();
    expect(m.crea).not.toHaveBeenCalled();
  });

  it('niente con un lavoro gia aperto', async () => {
    m.lavoro.mockResolvedValueOnce({ id: 'aperto' });
    expect((await riconciliaTraduzioni(EVENTO)).avviata).toBe(false);
    expect(m.crea).not.toHaveBeenCalled();
  });

  it('non ripete un lavoro fallito sullo stesso testo; dopo una consegna nemmeno quello concluso', async () => {
    const stesso = (status: string) => ({
      status,
      payload: {
        eventId: EVENTO,
        sourceLanguage: 'it',
        targetLanguages: ['fr', 'es'],
        title: 'Ciclo | Titolo',
        description: 'Testo',
        sourceHash: IMPRONTA,
      },
    });
    // Fallito: si riprova a mano.
    m.lavoro.mockResolvedValueOnce(null).mockResolvedValueOnce(stesso('FAILED'));
    expect((await riconciliaTraduzioni(EVENTO)).avviata).toBe(false);
    // Concluso, appena consegnato: il motore ha lasciato vuote quelle lingue,
    // non si richiedono in un giro senza fine.
    m.lavoro.mockResolvedValueOnce(null).mockResolvedValueOnce(stesso('DONE'));
    expect((await riconciliaTraduzioni(EVENTO, { dopoConsegna: true })).avviata).toBe(
      false
    );
    // Concluso senza un testo per quelle lingue: si riprova a mano, non a
    // ogni salvataggio.
    m.lavoro.mockResolvedValueOnce(null).mockResolvedValueOnce(stesso('DONE'));
    expect((await riconciliaTraduzioni(EVENTO)).avviata).toBe(false);
    // Concluso con il testo, e chi salva le ha di nuovo vuote: si traducono.
    m.evento.mockResolvedValueOnce(
      evento({
        textTranslations: {
          version: 1,
          sourceLanguage: 'it',
          sourceHash: IMPRONTA,
          generatedAt: '',
          model: { id: null, version: null },
          title: { fr: 'Titre', es: 'Título' },
          description: { fr: 'Texte', es: 'Texto' },
        },
      })
    );
    m.lavoro.mockResolvedValueOnce(null).mockResolvedValueOnce(stesso('DONE'));
    expect((await riconciliaTraduzioni(EVENTO)).avviata).toBe(true);
    expect(m.crea).toHaveBeenCalledTimes(1);
  });

  it('un lavoro fallito su altre lingue, o su un altro testo, non ferma quello nuovo', async () => {
    for (const diverso of [{ targetLanguages: ['fr'] }, { sourceHash: 'b'.repeat(64) }]) {
      m.lavoro.mockResolvedValueOnce(null).mockResolvedValueOnce({
        status: 'FAILED',
        payload: {
          eventId: EVENTO,
          sourceLanguage: 'it',
          targetLanguages: ['fr', 'es'],
          title: 'Ciclo | Titolo',
          description: 'Testo',
          sourceHash: IMPRONTA,
          ...diverso,
        },
      });
      expect((await riconciliaTraduzioni(EVENTO)).avviata).toBe(true);
    }
  });

  it('nessuna lingua da tradurre, o niente testo: niente', async () => {
    m.evento.mockResolvedValueOnce(evento({ aiTargetLocales: 'en,de' }));
    expect((await riconciliaTraduzioni(EVENTO)).avviata).toBe(false);
    m.evento.mockResolvedValueOnce(evento({ title: { it: ' ' }, description: {} }));
    expect((await riconciliaTraduzioni(EVENTO)).avviata).toBe(false);
    expect(m.crea).not.toHaveBeenCalled();
  });

  it('un guasto non fa fallire chi salva', async () => {
    const errore = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.crea.mockRejectedValueOnce(new Error('db giu'));
    expect(await riconciliaTraduzioni(EVENTO)).toEqual({ avviata: false, lingue: [] });
    expect(errore).toHaveBeenCalled();
    errore.mockRestore();
  });
});

describe('calcolaStatoTesti — cio che legge il wizard', () => {
  const impostazioni = {
    aiPipelineEnabled: true,
    defaultLocale: 'it',
    availableLocales: ['it', 'en', 'fr', 'de', 'es'],
    aiDefaultTargetLocales: 'en',
  };
  const ora = new Date('2026-10-20T12:00:00.000Z');

  it('una riga per lingua: la principale, quelle dell evento, quelle con un testo', () => {
    const s = calcolaStatoTesti({
      evento: evento({ aiTargetLocales: 'en,fr,es,uk' }),
      impostazioni,
      lavoro: null,
      ora,
    });
    expect(s.engine).toBe('available');
    expect(s.principale).toBe('it');
    expect(s.lingue.map((l) => [l.code, l.state, l.page, l.event])).toEqual([
      ['it', 'principale', true, true],
      ['en', 'stale', true, true],
      ['fr', 'onSave', true, true],
      ['es', 'onSave', true, true],
      // Non attiva sul sito: solo sottotitoli e sintesi, nessuna promessa.
      ['uk', 'empty', false, true],
      // Ha un testo ma non e' fra le lingue dell'evento.
      ['de', 'machine', true, false],
    ]);
    expect(s.testi.title).toEqual({ en: 'Mine', fr: 'Auto vecchia', de: 'Auto' });
  });

  it('lavoro aperto: in traduzione, poi in attesa; lavoro fallito sullo stesso testo: non riuscita', () => {
    const lavoro = {
      status: 'PENDING' as 'PENDING' | 'FAILED',
      createdAt: new Date(ora.getTime() - 60_000),
      completedAt: null,
      errorCode: null,
      sourceHash: IMPRONTA,
      targetLanguages: ['es', 'fr'],
    };
    const aperto = calcolaStatoTesti({ evento: evento(), impostazioni, lavoro, ora });
    expect(aperto.lingue.find((l) => l.code === 'es')?.state).toBe('translating');
    const tardi = calcolaStatoTesti({
      evento: evento(),
      impostazioni,
      lavoro: { ...lavoro, createdAt: new Date(ora.getTime() - 16 * 60_000) },
      ora,
    });
    expect(tardi.lingue.find((l) => l.code === 'es')?.state).toBe('waiting');
    const fallito = calcolaStatoTesti({
      evento: evento(),
      impostazioni,
      lavoro: {
        ...lavoro,
        status: 'FAILED' as const,
        errorCode: 'MT_UNAVAILABLE' as const,
      },
      ora,
    });
    expect(fallito.lingue.find((l) => l.code === 'es')).toMatchObject({
      state: 'failed',
      failure: 'MT_UNAVAILABLE',
    });
    // Fallito su un altro testo: il prossimo salvataggio lo riprova da solo.
    const altro = calcolaStatoTesti({
      evento: evento(),
      impostazioni,
      lavoro: { ...lavoro, status: 'FAILED' as const, sourceHash: 'altro' },
      ora,
    });
    expect(altro.lingue.find((l) => l.code === 'es')?.state).toBe('onSave');
  });

  it('concluso senza un testo per una lingua: non riuscita, non «al salvataggio»', () => {
    const lavoro = {
      status: 'DONE' as const,
      createdAt: new Date(ora.getTime() - 60_000),
      completedAt: ora,
      errorCode: null,
      sourceHash: IMPRONTA,
      targetLanguages: ['es', 'fr'],
    };
    const s = calcolaStatoTesti({
      evento: evento({
        textTranslations: {
          version: 1,
          sourceLanguage: 'it',
          sourceHash: IMPRONTA,
          generatedAt: '',
          model: { id: null, version: null },
          title: { fr: 'Titre' },
          description: { fr: 'Texte' },
        },
      }),
      impostazioni,
      lavoro,
      ora,
    });
    expect(s.lingue.find((l) => l.code === 'es')).toMatchObject({
      state: 'failed',
      failure: 'GENERIC',
    });
  });

  it('una consegna a meta (il titolo senza la descrizione) conta come non riuscita', () => {
    const s = calcolaStatoTesti({
      evento: evento({
        textTranslations: {
          version: 1,
          sourceLanguage: 'it',
          sourceHash: IMPRONTA,
          generatedAt: '',
          model: { id: null, version: null },
          title: { es: 'Título' },
          description: {},
        },
      }),
      impostazioni,
      lavoro: {
        status: 'DONE' as const,
        createdAt: new Date(ora.getTime() - 60_000),
        completedAt: ora,
        errorCode: null,
        sourceHash: IMPRONTA,
        targetLanguages: ['es'],
      },
      ora,
    });
    expect(s.lingue.find((l) => l.code === 'es')?.state).toBe('failed');
  });

  it('una lingua con un testo fuori dalle lingue dell evento non promette traduzioni', () => {
    const s = calcolaStatoTesti({
      evento: evento({ aiTargetLocales: 'en' }),
      impostazioni,
      lavoro: null,
      ora,
    });
    // fr: automatica da un testo vecchio, ma non e' una lingua dell'evento.
    expect(s.lingue.find((l) => l.code === 'fr')).toMatchObject({
      state: 'stale',
      event: false,
    });
  });

  it('motore spento, chiamata istantanea o evento archiviato: nessuna promessa', () => {
    delete process.env.AI_MT_BASE_URL;
    const spento = calcolaStatoTesti({
      evento: evento(),
      impostazioni,
      lavoro: null,
      ora,
    });
    expect(spento.engine).toBe('off');
    expect(spento.lingue.find((l) => l.code === 'es')?.state).toBe('empty');
    expect(spento.lingue.find((l) => l.code === 'fr')?.state).toBe('stale');
    process.env.AI_MT_BASE_URL = 'http://mt';
    expect(
      calcolaStatoTesti({
        evento: evento({ eventType: 'INSTANT' }),
        impostazioni,
        lavoro: null,
        ora,
      }).engine
    ).toBe('off');
  });
});

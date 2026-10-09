import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    liveAction: { findMany: vi.fn() },
    question: { findMany: vi.fn() },
    chatMessage: { findMany: vi.fn() },
    eventMaterial: { findMany: vi.fn() },
    wordCloudSubmission: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
// Il testo della chat e' cifrato a riposo: nei test «cifrato:» lo simula.
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string) => (v.startsWith('cifrato:') ? v.slice('cifrato:'.length) : null),
}));

import { prisma } from '@/lib/db';

import { buildLiveTimeline, chaptersFromActions, describeAction, recordingTimeZero } from './live-timeline';

const T0 = new Date('2026-10-08T10:00:00Z');
const at = (min: number, sec = 0) => new Date(T0.getTime() + min * 60_000 + sec * 1000);
const m = <K extends keyof typeof prisma>(k: K) =>
  (prisma[k] as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany;
const raw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;
/** I conteggi per finestra, per tabella: la query si riconosce dal FROM. */
let conteggi: Record<'chat_messages' | 'reactions' | 'live_actions', Array<{ b: number; n: number }>>;

beforeEach(() => {
  vi.clearAllMocks();
  m('liveAction').mockResolvedValue([]);
  m('question').mockResolvedValue([]);
  m('chatMessage').mockResolvedValue([]);
  m('eventMaterial').mockResolvedValue([]);
  m('wordCloudSubmission').mockResolvedValue([]);
  conteggi = { chat_messages: [], reactions: [], live_actions: [] };
  raw.mockImplementation(async (...args: unknown[]) => {
    // Il nome della tabella arriva come frammento SQL tra i valori.
    const testo = JSON.stringify(args);
    const tabella = (['chat_messages', 'reactions', 'live_actions'] as const).find((t) =>
      testo.includes(`\\"${t}\\"`),
    );
    return tabella ? conteggi[tabella] : [];
  });
});

describe('describeAction', () => {
  const nessuna = new Map<string, { text: string; answerText: string | null }>();

  it('agenda: avviato, concluso, saltato, riaperto', () => {
    expect(describeAction('agenda.topic', { label: 'Apertura', status: 'CURRENT' }, nessuna)).toBe(
      'Argomento avviato: «Apertura»',
    );
    expect(describeAction('agenda.topic', { label: 'Apertura', status: 'SKIPPED' }, nessuna)).toBe(
      'Argomento saltato: «Apertura»',
    );
  });

  it('sondaggio chiuso: le risposte con i voti', () => {
    expect(
      describeAction(
        'poll.closed',
        { question: 'Quale servizio?', options: ['SPID', 'CIE'], counts: [5, 3], totalVotes: 8 },
        nessuna,
      ),
    ).toBe('Sondaggio chiuso: «Quale servizio?» — SPID 5, CIE 3 (8 voti)');
  });

  it('«In una parola» chiusa: le parole con le persone', () => {
    expect(
      describeAction(
        'wordcloud.closed',
        { prompt: 'Una parola?', words: [{ word: 'fiducia', count: 4 }] },
        nessuna,
      ),
    ).toBe('Risposte a «Una parola?»: fiducia (4)');
  });

  it('una parola tolta non si ripete, una domanda scartata non c’e’', () => {
    expect(describeAction('wordcloud.word_removed', { hidden: 2 }, nessuna)).toBe(
      'Il moderatore ha tolto una parola dalla nuvola',
    );
    const q = new Map([['q1', { text: 'Testo', answerText: null }]]);
    expect(describeAction('question.status', { questionId: 'q1', status: 'DISMISSED' }, q)).toBeNull();
  });

  it('risposta scritta: domanda e risposta, dalle loro righe', () => {
    const q = new Map([['q1', { text: 'Quando?', answerText: 'Domani' }]]);
    expect(
      describeAction('question.status', { questionId: 'q1', status: 'ANSWERED', answered: true }, q),
    ).toBe('Risposta scritta alla domanda «Quando?»: «Domani»');
  });

  it('i testi lunghi si accorciano', () => {
    const t = describeAction('agenda.topic', { label: 'x'.repeat(400), status: 'DONE' }, nessuna) ?? '';
    expect(t.length).toBeLessThan(320);
    expect(t.endsWith('…»')).toBe(true);
  });
});

describe('buildLiveTimeline', () => {
  it('mette tutto sulla base dei tempi della registrazione, in ordine', async () => {
    m('liveAction').mockResolvedValue([
      { at: at(12, 30), kind: 'agenda.topic', data: { label: 'Servizi', status: 'CURRENT' } },
      { at: at(-2), kind: 'poll.opened', data: { question: 'Pronti?', options: ['Sì', 'No'] } },
    ]);
    m('question').mockResolvedValue([
      { id: 'q1', text: 'Le slide?', answerText: null, status: 'PENDING', createdAt: at(20) },
      { id: 'q2', text: 'Offensiva', answerText: null, status: 'DISMISSED', createdAt: at(21) },
    ]);
    const tl = await buildLiveTimeline({ eventId: 'e1', t0: T0, exact: true, until: at(60) });
    expect(tl.t0).toBe(T0.toISOString());
    expect(tl.exact).toBe(true);
    expect(tl.entries).toEqual([
      { offsetSec: -120, kind: 'poll.opened', text: 'Sondaggio aperto: «Pronti?» (risposte: Sì / No)' },
      { offsetSec: 750, kind: 'agenda.topic', text: 'Argomento avviato: «Servizi»' },
      { offsetSec: 1200, kind: 'question.asked', text: 'Domanda dal pubblico (Q&A): «Le slide?»' },
    ]);
  });

  it('chat, reazioni e mani alzate: conteggi per finestra dall’inizio della registrazione', async () => {
    conteggi.live_actions = [{ b: 0, n: 2 }];
    conteggi.chat_messages = [{ b: 1, n: 3 }];
    conteggi.reactions = [{ b: -1, n: 1 }];
    const tl = await buildLiveTimeline({ eventId: 'e1', t0: T0, exact: false, until: at(60) });
    expect(tl.entries).toEqual([
      { offsetSec: -300, kind: 'reactions.activity', text: 'Reazioni: 1 in cinque minuti' },
      { offsetSec: 0, kind: 'hand.raised', text: '2 mani alzate in cinque minuti' },
      { offsetSec: 300, kind: 'chat.activity', text: 'Chat: 3 messaggi in cinque minuti' },
    ]);
    // Le finestre partono dallo zero della registrazione, non dall'orologio.
    const sqlMani = raw.mock.calls.find((c) => JSON.stringify(c).includes('live_actions'));
    expect(sqlMani).toContain(T0.getTime() / 1000);
    // Le alzate non si leggono riga per riga.
    const dove = m('liveAction').mock.calls[0]?.[0] as { where: { kind: unknown } };
    expect(dove.where.kind).toEqual({ notIn: ['hand.raised', 'hand.lowered'] });
  });

  it('le parole tolte dopo la chiusura non arrivano alla sintesi', async () => {
    m('liveAction').mockResolvedValue([
      {
        at: at(10),
        kind: 'wordcloud.closed',
        data: { roundId: 'g1', prompt: 'Una parola?', words: [{ word: 'fiducia', count: 3 }, { word: 'brutta', count: 1 }] },
      },
    ]);
    m('wordCloudSubmission').mockResolvedValue([{ roundId: 'g1', word: 'Brutta!' }]);
    const tl = await buildLiveTimeline({ eventId: 'e1', t0: T0, exact: true, until: at(60) });
    expect(tl.entries[0]?.text).toBe('Risposte a «Una parola?»: fiducia (3)');
  });

  it('le domande in chat: il testo decifrato, mai chi le ha scritte', async () => {
    m('chatMessage').mockResolvedValueOnce([
      { text: 'cifrato:Ci sara’ la registrazione?', createdAt: at(30) },
      { text: 'illeggibile', createdAt: at(31) },
    ]);
    const tl = await buildLiveTimeline({ eventId: 'e1', t0: T0, exact: true, until: at(60) });
    expect(tl.entries[0]).toEqual({
      offsetSec: 1800,
      kind: 'chat.question',
      text: 'Domanda in chat: «Ci sara’ la registrazione?»',
    });
    const dove = m('chatMessage').mock.calls[0]?.[0] as { select: Record<string, boolean> };
    expect(Object.keys(dove.select)).toEqual(['text', 'createdAt']);
  });

  it('i capitoli: l’agenda si legge dall’inizio dell’evento, fino alla fine della registrazione', async () => {
    // L'argomento in corso allo zero e' stato avviato 45 minuti prima: fuori
    // dalla finestra delle azioni, ma apre la registrazione.
    m('liveAction').mockImplementation(async (args: { where: { kind?: unknown } }) =>
      args.where.kind === 'agenda.topic'
        ? [
            { at: at(-45), kind: 'agenda.topic', data: { itemId: 'a', label: 'Saluti', status: 'CURRENT' } },
            { at: at(20), kind: 'agenda.topic', data: { itemId: 'b', label: 'Il servizio', status: 'CURRENT' } },
          ]
        : [],
    );
    const tl = await buildLiveTimeline({ eventId: 'e1', t0: T0, exact: true, until: at(60) });
    expect(tl.chapters).toEqual([
      { offsetSec: 0, title: 'Saluti' },
      { offsetSec: 1200, title: 'Il servizio' },
    ]);
    const agenda = m('liveAction').mock.calls
      .map((c) => c[0] as { where: Record<string, unknown>; take?: number })
      .find((a) => a.where.kind === 'agenda.topic');
    // Nessun limite inferiore: solo la fine della registrazione.
    expect(agenda?.where).toEqual({ eventId: 'e1', kind: 'agenda.topic', at: { lte: at(60) } });
    expect(agenda?.take).toBeGreaterThan(0);
  });

  it('un argomento avviato dopo la fine della registrazione non e’ un suo capitolo', async () => {
    m('liveAction').mockImplementation(async (args: { where: { kind?: unknown } }) =>
      args.where.kind === 'agenda.topic'
        ? [
            { at: at(5), kind: 'agenda.topic', data: { itemId: 'a', label: 'Uno', status: 'CURRENT' } },
            { at: at(60), kind: 'agenda.topic', data: { itemId: 'b', label: 'Due', status: 'CURRENT' } },
          ]
        : [],
    );
    const tl = await buildLiveTimeline({ eventId: 'e1', t0: T0, exact: true, until: at(60) });
    expect(tl.chapters).toEqual([{ offsetSec: 300, title: 'Uno' }]);
  });

  it('troppe voci: via per prime le minori, le azioni restano', async () => {
    m('liveAction').mockResolvedValue([
      { at: at(5), kind: 'agenda.topic', data: { label: 'Uno', status: 'CURRENT' } },
    ]);
    m('chatMessage').mockResolvedValueOnce(
      Array.from({ length: 450 }, (_, i) => ({ text: `cifrato:Domanda ${i}`, createdAt: at(0, i) })),
    );
    const tl = await buildLiveTimeline({ eventId: 'e1', t0: T0, exact: true, until: at(60) });
    expect(tl.entries).toHaveLength(250);
    expect(tl.entries.some((e) => e.kind === 'agenda.topic')).toBe(true);
  });
});

describe('recordingTimeZero', () => {
  const creata = new Date('2026-10-08T11:00:00Z');

  it('l’inizio del media, quando il registratore lo manda, e’ esatto', () => {
    expect(
      recordingTimeZero({ mediaStartedAt: T0, createdAt: creata, durationSec: 3600, multitrack: true }),
    ).toEqual({ t0: T0, exact: true });
  });

  it('multitraccia senza: la creazione, approssimata', () => {
    expect(
      recordingTimeZero({ mediaStartedAt: null, createdAt: creata, durationSec: 3600, multitrack: true }),
    ).toEqual({ t0: creata, exact: false });
  });

  it('composita con l’avvio riferito dalla sala: quello, esatto', () => {
    expect(
      recordingTimeZero({
        mediaStartedAt: null,
        createdAt: creata,
        durationSec: 3600,
        multitrack: false,
        journaledStart: T0,
      }),
    ).toEqual({ t0: T0, exact: true });
  });

  it('composita: la creazione meno la durata, approssimata', () => {
    expect(
      recordingTimeZero({ mediaStartedAt: null, createdAt: creata, durationSec: 3600, multitrack: false }),
    ).toEqual({ t0: T0, exact: false });
  });
});

describe('chaptersFromActions', () => {
  const t0 = new Date('2026-10-08T09:00:00Z');
  const at = (min: number) => new Date(t0.getTime() + min * 60_000);
  const avvio = (min: number, itemId: string, label: string, status = 'CURRENT') => ({
    at: at(min),
    kind: 'agenda.topic',
    data: { itemId, label, status },
  });

  it('gli argomenti avviati, in ordine, con i secondi dallo zero', () => {
    expect(
      chaptersFromActions(
        [
          avvio(12, 'b', 'Secondo punto'),
          avvio(1, 'a', 'Primo punto'),
          avvio(11, 'a', 'Primo punto', 'DONE'),
          { at: at(5), kind: 'poll.opened', data: {} },
        ],
        t0,
      ),
    ).toEqual([
      { offsetSec: 60, title: 'Primo punto' },
      { offsetSec: 720, title: 'Secondo punto' },
    ]);
  });

  it("prima dello zero conta l'ultimo avviato, che apre la registrazione; i doppioni consecutivi sono uno", () => {
    expect(
      chaptersFromActions(
        [avvio(-20, 'a', 'Saluti'), avvio(-5, 'b', 'Contesto'), avvio(3, 'b', 'Contesto'), avvio(30, 'a', 'Saluti')],
        t0,
      ),
    ).toEqual([
      { offsetSec: 0, title: 'Contesto' },
      { offsetSec: 1800, title: 'Saluti' },
    ]);
  });

  it('un argomento avviato e poi chiuso prima dello zero non apre la registrazione', () => {
    for (const chiuso of ['DONE', 'SKIPPED', 'PENDING']) {
      expect(
        chaptersFromActions([avvio(-20, 'a', 'Saluti'), avvio(-10, 'a', 'Saluti', chiuso), avvio(5, 'b', 'Contesto')], t0),
      ).toEqual([{ offsetSec: 300, title: 'Contesto' }]);
    }
    // Chiuderne un altro non tocca quello in corso.
    expect(
      chaptersFromActions([avvio(-20, 'a', 'Saluti'), avvio(-10, 'b', 'Contesto', 'DONE'), avvio(5, 'b', 'Contesto')], t0),
    ).toEqual([
      { offsetSec: 0, title: 'Saluti' },
      { offsetSec: 300, title: 'Contesto' },
    ]);
    // Concluso dopo lo zero: era in corso quando la registrazione e' partita.
    expect(chaptersFromActions([avvio(-20, 'a', 'Saluti'), avvio(10, 'a', 'Saluti', 'DONE')], t0)).toEqual([
      { offsetSec: 0, title: 'Saluti' },
    ]);
  });

  it('con la fine della registrazione: i capitoli avviati da li’ in poi si scartano', () => {
    const fine = at(30);
    expect(
      chaptersFromActions(
        [avvio(-5, 'a', 'Saluti'), avvio(10, 'b', 'Contesto'), avvio(30, 'c', 'Domande'), avvio(40, 'd', 'Chiusura')],
        t0,
        fine,
      ),
    ).toEqual([
      { offsetSec: 0, title: 'Saluti' },
      { offsetSec: 600, title: 'Contesto' },
    ]);
  });

  it('senza agenda: nessun capitolo', () => {
    expect(chaptersFromActions([{ at: at(1), kind: 'poll.opened', data: {} }], t0)).toEqual([]);
  });
});

/**
 * Le valutazioni di un evento per la sua pagina in amministrazione.
 *
 * - Per domanda: la media e la distribuzione (scala, si'/no, scelte), e
 *   quante risposte l'hanno toccata; un commento fatto di soli spazi non conta.
 * - Le risposte dalla piu' recente, distinte tra iscrizione e ospite, e mai con
 *   il nome o l'hash dell'email di chi ha risposto.
 * - Le valutazioni a stelle raccolte prima dei questionari, riassunte a parte.
 * - Il CSV, separato da «;»: intestazione con le domande nella lingua
 *   chiesta, una riga per risposta, si'/no come parole, e nessuna cella che un
 *   foglio di calcolo legga come formula.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    questionnaireResponse: { findMany: vi.fn() },
    eventFeedback: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/questionnaires', () => ({
  findEventQuestionnaireByPlacement: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { findEventQuestionnaireByPlacement, type RenderedItem } from '@/lib/questionnaires';

import {
  buildEventFeedbackReport,
  feedbackReportCsv,
  type EventFeedbackReport,
  type FeedbackItemStats,
} from './event-feedback-report';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedRisposte = prisma.questionnaireResponse.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedVecchie = prisma.eventFeedback.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedQuestionario = vi.mocked(findEventQuestionnaireByPlacement);

const EVENT_ID = '22222222-2222-4222-8222-222222222222';

function item(over: Partial<RenderedItem> & Pick<RenderedItem, 'id' | 'type'>): RenderedItem {
  return {
    prompt: { it: `Domanda ${over.id}` },
    options: null,
    scaleMin: null,
    scaleMax: null,
    scaleMinLabel: null,
    scaleMaxLabel: null,
    required: false,
    source: 'template',
    templateId: 'tpl-1',
    ...over,
  };
}

const ITEMS: RenderedItem[] = [
  item({
    id: 'voto',
    type: 'LIKERT',
    prompt: { it: 'Voto complessivo', en: 'Overall rating' },
    scaleMin: 1,
    scaleMax: 5,
    scaleMinLabel: { it: 'Pessimo' },
    scaleMaxLabel: { it: 'Ottimo' },
  }),
  item({ id: 'consiglio', type: 'YES_NO', prompt: { it: 'Lo consiglieresti?' } }),
  item({ id: 'modo', type: 'SINGLE_CHOICE', options: [{ it: 'In sala' }, { it: 'Online' }] }),
  item({
    id: 'utile',
    type: 'MULTI_CHOICE',
    options: [{ it: 'Slide' }, { it: 'Video' }, { it: 'Domande' }],
  }),
  item({ id: 'commento', type: 'OPEN_TEXT', prompt: { it: 'Commento' } }),
];

function questionario(items: RenderedItem[] = ITEMS) {
  return {
    id: 'q-1',
    eventId: EVENT_ID,
    placement: 'POST_EVENT' as const,
    title: { it: 'Il tuo feedback', en: 'Your feedback' },
    description: {},
    required: false,
    allowEdit: false,
    items,
  };
}

type Risposta = { itemId: string; valueText?: string | null; valueChoices?: unknown; valueScale?: number | null };

function riga(id: string, submittedAt: string, registrationId: string | null, answers: Risposta[]) {
  return {
    id,
    submittedAt: new Date(submittedAt),
    registrationId,
    answers: answers.map((a) => ({
      itemId: a.itemId,
      valueText: a.valueText ?? null,
      valueChoices: a.valueChoices ?? null,
      valueScale: a.valueScale ?? null,
    })),
  };
}

// Il database le restituisce gia' dalla piu' recente (orderBy desc).
const RIGHE = [
  riga('r3', '2026-10-02T10:00:00.000Z', 'reg-1', [
    { itemId: 'voto', valueScale: 5 },
    { itemId: 'consiglio', valueScale: 1 },
    { itemId: 'modo', valueChoices: [1] },
    { itemId: 'utile', valueChoices: [0, 2] },
    { itemId: 'commento', valueText: '  Ottimo evento  ' },
  ]),
  riga('r2', '2026-10-01T10:00:00.000Z', null, [
    { itemId: 'voto', valueScale: 4 },
    { itemId: 'consiglio', valueScale: 0 },
    // Un valore non numerico nelle scelte non conta.
    { itemId: 'utile', valueChoices: [1, 'x'] },
    // Solo spazi: non e' un commento.
    { itemId: 'commento', valueText: '   ' },
  ]),
  riga('r1', '2026-09-30T10:00:00.000Z', null, [
    { itemId: 'voto', valueScale: 4 },
    { itemId: 'consiglio', valueScale: 1 },
    { itemId: 'modo', valueChoices: [0] },
  ]),
];

beforeEach(() => {
  vi.clearAllMocks();
  mockedEvent.mockResolvedValue({ feedbackEnabled: true });
  mockedQuestionario.mockResolvedValue(questionario());
  mockedRisposte.mockResolvedValue(RIGHE);
  mockedVecchie.mockResolvedValue([]);
});

function stats(report: EventFeedbackReport, id: string): FeedbackItemStats {
  const s = report.items.find((i) => i.id === id);
  if (!s) throw new Error(`nessuna domanda ${id}`);
  return s;
}

describe('buildEventFeedbackReport — statistiche per domanda', () => {
  it('scala: media a due decimali e distribuzione dal valore minimo al massimo', async () => {
    const report = await buildEventFeedbackReport(EVENT_ID);
    const voto = stats(report, 'voto');
    expect(voto.average).toBe(4.33);
    expect(voto.distribution).toEqual([0, 0, 0, 2, 1]);
    expect(voto.answered).toBe(3);
    // La pagina mostra le etichette degli estremi: arrivano con la domanda.
    expect(voto).toMatchObject({
      scaleMin: 1,
      scaleMax: 5,
      scaleMinLabel: { it: 'Pessimo' },
      scaleMaxLabel: { it: 'Ottimo' },
      prompt: { it: 'Voto complessivo', en: 'Overall rating' },
    });
  });

  it('si’/no: la media e’ la quota di si’, la distribuzione e’ [no, si’]', async () => {
    const report = await buildEventFeedbackReport(EVENT_ID);
    const consiglio = stats(report, 'consiglio');
    expect(consiglio.average).toBe(0.67);
    expect(consiglio.distribution).toEqual([1, 2]);
    expect(consiglio.answered).toBe(3);
  });

  it('scelte: un conteggio per opzione, senza media', async () => {
    const report = await buildEventFeedbackReport(EVENT_ID);
    expect(stats(report, 'modo')).toMatchObject({ average: null, distribution: [1, 1], answered: 2 });
    expect(stats(report, 'utile')).toMatchObject({
      average: null,
      distribution: [1, 1, 1],
      answered: 2,
    });
  });

  it('testo libero: niente media ne’ distribuzione; i soli spazi non contano come risposta', async () => {
    const report = await buildEventFeedbackReport(EVENT_ID);
    expect(stats(report, 'commento')).toMatchObject({
      average: null,
      distribution: null,
      answered: 1,
    });
  });

  it('una scala senza estremi dichiarati vale 1–5; una 0–10 conta anche lo zero', async () => {
    mockedQuestionario.mockResolvedValue(
      questionario([
        item({ id: 'predefinita', type: 'LIKERT' }),
        item({ id: 'nps', type: 'LIKERT', scaleMin: 0, scaleMax: 10 }),
      ]),
    );
    mockedRisposte.mockResolvedValue([
      riga('a', '2026-10-02T10:00:00.000Z', null, [
        { itemId: 'predefinita', valueScale: 2 },
        { itemId: 'nps', valueScale: 0 },
      ]),
      riga('b', '2026-10-01T10:00:00.000Z', null, [{ itemId: 'nps', valueScale: 10 }]),
    ]);

    const report = await buildEventFeedbackReport(EVENT_ID);
    expect(stats(report, 'predefinita').distribution).toEqual([0, 1, 0, 0, 0]);
    expect(stats(report, 'predefinita').average).toBe(2);
    const nps = stats(report, 'nps');
    expect(nps.distribution).toHaveLength(11);
    expect(nps.distribution![0]).toBe(1);
    expect(nps.distribution![10]).toBe(1);
    expect(nps.average).toBe(5);
  });

  it('una domanda senza risposte: media nulla, distribuzione a zero', async () => {
    mockedRisposte.mockResolvedValue([]);
    const report = await buildEventFeedbackReport(EVENT_ID);
    expect(stats(report, 'voto')).toMatchObject({
      average: null,
      distribution: [0, 0, 0, 0, 0],
      answered: 0,
    });
    expect(stats(report, 'consiglio')).toMatchObject({ average: null, distribution: [0, 0] });
  });
});

describe('buildEventFeedbackReport — le risposte', () => {
  it('dalla piu’ recente, distinte tra iscrizione e ospite, con i valori ripuliti', async () => {
    const report = await buildEventFeedbackReport(EVENT_ID);

    expect(report.responses.map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
    expect(report.responses.map((r) => r.kind)).toEqual(['registration', 'guest', 'guest']);
    expect(report.responses[0]).toEqual({
      id: 'r3',
      submittedAt: '2026-10-02T10:00:00.000Z',
      kind: 'registration',
      answers: {
        voto: { scale: 5 },
        consiglio: { scale: 1 },
        modo: { choices: [1] },
        utile: { choices: [0, 2] },
        commento: { text: 'Ottimo evento' },
      },
    });
    expect(report.responses[1]!.answers.utile).toEqual({ choices: [1] });
    expect(report.responses[1]!.answers.commento).toEqual({});
    // Il no (0) resta un valore, non un'assenza.
    expect(report.responses[1]!.answers.consiglio).toEqual({ scale: 0 });
  });

  it('chiede al database le risposte del questionario dalla piu’ recente, senza nome ne’ email', async () => {
    await buildEventFeedbackReport(EVENT_ID);

    expect(mockedQuestionario).toHaveBeenCalledWith(EVENT_ID, 'POST_EVENT');
    const args = mockedRisposte.mock.calls[0]![0];
    expect(args.where).toEqual({ questionnaireId: 'q-1' });
    expect(args.orderBy).toEqual({ submittedAt: 'desc' });
    expect(Object.keys(args.select)).not.toContain('respondentName');
    expect(Object.keys(args.select)).not.toContain('respondentEmailHash');
    expect(Object.keys(args.select)).not.toContain('guestId');
  });

  it('il titolo del questionario e lo stato della raccolta', async () => {
    mockedEvent.mockResolvedValue({ feedbackEnabled: false });
    const report = await buildEventFeedbackReport(EVENT_ID);
    expect(report.enabled).toBe(false);
    expect(report.questionnaire).toEqual({ id: 'q-1', title: { it: 'Il tuo feedback', en: 'Your feedback' } });
  });
});

describe('buildEventFeedbackReport — senza questionario', () => {
  it('nessuna domanda, nessuna risposta, e nessuna lettura delle risposte', async () => {
    mockedQuestionario.mockResolvedValue(null);

    const report = await buildEventFeedbackReport(EVENT_ID);
    expect(report.questionnaire).toBeNull();
    expect(report.items).toEqual([]);
    expect(report.responses).toEqual([]);
    expect(report.enabled).toBe(true);
    expect(mockedRisposte).not.toHaveBeenCalled();
  });

  it('un evento che non esiste: raccolta spenta', async () => {
    mockedEvent.mockResolvedValue(null);
    mockedQuestionario.mockResolvedValue(null);
    const report = await buildEventFeedbackReport(EVENT_ID);
    expect(report.enabled).toBe(false);
  });
});

describe('buildEventFeedbackReport — le valutazioni a stelle precedenti', () => {
  it('conteggio, media e commenti ripuliti', async () => {
    mockedVecchie.mockResolvedValue([
      { rating: 5, comment: '  Bello  ', createdAt: new Date('2026-06-12T10:00:00.000Z') },
      { rating: 2, comment: '   ', createdAt: new Date('2026-06-12T09:00:00.000Z') },
      { rating: 4, comment: null, createdAt: new Date('2026-06-12T08:00:00.000Z') },
    ]);

    const report = await buildEventFeedbackReport(EVENT_ID);
    expect(mockedVecchie).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: EVENT_ID }, orderBy: { createdAt: 'desc' } }),
    );
    expect(report.legacy).toEqual({
      count: 3,
      average: 3.67,
      entries: [
        { rating: 5, comment: 'Bello', createdAt: '2026-06-12T10:00:00.000Z' },
        { rating: 2, comment: null, createdAt: '2026-06-12T09:00:00.000Z' },
        { rating: 4, comment: null, createdAt: '2026-06-12T08:00:00.000Z' },
      ],
    });
  });

  it('nessuna: conteggio zero e media nulla', async () => {
    const report = await buildEventFeedbackReport(EVENT_ID);
    expect(report.legacy).toEqual({ count: 0, average: null, entries: [] });
  });
});

// ─── CSV ─────────────────────────────────────────────────────────────

function statistica(over: Partial<FeedbackItemStats> & Pick<FeedbackItemStats, 'id' | 'type'>): FeedbackItemStats {
  return {
    prompt: { it: `Domanda ${over.id}` },
    options: null,
    scaleMin: null,
    scaleMax: null,
    scaleMinLabel: null,
    scaleMaxLabel: null,
    answered: 0,
    average: null,
    distribution: null,
    ...over,
  };
}

function report(
  items: FeedbackItemStats[],
  responses: EventFeedbackReport['responses'],
): EventFeedbackReport {
  return {
    enabled: true,
    questionnaire: { id: 'q-1', title: { it: 'Il tuo feedback' } },
    items,
    responses,
    legacy: { count: 0, average: null, entries: [] },
  };
}

const CSV_ITEMS = [
  statistica({ id: 'voto', type: 'LIKERT', prompt: { it: 'Voto complessivo', en: 'Overall rating' } }),
  statistica({
    id: 'utile',
    type: 'MULTI_CHOICE',
    prompt: { it: 'Cosa ti e’ servito?' },
    options: [{ it: 'Slide', en: 'Slides' }, { it: 'Video' }, { it: 'Domande', en: 'Questions' }],
  }),
  statistica({ id: 'commento', type: 'OPEN_TEXT', prompt: { it: 'Commento', en: 'Comment' } }),
];

describe('feedbackReportCsv', () => {
  it('intestazione nella lingua chiesta (ripiego sull’italiano), una riga per risposta, «;» e CRLF', () => {
    const csv = feedbackReportCsv(
      report(CSV_ITEMS, [
        {
          id: 'r2',
          submittedAt: '2026-10-02T10:00:00.000Z',
          kind: 'registration',
          answers: {
            voto: { scale: 5 },
            utile: { choices: [0, 2] },
            commento: { text: 'Tutto chiaro' },
          },
        },
        {
          id: 'r1',
          submittedAt: '2026-10-01T10:00:00.000Z',
          kind: 'guest',
          // Domande saltate: celle vuote, non «undefined».
          answers: { voto: { scale: 3 } },
        },
      ]),
      'en',
    );

    expect(csv).toBe(
      [
        'submitted_at;respondent;Overall rating;Cosa ti e’ servito?;Comment',
        '2026-10-02T10:00:00.000Z;registration;5;Slides | Questions;Tutto chiaro',
        '2026-10-01T10:00:00.000Z;guest;3;;',
      ].join('\r\n') + '\r\n',
    );
  });

  it('una lingua che nessun testo ha: l’italiano, poi il primo disponibile', () => {
    const csv = feedbackReportCsv(
      report([statistica({ id: 'a', type: 'OPEN_TEXT', prompt: { de: 'Kommentar', fr: 'Commentaire' } })], []),
      'sv',
    );
    expect(csv).toBe('submitted_at;respondent;Kommentar\r\n');
  });

  it('nessuna risposta: solo l’intestazione', () => {
    expect(feedbackReportCsv(report(CSV_ITEMS, []), 'it')).toBe(
      'submitted_at;respondent;Voto complessivo;Cosa ti e’ servito?;Commento\r\n',
    );
  });

  it('una cella che inizia con = + - @ non diventa una formula', () => {
    const celle = ['=HYPERLINK("http://x")', '+39 06 1234', '-1', '@SUM(A1)'];
    const csv = feedbackReportCsv(
      report(
        [statistica({ id: 'commento', type: 'OPEN_TEXT', prompt: { it: 'Commento' } })],
        celle.map((text, i) => ({
          id: `r${i}`,
          submittedAt: '2026-10-01T10:00:00.000Z',
          kind: 'guest' as const,
          answers: { commento: { text } },
        })),
      ),
      'it',
    );
    const righe = csv.split('\r\n');
    // Con le virgolette raddoppiate dove il testo ne contiene.
    expect(righe[1]).toBe(`2026-10-01T10:00:00.000Z;guest;"'=HYPERLINK(""http://x"")"`);
    expect(righe[2]).toBe(`2026-10-01T10:00:00.000Z;guest;'+39 06 1234`);
    expect(righe[3]).toBe(`2026-10-01T10:00:00.000Z;guest;'-1`);
    expect(righe[4]).toBe(`2026-10-01T10:00:00.000Z;guest;'@SUM(A1)`);
  });

  it('anche un’intestazione o un’opzione che inizia con = viene neutralizzata', () => {
    const csv = feedbackReportCsv(
      report(
        [
          statistica({
            id: 'scelta',
            type: 'SINGLE_CHOICE',
            prompt: { it: '=1+1' },
            options: [{ it: '=CMD()' }],
          }),
        ],
        [
          {
            id: 'r1',
            submittedAt: '2026-10-01T10:00:00.000Z',
            kind: 'guest',
            answers: { scelta: { choices: [0] } },
          },
        ],
      ),
      'it',
    );
    expect(csv).toBe(`submitted_at;respondent;'=1+1\r\n2026-10-01T10:00:00.000Z;guest;'=CMD()\r\n`);
  });

  it('punti e virgola, virgole, virgolette e a capo: la cella va tra virgolette', () => {
    const testi = ['Uno; due', 'Bene, grazie', 'Disse "ottimo"', 'riga uno\nriga due'];
    const csv = feedbackReportCsv(
      report(
        [statistica({ id: 'commento', type: 'OPEN_TEXT', prompt: { it: 'Commento' } })],
        testi.map((text, i) => ({
          id: `r${i}`,
          submittedAt: '2026-10-01T10:00:00.000Z',
          kind: 'guest' as const,
          answers: { commento: { text } },
        })),
      ),
      'it',
    );
    expect(csv).toBe(
      [
        'submitted_at;respondent;Commento',
        '2026-10-01T10:00:00.000Z;guest;"Uno; due"',
        '2026-10-01T10:00:00.000Z;guest;"Bene, grazie"',
        '2026-10-01T10:00:00.000Z;guest;"Disse ""ottimo"""',
        '2026-10-01T10:00:00.000Z;guest;"riga uno\nriga due"',
      ].join('\r\n') + '\r\n',
    );
  });

  describe('si’/no: una parola, non 1/0', () => {
    const siNo = report(
      [statistica({ id: 'consiglio', type: 'YES_NO', prompt: { it: 'Lo consiglieresti?' } })],
      [
        {
          id: 'r2',
          submittedAt: '2026-10-02T10:00:00.000Z',
          kind: 'guest',
          answers: { consiglio: { scale: 1 } },
        },
        {
          id: 'r1',
          submittedAt: '2026-10-01T10:00:00.000Z',
          kind: 'guest',
          // Il no (0) resta una risposta, non una cella vuota.
          answers: { consiglio: { scale: 0 } },
        },
      ],
    );

    it('con le parole date dal chiamante', () => {
      const righe = feedbackReportCsv(siNo, 'it', { yes: 'Sì', no: 'No' }).split('\r\n');
      expect(righe[1]).toBe('2026-10-02T10:00:00.000Z;guest;Sì');
      expect(righe[2]).toBe('2026-10-01T10:00:00.000Z;guest;No');
    });

    it('senza, in inglese', () => {
      const righe = feedbackReportCsv(siNo, 'it').split('\r\n');
      expect(righe[1]).toBe('2026-10-02T10:00:00.000Z;guest;yes');
      expect(righe[2]).toBe('2026-10-01T10:00:00.000Z;guest;no');
    });

    it('una scala resta un numero', () => {
      const csv = feedbackReportCsv(
        report(
          [statistica({ id: 'voto', type: 'LIKERT', prompt: { it: 'Voto' } })],
          [{ id: 'r1', submittedAt: '2026-10-01T10:00:00.000Z', kind: 'guest', answers: { voto: { scale: 1 } } }],
        ),
        'it',
        { yes: 'Sì', no: 'No' },
      );
      expect(csv.split('\r\n')[1]).toBe('2026-10-01T10:00:00.000Z;guest;1');
    });
  });
});

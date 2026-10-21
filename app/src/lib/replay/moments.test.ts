import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, slides } = vi.hoisted(() => ({
  db: {
    liveAction: { findMany: vi.fn() },
    wordCloudSubmission: { findMany: vi.fn() },
  },
  slides: { recordingOfEventVideo: vi.fn(), tempiDelVideo: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/presentation/recording-slides-data', () => slides);
vi.mock('@/lib/cache', () => ({ getCached: () => null, setCache: vi.fn() }));

import { replayMoments, type ReplaySources } from './moments';

const T0 = new Date('2026-10-21T09:00:40Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
const EVENTO = {
  id: 'ev-1',
  recordingUrl: 'https://storage.example.net/recordings/sala.mp4',
};
const fonti = (over: Partial<ReplaySources> = {}): ReplaySources => ({
  questions: [],
  polls: [],
  materials: [],
  showWordCloud: true,
  ...over,
});

/** Le due letture del registro: l'agenda e il resto. */
function registro(agenda: unknown[], altre: unknown[]) {
  db.liveAction.findMany.mockImplementation(
    async ({ where }: { where: { kind: unknown } }) =>
      where.kind === 'agenda.topic' ? agenda : altre
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  slides.recordingOfEventVideo.mockResolvedValue({
    id: 'rec-1',
    blobKey: 'recordings/evt-1_2026-10-21.mp4',
    slidesOffsetSec: 0,
    slidesEnabled: true,
    createdAt: at(3700),
    callSession: { endedAt: at(3700) },
  });
  slides.tempiDelVideo.mockResolvedValue({ t0: T0, exact: true, durationSec: 3600 });
  registro([], []);
  db.wordCloudSubmission.findMany.mockResolvedValue([]);
});

describe('replayMoments', () => {
  it('mette argomenti, presentazioni, sondaggi, domande e parole sul tempo del video, in ordine', async () => {
    registro(
      [
        {
          at: at(60),
          kind: 'agenda.topic',
          data: { itemId: 'a1', label: 'Benvenuto', status: 'CURRENT' },
        },
      ],
      [
        {
          at: at(300),
          kind: 'presentation.started',
          data: { materialId: 'm1', title: 'Slide.pdf' },
        },
        { at: at(900), kind: 'poll.published', data: { pollId: 'p1' } },
        {
          at: at(1200),
          kind: 'wordcloud.closed',
          data: {
            roundId: 'r1',
            prompt: 'Una parola',
            words: [{ word: 'aperto', count: 5 }],
          },
        },
      ]
    );
    const momenti = await replayMoments(
      EVENTO,
      fonti({
        materials: [{ id: 'm1', title: 'Slide.pdf' }],
        polls: [
          {
            id: 'p1',
            question: 'Lo useresti?',
            options: ['Si', 'No'],
            voteCounts: [8, 2],
            totalVotes: 10,
          },
        ],
        questions: [
          {
            id: 'q101',
            text: 'Funziona su k3s?',
            answerText: 'Si',
            answeredAt: at(1500),
            highlightedAt: null,
          },
        ],
      })
    );
    expect(momenti?.map((m) => [m.kind, m.offsetSec])).toEqual([
      ['topic', 60],
      ['presentation', 300],
      ['poll', 900],
      ['wordcloud', 1200],
      ['question', 1500],
    ]);
    // I voti sono quelli della scheda dei sondaggi, non la fotografia del registro.
    expect(momenti?.[2]).toMatchObject({
      results: [
        { option: 'Si', count: 8 },
        { option: 'No', count: 2 },
      ],
      totalVotes: 10,
    });
    expect(momenti?.[4]).toEqual({
      kind: 'question',
      offsetSec: 1500,
      question: 'Funziona su k3s?',
      answer: 'Si',
    });
  });

  it("solo cio' che la pagina mostra: materiali visibili, slide accese, sondaggi della scheda", async () => {
    registro(
      [],
      [
        {
          at: at(100),
          kind: 'presentation.started',
          data: { materialId: 'nascosto', title: 'Solo in sala.pdf' },
        },
        { at: at(200), kind: 'poll.published', data: { pollId: 'ritirato' } },
        {
          at: at(300),
          kind: 'presentation.started',
          data: { materialId: 'm1', title: 'Slide.pdf' },
        },
      ]
    );
    expect(
      await replayMoments(
        EVENTO,
        fonti({ materials: [{ id: 'm1', title: 'Slide.pdf' }] })
      )
    ).toEqual([{ kind: 'presentation', offsetSec: 300, title: 'Slide.pdf' }]);
    slides.recordingOfEventVideo.mockResolvedValue({
      id: 'rec-1',
      blobKey: 'recordings/evt-1_2026-10-21.mp4',
      slidesOffsetSec: 0,
      slidesEnabled: false,
      createdAt: at(3700),
      callSession: { endedAt: at(3700) },
    });
    expect(
      await replayMoments(
        EVENTO,
        fonti({ materials: [{ id: 'm1', title: 'Slide.pdf' }] })
      )
    ).toEqual([]);
  });

  it("un sondaggio ripubblicato compare una volta sola, all'ultima pubblicazione", async () => {
    registro(
      [],
      [
        { at: at(100), kind: 'poll.published', data: { pollId: 'p1' } },
        { at: at(400), kind: 'poll.published', data: { pollId: 'p1' } },
      ]
    );
    const momenti = await replayMoments(
      EVENTO,
      fonti({
        polls: [
          { id: 'p1', question: 'Q', options: ['A'], voteCounts: [1], totalVotes: 1 },
        ],
      })
    );
    expect(momenti?.map((m) => [m.kind, m.offsetSec])).toEqual([['poll', 400]]);
  });

  it('le parole tolte dal moderatore dopo la chiusura non compaiono', async () => {
    registro(
      [],
      [
        {
          at: at(100),
          kind: 'wordcloud.closed',
          data: {
            roundId: 'r1',
            prompt: 'P',
            words: [
              { word: 'ok', count: 3 },
              { word: 'Brutta', count: 2 },
            ],
          },
        },
      ]
    );
    db.wordCloudSubmission.findMany.mockResolvedValue([
      { roundId: 'r1', word: 'brutta' },
    ]);
    const momenti = await replayMoments(EVENTO, fonti());
    expect(momenti?.[0]).toMatchObject({
      kind: 'wordcloud',
      words: [{ word: 'ok', count: 3 }],
    });
  });

  it("l'argomento avviato molto prima della registrazione apre il video a zero", async () => {
    registro(
      [
        {
          at: at(-45 * 60),
          kind: 'agenda.topic',
          data: { itemId: 'a1', label: 'Accoglienza', status: 'CURRENT' },
        },
      ],
      []
    );
    expect(await replayMoments(EVENTO, fonti())).toEqual([
      { kind: 'topic', offsetSec: 0, title: 'Accoglienza' },
    ]);
  });

  it('fuori dal video non entra, anche senza durata; senza registrazione della sala, null', async () => {
    slides.tempiDelVideo.mockResolvedValue({ t0: T0, exact: true, durationSec: null });
    const momenti = await replayMoments(
      EVENTO,
      fonti({
        questions: [
          {
            id: 'q1',
            text: 'Prima',
            answerText: null,
            answeredAt: at(-30),
            highlightedAt: null,
          },
          {
            id: 'q102',
            text: 'Dopo la diretta',
            answerText: null,
            answeredAt: at(5 * 3600),
            highlightedAt: null,
          },
          {
            id: 'q103',
            text: 'Rimessa in attesa',
            answerText: 'Si',
            answeredAt: null,
            highlightedAt: null,
          },
        ],
      })
    );
    expect(momenti).toEqual([]);
    slides.recordingOfEventVideo.mockResolvedValue(null);
    expect(await replayMoments(EVENTO, fonti())).toBeNull();
  });

  it("una domanda parte da quando e' stata messa in evidenza; un materiale col titolo di adesso", async () => {
    registro(
      [],
      [
        {
          at: at(600),
          kind: 'question.status',
          data: { questionId: 'qx', status: 'HIGHLIGHTED' },
        },
        {
          at: at(700),
          kind: 'presentation.started',
          data: { materialId: 'm1', title: 'Vecchio titolo.pdf' },
        },
      ]
    );
    const momenti = await replayMoments(
      EVENTO,
      fonti({
        materials: [{ id: 'm1', title: 'Titolo nuovo.pdf' }],
        questions: [
          {
            id: 'qx',
            text: 'Domanda',
            answerText: null,
            answeredAt: at(1100),
            highlightedAt: null,
          },
        ],
      })
    );
    expect(momenti).toEqual([
      { kind: 'question', offsetSec: 600, question: 'Domanda', answer: null },
      { kind: 'presentation', offsetSec: 700, title: 'Titolo nuovo.pdf' },
    ]);
  });
});

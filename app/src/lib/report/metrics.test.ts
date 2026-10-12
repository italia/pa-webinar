import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  question: { count: vi.fn() },
  chatMessage: { count: vi.fn() },
  eventAgendaItem: { findMany: vi.fn(async () => []) },
  agendaItemReaction: { groupBy: vi.fn(async () => []) },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
const statisticheEvento = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics/event-stats', () => ({ statisticheEvento }));
vi.mock('@/lib/feedback/event-feedback-report', () => ({ buildEventFeedbackReport: vi.fn() }));

import type { StatisticheEvento } from '@/lib/analytics/event-stats';

import { componiMetriche, metricheResoconto } from './metrics';

const statistiche = {
  durationSec: 3600,
  attendance: {
    registered: 40,
    joined: 25,
    conversionPct: 63,
    peakParticipants: 22,
    avgDwellSec: 2400,
    retentionPct: 67,
  },
  chat: { total: 30, byModerator: 10, byAudience: 20 },
  interactions: { total: 50, distinctInteractors: 15 },
  handRaises: { total: 2 },
  reactions: { total: 12 },
  qa: { topQuestions: [{ text: 'Quando?', upvotes: 3 }] },
  polls: [
    {
      question: 'Utile?',
      options: [
        { text: 'Sì', votes: 9 },
        { text: 'No', votes: 1 },
      ],
      totalVotes: 10,
    },
  ],
  topWords: [
    { word: 'chiaro', count: 4 },
    { word: 'utile', count: 2 },
  ],
  feedback: { average: 4.4, count: 5 },
  timeline: {
    bucketSec: 300,
    peakIndex: 1,
    buckets: [
      {
        startOffsetSec: 0,
        label: '0m',
        chat: 1,
        question: 1,
        upvote: 2,
        poll: 0,
        word: 0,
        reaction: 1,
        total: 5,
      },
      {
        startOffsetSec: 300,
        label: '5m',
        chat: 5,
        question: 0,
        upvote: 0,
        poll: 9,
        word: 4,
        reaction: 2,
        total: 20,
      },
    ],
  },
  attention: { score: 71 },
} as unknown as StatisticheEvento;

describe('componiMetriche', () => {
  it("ricava i numeri del resoconto dalle statistiche, dall'agenda e dalle valutazioni", () => {
    const m = componiMetriche(
      statistiche,
      [
        {
          label: 'Apertura',
          status: 'DONE',
          plannedMinutes: 10,
          startedAt: new Date('2026-10-20T10:00:00Z'),
          completedAt: new Date('2026-10-20T10:12:00Z'),
          agree: 7,
          disagree: 1,
        },
      ],
      {
        items: [
          {
            id: 'a',
            type: 'LIKERT',
            prompt: { it: 'Utilità', en: 'Usefulness' },
            average: 4.4,
            distribution: [0, 0, 1, 1, 3],
            answered: 5,
            scaleMin: 1,
            scaleMax: 5,
          },
          {
            id: 'b',
            type: 'OPEN_TEXT',
            prompt: { it: 'Commenti' },
            average: null,
            distribution: null,
            answered: 3,
            scaleMin: null,
            scaleMax: null,
          },
        ],
        responses: [{}, {}, {}, {}],
        legacy: { count: 1, average: 5, entries: [] },
      } as never,
      { total: 6, answered: 4, inChat: 2 },
      'en'
    );
    expect(m.attendance).toMatchObject({
      registered: 40,
      joined: 25,
      peak: 22,
      conversionPct: 63,
    });
    expect(m.participation).toMatchObject({
      interactions: 50,
      activePeople: 15,
      activePct: 60,
      chatMessages: 18,
      questions: 6,
      pollVotes: 10,
      words: 6,
      reactions: 12,
      handRaises: 2,
      attention: 71,
    });
    // Le domande e i pollici in su stanno insieme nell'andamento.
    expect(m.timeline.buckets[0]).toMatchObject({ offsetSec: 0, questions: 3, total: 5 });
    expect(m.agenda[0]).toMatchObject({
      label: 'Apertura',
      actualMinutes: 12,
      agree: 7,
      disagree: 1,
    });
    expect(m.questions).toEqual({
      total: 6,
      answered: 4,
      top: [{ text: 'Quando?', upvotes: 3 }],
    });
    expect(m.feedback.responses).toBe(5);
    expect(m.feedback.items).toEqual([
      {
        prompt: 'Usefulness',
        average: 4.4,
        scaleMin: 1,
        scaleMax: 5,
        distribution: [0, 0, 1, 1, 3],
        answered: 5,
      },
    ]);
  });
});

describe('metricheResoconto', () => {
  it('conta le domande fatte in chat insieme a quelle del Q&A', async () => {
    statisticheEvento.mockResolvedValue(statistiche);
    db.question.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    // 15 domande in chat, 9 con risposta, 18 contando anche le 3 scartate.
    db.chatMessage.count.mockResolvedValueOnce(15).mockResolvedValueOnce(9).mockResolvedValueOnce(18);
    const valutazioni = { items: [], responses: 0, legacy: { count: 0, average: null, comments: [] } };
    const m = await metricheResoconto('ev-1', 'it', valutazioni as never);
    expect(m!.questions).toMatchObject({ total: 17, answered: 10 });
    // Le domande in chat, scartate comprese, non si contano anche come messaggi.
    expect(m!.participation.chatMessages).toBe(statistiche.chat.byAudience - 18);
    const inChat = {
      eventId: 'ev-1',
      isQuestion: true,
      hiddenAt: null,
      dismissedAt: null,
      isModerator: false,
    };
    expect(db.question.count).toHaveBeenCalledWith({ where: { eventId: 'ev-1', status: { not: 'DISMISSED' } } });
    expect(db.chatMessage.count).toHaveBeenCalledWith({ where: inChat });
    expect(db.chatMessage.count).toHaveBeenCalledWith({ where: { ...inChat, answeredAt: { not: null } } });
  });
});

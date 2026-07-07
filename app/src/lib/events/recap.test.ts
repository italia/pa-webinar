import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    registration: { count: vi.fn() },
    question: { findMany: vi.fn() },
    poll: { findMany: vi.fn() },
    wordCloudSubmission: { groupBy: vi.fn() },
    eventFeedback: { aggregate: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';

import { buildRecap, isRecapEmpty, type EventRecap } from './recap';

const mocked = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn> };
  registration: { count: ReturnType<typeof vi.fn> };
  question: { findMany: ReturnType<typeof vi.fn> };
  poll: { findMany: ReturnType<typeof vi.fn> };
  wordCloudSubmission: { groupBy: ReturnType<typeof vi.fn> };
  eventFeedback: { aggregate: ReturnType<typeof vi.fn> };
};

describe('buildRecap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.event.findUnique.mockResolvedValue({ peakParticipants: 42 });
    mocked.registration.count.mockResolvedValue(100);
    mocked.question.findMany.mockResolvedValue([
      { text: 'Come funziona?', upvoteCount: 7 },
      { text: 'Quando esce la registrazione?', upvoteCount: 3 },
    ]);
    mocked.poll.findMany.mockResolvedValue([
      {
        question: 'Ti è piaciuto?',
        options: ['Sì', 'No', 'Forse'],
        votes: [{ optionIndex: 0 }, { optionIndex: 0 }, { optionIndex: 2 }],
      },
    ]);
    mocked.wordCloudSubmission.groupBy.mockResolvedValue([
      { word: 'digitale', _count: { word: 9 } },
      { word: 'pa', _count: { word: 4 } },
    ]);
    mocked.eventFeedback.aggregate.mockResolvedValue({ _avg: { rating: 4.5 }, _count: 20 });
  });

  it('aggrega headcount, registrazioni, domande, parole e feedback', async () => {
    const recap = await buildRecap('evt1');
    expect(recap.headcount).toBe(42);
    expect(recap.registrations).toBe(100);
    expect(recap.topQuestions).toEqual([
      { text: 'Come funziona?', upvotes: 7 },
      { text: 'Quando esce la registrazione?', upvotes: 3 },
    ]);
    expect(recap.topWords).toEqual([
      { word: 'digitale', count: 9 },
      { word: 'pa', count: 4 },
    ]);
    expect(recap.feedback).toEqual({ average: 4.5, count: 20 });
  });

  it('conta i voti per opzione a partire da optionIndex', async () => {
    const recap = await buildRecap('evt1');
    expect(recap.polls).toEqual([
      {
        question: 'Ti è piaciuto?',
        options: [
          { text: 'Sì', votes: 2 },
          { text: 'No', votes: 0 },
          { text: 'Forse', votes: 1 },
        ],
        totalVotes: 3,
      },
    ]);
  });

  it('non espone il nome autore: le domande hanno solo testo + voti', async () => {
    const recap = await buildRecap('evt1');
    for (const q of recap.topQuestions) {
      expect(Object.keys(q).sort()).toEqual(['text', 'upvotes']);
    }
  });

  it('ignora optionIndex fuori range senza crashare', async () => {
    mocked.poll.findMany.mockResolvedValue([
      { question: 'Q', options: ['A', 'B'], votes: [{ optionIndex: 5 }, { optionIndex: 0 }] },
    ]);
    const recap = await buildRecap('evt1');
    expect(recap.polls[0]?.options).toEqual([
      { text: 'A', votes: 1 },
      { text: 'B', votes: 0 },
    ]);
    expect(recap.polls[0]?.totalVotes).toBe(2);
  });

  it('feedback null quando non ci sono risposte', async () => {
    mocked.eventFeedback.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: 0 });
    const recap = await buildRecap('evt1');
    expect(recap.feedback).toEqual({ average: null, count: 0 });
  });
});

describe('isRecapEmpty', () => {
  const empty: EventRecap = {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    headcount: 0,
    registrations: 0,
    topQuestions: [],
    polls: [],
    topWords: [],
    feedback: { average: null, count: 0 },
  };

  it('true quando ogni sezione è vuota', () => {
    expect(isRecapEmpty(empty)).toBe(true);
  });

  it('false con almeno un dato presente', () => {
    expect(isRecapEmpty({ ...empty, headcount: 5 })).toBe(false);
    expect(isRecapEmpty({ ...empty, topQuestions: [{ text: 'x', upvotes: 1 }] })).toBe(false);
    expect(isRecapEmpty({ ...empty, feedback: { average: 4, count: 2 } })).toBe(false);
  });
});

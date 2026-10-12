import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    registration: { count: vi.fn() },
    question: { findMany: vi.fn() },
    poll: { findMany: vi.fn() },
    wordCloudSubmission: { findMany: vi.fn() },
    eventFeedback: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
    chatMessage: { findMany: vi.fn() },
    questionnaireAnswer: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
  },
}));

import { prisma } from '@/lib/db';

import { buildRecap, ensureEventRecap, isRecapEmpty, formatRecapSummary, type EventRecap } from './recap';

const mocked = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  registration: { count: ReturnType<typeof vi.fn> };
  question: { findMany: ReturnType<typeof vi.fn> };
  poll: { findMany: ReturnType<typeof vi.fn> };
  wordCloudSubmission: { findMany: ReturnType<typeof vi.fn> };
  eventFeedback: { findMany: ReturnType<typeof vi.fn> };
  chatMessage: { findMany: ReturnType<typeof vi.fn> };
  questionnaireAnswer: { findMany: ReturnType<typeof vi.fn> };
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
    // Come nella nuvola: persone, non invii, sulla forma normalizzata.
    mocked.wordCloudSubmission.findMany.mockResolvedValue([
      ...Array.from({ length: 9 }, (_, i) => ({
        word: i % 2 ? 'Digitale!' : 'digitale',
        registrationId: `r${i}`,
        guestId: null,
        roundId: 'd1',
      })),
      { word: 'digitale', registrationId: 'r0', guestId: null, roundId: 'd1' },
      ...Array.from({ length: 4 }, (_, i) => ({
        word: 'pa',
        registrationId: null,
        guestId: `g${i}`,
        roundId: 'd1',
      })),
    ]);
    // Venti stelle con media 4,5: dieci da 4 e dieci da 5.
    mocked.eventFeedback.findMany.mockResolvedValue([
      ...Array.from({ length: 10 }, () => ({ rating: 4 })),
      ...Array.from({ length: 10 }, () => ({ rating: 5 })),
    ]);
    mocked.chatMessage.findMany.mockResolvedValue([
      { text: 'Ci sarà la registrazione?', answeredAt: null, _count: { reactions: 2 } },
      { text: 'Le slide sono scaricabili?', answeredAt: new Date(), _count: { reactions: 5 } },
    ]);
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
    mocked.eventFeedback.findMany.mockResolvedValue([]);
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

describe('formatRecapSummary', () => {
  const full: EventRecap = {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    headcount: 42,
    registrations: 100,
    topQuestions: [{ text: 'q', upvotes: 3 }],
    polls: [{ question: 'p', options: [], totalVotes: 0 }],
    topWords: [],
    feedback: { average: 4.5, count: 20 },
  };

  it('elenca solo le sezioni con dati, con etichette localizzate', () => {
    const it = formatRecapSummary(full, 'it');
    expect(it).toContain('Partecipanti (picco): 42');
    expect(it).toContain('Registrati: 100');
    expect(it).toContain('Media feedback: 4.5/5 (20 risposte)');
    const en = formatRecapSummary(full, 'en');
    expect(en).toContain('Participants (peak): 42');
    expect(en).toContain('Average rating: 4.5/5 (20 responses)');
  });

  it('omette le sezioni vuote', () => {
    const summary = formatRecapSummary(
      {
        version: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        headcount: 0,
        registrations: 10,
        topQuestions: [],
        polls: [],
        topWords: [],
        feedback: { average: null, count: 0 },
      },
      'it',
    );
    expect(summary).toBe('Registrati: 10');
  });
});

describe('buildRecap — domande poste in chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.event.findUnique.mockResolvedValue({ peakParticipants: 10 });
    mocked.registration.count.mockResolvedValue(10);
    mocked.question.findMany.mockResolvedValue([]);
    mocked.poll.findMany.mockResolvedValue([]);
    mocked.wordCloudSubmission.findMany.mockResolvedValue([]);
    mocked.eventFeedback.findMany.mockResolvedValue([]);
  });

  it('ordina per reazioni ricevute e marca quelle con risposta', async () => {
    mocked.chatMessage.findMany.mockResolvedValue([
      { text: 'poco votata', answeredAt: null, _count: { reactions: 1 } },
      { text: 'la più votata', answeredAt: new Date(), _count: { reactions: 9 } },
    ]);
    const recap = await buildRecap('evt1');
    expect(recap.chatQuestions).toEqual([
      { text: 'la più votata', reactions: 9, answered: true },
      { text: 'poco votata', reactions: 1, answered: false },
    ]);
  });

  it('non chiede mai il nome di chi ha scritto: nello snapshot non deve entrare', async () => {
    mocked.chatMessage.findMany.mockResolvedValue([]);
    await buildRecap('evt1');
    const select = mocked.chatMessage.findMany.mock.calls[0]?.[0]?.select;
    expect(select.senderName).toBeUndefined();
    expect(select.senderId).toBeUndefined();
  });

  it('esclude dall’archivio pubblico le domande scartate e quelle nascoste', async () => {
    mocked.chatMessage.findMany.mockResolvedValue([]);
    await buildRecap('evt1');
    const where = mocked.chatMessage.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({ isQuestion: true, hiddenAt: null, dismissedAt: null });
  });

  it('uno snapshot di versione 1 (senza il campo) resta leggibile', () => {
    const vecchio = {
      version: 1 as const,
      generatedAt: '2026-01-01T00:00:00.000Z',
      headcount: 0,
      registrations: 0,
      topQuestions: [],
      polls: [],
      topWords: [],
      feedback: { average: null, count: 0 },
    } satisfies EventRecap;
    expect(isRecapEmpty(vecchio)).toBe(true);
    expect(() => formatRecapSummary(vecchio, 'it')).not.toThrow();
  });
});


describe('buildRecap — valutazioni del questionario', () => {
  it('una media per risposta, insieme alle stelle', async () => {
    mocked.event.findUnique.mockResolvedValue({ id: 'e1', peakParticipants: 0 } as never);
    mocked.registration.count.mockResolvedValue(0);
    mocked.question.findMany.mockResolvedValue([]);
    mocked.poll.findMany.mockResolvedValue([]);
    mocked.wordCloudSubmission.findMany.mockResolvedValue([]);
    mocked.chatMessage.findMany.mockResolvedValue([]);
    mocked.eventFeedback.findMany.mockResolvedValue([{ rating: 2 }]);
    mocked.questionnaireAnswer.findMany.mockResolvedValue([
      { responseId: 'r1', valueScale: 4, item: { scaleMin: 1, scaleMax: 5 } },
      { responseId: 'r1', valueScale: 5, item: { scaleMin: 1, scaleMax: 5 } },
      // Una scala 0-10 riportata su 1-5: 10 → 5.
      { responseId: 'r2', valueScale: 10, item: { scaleMin: 0, scaleMax: 10 } },
    ]);
    const recap = await buildRecap('e1');
    expect(recap.feedback.count).toBe(3);
    // (2 + 4.5 + 5) / 3
    expect(recap.feedback.average).toBeCloseTo(3.833, 2);
  });
});


describe('ensureEventRecap', () => {
  beforeEach(() => vi.clearAllMocks());

  function base() {
    mocked.registration.count.mockResolvedValue(0);
    mocked.question.findMany.mockResolvedValue([]);
    mocked.poll.findMany.mockResolvedValue([]);
    mocked.wordCloudSubmission.findMany.mockResolvedValue([]);
    mocked.chatMessage.findMany.mockResolvedValue([]);
    mocked.eventFeedback.findMany.mockResolvedValue([]);
  }

  it('entro la conservazione: costruito e congelato', async () => {
    base();
    mocked.event.findUnique.mockResolvedValue({
      status: 'ENDED', eventType: 'SCHEDULED', postEventRecap: null, postEventRecapAt: null,
      endsAt: new Date(Date.now() - 86_400_000), dataRetentionDays: 30, peakParticipants: 3,
    });
    expect(await ensureEventRecap('e1')).not.toBeNull();
    expect(mocked.event.updateMany).toHaveBeenCalled();
  });

  it('oltre la conservazione: si mostra ma non si congela (iscrizioni e chat non ci sono piu’)', async () => {
    base();
    mocked.event.findUnique.mockResolvedValue({
      status: 'ENDED', eventType: 'SCHEDULED', postEventRecap: null, postEventRecapAt: null,
      endsAt: new Date(Date.now() - 40 * 86_400_000), dataRetentionDays: 30, peakParticipants: 3,
    });
    expect(await ensureEventRecap('e1')).not.toBeNull();
    expect(mocked.event.updateMany).not.toHaveBeenCalled();
  });
});

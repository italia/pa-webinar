/**
 * Il questionario di valutazione predefinito, dal modello di sistema
 * «Feedback generico»: le quattro strade (c'e' gia', si crea, il modello
 * manca, due richieste in parallelo). E quando la valutazione si puo' vedere
 * e inviare: raccolta accesa, evento in corso o concluso.
 */

import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    eventQuestionnaire: { findUnique: vi.fn(), create: vi.fn() },
    questionTemplate: { findUnique: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';

import { FEEDBACK_GENERIC_TEMPLATE_NAME } from './constants';
import { ensurePostEventQuestionnaire, feedbackOpen } from './default-questionnaire';

const mockedEsistente = prisma.eventQuestionnaire.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedCrea = prisma.eventQuestionnaire.create as unknown as ReturnType<typeof vi.fn>;
const mockedModello = prisma.questionTemplate.findUnique as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  mockedEsistente.mockResolvedValue(null);
  mockedModello.mockResolvedValue({ id: TEMPLATE_ID });
  mockedCrea.mockResolvedValue({ id: 'q-nuovo' });
});

describe('ensurePostEventQuestionnaire', () => {
  it('un questionario di fine evento c’e’ gia’: vero, e non si tocca niente', async () => {
    mockedEsistente.mockResolvedValue({ id: 'q-esistente' });

    await expect(ensurePostEventQuestionnaire(EVENT_ID)).resolves.toBe(true);

    expect(mockedEsistente).toHaveBeenCalledWith({
      where: { eventId_placement: { eventId: EVENT_ID, placement: 'POST_EVENT' } },
      select: { id: true },
    });
    expect(mockedModello).not.toHaveBeenCalled();
    expect(mockedCrea).not.toHaveBeenCalled();
  });

  it('senza questionario: lo crea dal modello «Feedback generico», collocato a fine evento', async () => {
    await expect(ensurePostEventQuestionnaire(EVENT_ID)).resolves.toBe(true);

    expect(mockedModello).toHaveBeenCalledWith({
      where: { name: FEEDBACK_GENERIC_TEMPLATE_NAME },
      select: { id: true },
    });
    expect(mockedCrea).toHaveBeenCalledTimes(1);
    const data = mockedCrea.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      eventId: EVENT_ID,
      placement: 'POST_EVENT',
      templates: { create: [{ templateId: TEMPLATE_ID, sortOrder: 0 }] },
    });
    // Un titolo almeno in italiano, la lingua di ripiego dei questionari.
    expect(data.title.it).toBeTruthy();
  });

  it('il modello di sistema manca: falso, nessun questionario vuoto', async () => {
    mockedModello.mockResolvedValue(null);

    await expect(ensurePostEventQuestionnaire(EVENT_ID)).resolves.toBe(false);
    expect(mockedCrea).not.toHaveBeenCalled();
  });

  it('due richieste in parallelo: chi arriva secondo (P2002) trova quello del primo', async () => {
    mockedCrea.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );

    await expect(ensurePostEventQuestionnaire(EVENT_ID)).resolves.toBe(true);
  });

  it('un altro errore del database non si nasconde', async () => {
    mockedCrea.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
        code: 'P2003',
        clientVersion: 'x',
      }),
    );
    await expect(ensurePostEventQuestionnaire(EVENT_ID)).rejects.toThrow('Foreign key');

    mockedCrea.mockRejectedValueOnce(new Error('connessione persa'));
    await expect(ensurePostEventQuestionnaire(EVENT_ID)).rejects.toThrow('connessione persa');
  });
});

describe('feedbackOpen', () => {
  it.each(['LIVE', 'IDLE', 'ENDED'])('raccolta accesa, evento %s: aperta', (status) => {
    expect(feedbackOpen({ feedbackEnabled: true, status })).toBe(true);
  });

  it.each(['DRAFT', 'PUBLISHED', 'PROVISIONING', 'ARCHIVED'])(
    'raccolta accesa, evento %s: chiusa (mai prima dell’inizio, mai da archiviato)',
    (status) => {
      expect(feedbackOpen({ feedbackEnabled: true, status })).toBe(false);
    },
  );

  it.each(['LIVE', 'IDLE', 'ENDED'])('raccolta spenta, evento %s: chiusa', (status) => {
    expect(feedbackOpen({ feedbackEnabled: false, status })).toBe(false);
  });
});

// @vitest-environment node
/**
 * GET del questionario di un evento, per collocazione.
 *
 * La valutazione di fine evento (POST_EVENT) c'e' solo quando si puo' anche
 * inviare (raccolta accesa, evento in corso o concluso): altrimenti 404, e il
 * modulo non compare per poi fallire all'invio. Una lettura non crea mai il
 * questionario: chi organizza puo' averlo tolto. Il questionario d'iscrizione
 * (PRE_REGISTRATION) non dipende da niente di tutto questo.
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    // Se una lettura provasse a creare il questionario, passerebbe di qui.
    eventQuestionnaire: { findUnique: vi.fn(), create: vi.fn() },
    questionTemplate: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/questionnaires', () => ({
  findEventQuestionnaireByPlacement: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { findEventQuestionnaireByPlacement } from '@/lib/questionnaires';

import { GET } from './route';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedCreate = prisma.eventQuestionnaire.create as unknown as ReturnType<typeof vi.fn>;
const mockedFind = vi.mocked(findEventQuestionnaireByPlacement);

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const SLUG = 'evento-di-prova';

const QUESTIONARIO = {
  id: 'q-1',
  eventId: EVENT_ID,
  placement: 'POST_EVENT' as const,
  title: { it: 'Il tuo feedback' },
  description: {},
  required: false,
  allowEdit: false,
  items: [
    {
      id: 'item-1',
      prompt: { it: 'Voto complessivo' },
      type: 'LIKERT' as const,
      options: null,
      scaleMin: 1,
      scaleMax: 5,
      scaleMinLabel: null,
      scaleMaxLabel: null,
      required: false,
      source: 'template' as const,
      templateId: 'tpl-1',
    },
  ],
};

function get(
  param: string,
  placement: string,
): [NextRequest, { params: Promise<{ param: string; placement: string }> }] {
  return [
    new Request(
      `https://webinar.example.gov.it/api/events/${param}/questionnaires/${placement}`,
    ) as unknown as NextRequest,
    { params: Promise.resolve({ param, placement }) },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEvent.mockResolvedValue({ id: EVENT_ID, feedbackEnabled: true, status: 'ENDED' });
  mockedFind.mockResolvedValue(QUESTIONARIO);
});

describe('GET /api/events/[param]/questionnaires/POST_EVENT — la valutazione di fine evento', () => {
  it.each(['LIVE', 'IDLE', 'ENDED'])('evento %s con la raccolta accesa: il questionario', async (status) => {
    mockedEvent.mockResolvedValue({ id: EVENT_ID, feedbackEnabled: true, status });

    const res = await GET(...get(SLUG, 'POST_EVENT'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mockedFind).toHaveBeenCalledWith(EVENT_ID, 'POST_EVENT');
    expect(await res.json()).toEqual({
      id: 'q-1',
      placement: 'POST_EVENT',
      title: { it: 'Il tuo feedback' },
      description: {},
      required: false,
      allowEdit: false,
      items: QUESTIONARIO.items,
    });
  });

  it.each(['DRAFT', 'PUBLISHED', 'PROVISIONING', 'ARCHIVED'])(
    'evento %s: 404, il modulo non compare',
    async (status) => {
      mockedEvent.mockResolvedValue({ id: EVENT_ID, feedbackEnabled: true, status });

      const res = await GET(...get(SLUG, 'POST_EVENT'));

      expect(res.status).toBe(404);
      expect(mockedFind).not.toHaveBeenCalled();
    },
  );

  it('raccolta spenta, anche a evento concluso: 404', async () => {
    mockedEvent.mockResolvedValue({ id: EVENT_ID, feedbackEnabled: false, status: 'ENDED' });

    const res = await GET(...get(SLUG, 'POST_EVENT'));

    expect(res.status).toBe(404);
    expect(mockedFind).not.toHaveBeenCalled();
  });

  it('chi organizza ha tolto il questionario: 404, e la lettura non lo rimette', async () => {
    mockedFind.mockResolvedValue(null);

    const res = await GET(...get(SLUG, 'POST_EVENT'));

    expect(res.status).toBe(404);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('l’evento si cerca per identificativo o per slug, con raccolta e stato', async () => {
    await GET(...get(EVENT_ID, 'POST_EVENT'));
    expect(mockedEvent.mock.calls[0]![0]).toEqual({
      where: { id: EVENT_ID },
      select: { id: true, feedbackEnabled: true, status: true },
    });

    await GET(...get(SLUG, 'POST_EVENT'));
    expect(mockedEvent.mock.calls[1]![0].where).toEqual({ slug: SLUG });
  });

  it('evento inesistente: 404', async () => {
    mockedEvent.mockResolvedValue(null);

    const res = await GET(...get(SLUG, 'POST_EVENT'));
    expect(res.status).toBe(404);
    expect(mockedFind).not.toHaveBeenCalled();
  });
});

describe('GET /api/events/[param]/questionnaires/PRE_REGISTRATION — non dipende dalla valutazione', () => {
  it('con la raccolta spenta e l’evento non ancora iniziato il questionario d’iscrizione resta', async () => {
    mockedEvent.mockResolvedValue({ id: EVENT_ID, feedbackEnabled: false, status: 'PUBLISHED' });
    mockedFind.mockResolvedValue({ ...QUESTIONARIO, placement: 'PRE_REGISTRATION' });

    const res = await GET(...get(SLUG, 'PRE_REGISTRATION'));

    expect(res.status).toBe(200);
    expect(mockedFind).toHaveBeenCalledWith(EVENT_ID, 'PRE_REGISTRATION');
  });

  it('senza questionario d’iscrizione: 404', async () => {
    mockedFind.mockResolvedValue(null);

    const res = await GET(...get(SLUG, 'PRE_REGISTRATION'));
    expect(res.status).toBe(404);
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe('GET /api/events/[param]/questionnaires/[placement] — collocazione', () => {
  it('una collocazione sconosciuta: 400, senza leggere l’evento', async () => {
    const res = await GET(...get(SLUG, 'DURING_EVENT'));
    expect(res.status).toBe(400);
    expect(mockedEvent).not.toHaveBeenCalled();
  });
});

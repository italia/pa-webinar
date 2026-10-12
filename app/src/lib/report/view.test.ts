import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { vistaResoconto } from './view';

const narrativa = (titolo: string) => ({
  title: titolo,
  abstract: 'a',
  summary: '',
  highlights: [],
  topics: [],
  conceptMap: { nodes: [], edges: [] },
  consensus: { summary: '', agreements: [], disagreements: [] },
  engagement: { summary: '', observations: [] },
  benefits: { summary: '', items: [] },
  feedback: { summary: '', strengths: [], improvements: [], quotes: [] },
  openQuestions: [],
  nextSteps: [],
});
const resoconto = {
  version: 1,
  generatedAt: '2026-10-20T10:00:00.000Z',
  sourceLanguage: 'it',
  model: { id: 'm', version: null },
  metrics: null,
  narratives: { it: narrativa('Italiano'), en: narrativa('English') },
};

describe('vistaResoconto', () => {
  it('solo a evento concluso e con il resoconto pubblicato', () => {
    expect(
      vistaResoconto(
        { status: 'ENDED', postEventReport: resoconto, postEventReportPublished: false },
        'it'
      )
    ).toBeNull();
    expect(
      vistaResoconto(
        { status: 'LIVE', postEventReport: resoconto, postEventReportPublished: true },
        'it'
      )
    ).toBeNull();
    expect(
      vistaResoconto(
        {
          status: 'ENDED',
          postEventReport: { version: 2 },
          postEventReportPublished: true,
        },
        'it'
      )
    ).toBeNull();
  });

  it("nella lingua della pagina se c'e', altrimenti in quella dell'evento", () => {
    const en = vistaResoconto(
      { status: 'ENDED', postEventReport: resoconto, postEventReportPublished: true },
      'en'
    )!;
    expect(en.narrative.title).toBe('English');
    expect(en).toMatchObject({
      language: 'en',
      sourceLanguage: 'it',
      requestedLanguage: 'en',
    });
    const fr = vistaResoconto(
      { status: 'ENDED', postEventReport: resoconto, postEventReportPublished: true },
      'fr'
    )!;
    expect(fr).toMatchObject({ language: 'it', requestedLanguage: 'fr' });
  });

  it('nella pagina non arrivano i numeri che non mostra', () => {
    const conNumeri = {
      ...resoconto,
      metrics: {
        attendance: {
          registered: 1,
          joined: 1,
          peak: 1,
          conversionPct: 100,
          avgDwellSec: 3000,
          retentionPct: 80,
        },
        participation: { attention: 71, interactions: 3 },
      },
    };
    const v = vistaResoconto(
      { status: 'ENDED', postEventReport: conNumeri, postEventReportPublished: true },
      'it'
    )!;
    expect(v.metrics!.attendance).toMatchObject({
      registered: 1,
      avgDwellSec: null,
      retentionPct: null,
    });
    expect(v.metrics!.participation).toMatchObject({ interactions: 3, attention: null });
  });
});

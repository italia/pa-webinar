// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import type { ReportMetrics, ReportView } from '@/lib/report/types';

import PostEventReport from './post-event-report';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const metrics: ReportMetrics = {
  version: 1,
  durationSec: 3600,
  attendance: {
    registered: 40,
    joined: 25,
    peak: 22,
    conversionPct: 63,
    avgDwellSec: null,
    retentionPct: null,
  },
  participation: {
    interactions: 50,
    activePeople: 15,
    activePct: 60,
    chatMessages: 20,
    questions: 6,
    pollVotes: 10,
    words: 6,
    reactions: 12,
    handRaises: 2,
    attention: 71,
  },
  timeline: {
    bucketSec: 300,
    peakIndex: 1,
    buckets: [
      {
        offsetSec: 0,
        label: '0m',
        chat: 1,
        questions: 1,
        polls: 0,
        words: 0,
        reactions: 1,
        total: 3,
      },
      {
        offsetSec: 300,
        label: '5m',
        chat: 5,
        questions: 0,
        polls: 9,
        words: 4,
        reactions: 2,
        total: 20,
      },
    ],
  },
  agenda: [
    {
      label: 'Apertura',
      status: 'DONE',
      plannedMinutes: 10,
      actualMinutes: 12,
      agree: 7,
      disagree: 1,
    },
  ],
  polls: [
    {
      question: 'Vi è utile?',
      options: [
        { text: 'Sì', votes: 9 },
        { text: 'No', votes: 1 },
      ],
      totalVotes: 10,
    },
  ],
  words: [],
  questions: { total: 6, answered: 4, top: [] },
  feedback: {
    responses: 5,
    average: 4.4,
    items: [
      {
        prompt: 'Utilità',
        average: 4.4,
        scaleMin: 1,
        scaleMax: 5,
        distribution: [0, 0, 1, 1, 3],
        answered: 5,
      },
    ],
  },
};

const vista = (override: Partial<ReportView> = {}): ReportView => ({
  metrics,
  narrative: {
    title: 'Il resoconto di prova',
    abstract: 'Si è parlato della piattaforma.',
    summary: 'Primo paragrafo.\n\nSecondo paragrafo.',
    highlights: ['Punto uno'],
    topics: [
      {
        title: 'Accessibilità',
        explanation: 'Spiegazione.',
        keyPoints: ['Chiave'],
        start: '05:10',
        agreement: 'high',
        positions: [{ stance: 'concern', text: 'Tempi stretti' }],
      },
    ],
    conceptMap: {
      nodes: [
        { id: 'a', label: 'Accessibilità', kind: 'topic' },
        { id: 'b', label: 'Comuni', kind: 'actor' },
        { id: 'c', label: 'Linee guida', kind: 'concept' },
      ],
      edges: [{ from: 'b', to: 'a', label: 'applicano' }],
    },
    consensus: { summary: 'Ampio accordo.', agreements: ['Serve'], disagreements: [] },
    engagement: { summary: 'Partecipazione alta.', observations: [] },
    benefits: { summary: '', items: ['Strumenti pratici'] },
    feedback: {
      summary: 'Valutazioni buone.',
      strengths: ['Chiarezza'],
      improvements: [],
      quotes: ['Molto utile'],
    },
    openQuestions: ['Quando?'],
    nextSteps: [],
  },
  language: 'it',
  sourceLanguage: 'it',
  requestedLanguage: 'it',
  generatedAt: '2026-10-20T10:00:00.000Z',
  ...override,
});

let container: HTMLDivElement;
let root: Root;

function disegna(view: ReportView, hasVideo = false, seekTo = vi.fn()) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <PostEventReport
          report={view}
          hasVideo={hasVideo}
          playerRef={{ current: { seekTo } as never }}
        />
      </NextIntlClientProvider>
    );
  });
  return seekTo;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('PostEventReport', () => {
  it('mostra testo, numeri, grafici e mappa', () => {
    disegna(vista());
    const testo = container.textContent ?? '';
    for (const s of [
      'Il resoconto di prova',
      'In breve',
      'La partecipazione in numeri',
      'La partecipazione nel tempo',
      'Gli argomenti',
      'Mappa dei concetti',
      'Accordo e disaccordo',
      'Sondaggi',
      'Le valutazioni dei partecipanti',
      'Che cosa ne ricava chi ha partecipato',
      'Domande aperte',
    ]) {
      expect(testo).toContain(s);
    }
    expect(testo).toContain('Ampio accordo');
    expect(testo).toContain('63% degli iscritti');
    // Un'etichetta accessibile per ogni grafico e la mappa come elenco.
    expect(container.querySelectorAll('svg[role="img"]').length).toBeGreaterThanOrEqual(
      1
    );
    // La mappa: ogni concetto raggiungibile con la tastiera, con il suo nome.
    const nodo = container.querySelector(
      'svg[role="group"] g[role="button"][tabindex="0"][aria-label="Comuni (Soggetto)"]'
    );
    expect(nodo).not.toBeNull();
    expect(nodo!.getAttribute('aria-pressed')).toBe('false');
    // Un clic tiene in evidenza il concetto e mostra le etichette dei suoi collegamenti.
    expect(container.querySelector('svg[role="group"]')!.textContent).not.toContain(
      'applicano'
    );
    act(() => {
      nodo!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(nodo!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('svg[role="group"]')!.textContent).toContain(
      'applicano'
    );
    // Un secondo clic lo toglie, anche se il puntatore e' ancora sopra.
    act(() => {
      nodo!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      nodo!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(nodo!.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('svg[role="group"]')!.textContent).not.toContain(
      'applicano'
    );
    // Con la tastiera: Invio fissa, Esc toglie.
    act(() => {
      nodo!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(nodo!.getAttribute('aria-pressed')).toBe('true');
    act(() => {
      nodo!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(nodo!.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('table.visually-hidden')).not.toBeNull();
    // Senza video, nessun pulsante per andare al minuto.
    expect(testo).not.toContain('Vai al minuto');
    // Il testo dell'AI lo dichiara.
    expect(testo).toContain('modello di intelligenza artificiale');
  });

  it('con il video il tema porta al suo minuto', () => {
    const seekTo = disegna(vista(), true);
    const pulsante = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Vai al minuto 05:10')
    )!;
    act(() => pulsante.click());
    expect(seekTo).toHaveBeenCalledWith(310, true);
  });

  it("dice quando il testo e' in un'altra lingua", () => {
    disegna(vista({ language: 'it', requestedLanguage: 'fr' }));
    expect(container.textContent).toContain('non è disponibile nella tua lingua');
  });

  it('senza numeri mostra solo il testo', () => {
    disegna(vista({ metrics: null }));
    const testo = container.textContent ?? '';
    expect(testo).not.toContain('La partecipazione in numeri');
    expect(testo).toContain('Gli argomenti');
  });
});

// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import messaggi from '@/i18n/messages/it.json';
import type { EventRecap } from '@/lib/events/recap';

import PostEventRecap from './post-event-recap';

const t = messaggi.events.recap;

const riepilogo: EventRecap = {
  version: 2,
  generatedAt: '2026-09-22T12:00:00.000Z',
  headcount: 12,
  registrations: 30,
  topQuestions: [{ text: 'Domanda del Q&A', upvotes: 3 }],
  polls: [],
  topWords: [{ word: 'digitale', count: 4 }],
  feedback: { average: null, count: 0 },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function disegna(
  recap: EventRecap,
  altre: { hideQuestions?: boolean; hideWords?: boolean } = {}
) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messaggi}>
        <PostEventRecap recap={recap} {...altre} />
      </NextIntlClientProvider>
    );
  });
}

describe('PostEventRecap', () => {
  it('mostra i numeri, le domande e le parole', () => {
    disegna(riepilogo);
    expect(container.textContent).toContain('12');
    expect(container.textContent).toContain(t.participants);
    expect(container.textContent).toContain('Domanda del Q&A');
    expect(container.textContent).toContain('digitale');
  });

  it('le domande già nella loro scheda non si ripetono', () => {
    disegna(riepilogo, { hideQuestions: true });
    expect(container.textContent).not.toContain('Domanda del Q&A');
    expect(container.textContent).not.toContain(t.topQuestions);
  });

  it('senza domande non resta il titolo della sezione', () => {
    disegna({ ...riepilogo, topQuestions: [] });
    expect(container.textContent).not.toContain(t.topQuestions);
  });

  it('non disegna mai le domande poste in chat, nemmeno se arrivassero', () => {
    disegna({
      ...riepilogo,
      chatQuestions: [{ text: 'Domanda scritta in chat', reactions: 2, answered: true }],
    });
    expect(container.textContent).not.toContain('Domanda scritta in chat');
  });

  it('uno snapshot di versione 1 si disegna', () => {
    disegna({ ...riepilogo, version: 1 });
    expect(container.textContent).toContain(t.title);
  });
});

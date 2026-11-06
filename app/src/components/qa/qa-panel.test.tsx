// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messaggi from '@/i18n/messages/it.json';

vi.mock('./question-list', () => ({
  default: ({ domandePubblicate }: { domandePubblicate?: boolean }) => (
    <p data-testid="lista">{String(domandePubblicate)}</p>
  ),
}));

import QAPanel from './qa-panel';

const t = messaggi.qa;
let container: HTMLDivElement;
let root: Root;

function disegna(domandePubblicate: boolean) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messaggi}>
        <QAPanel
          eventSlug="evento"
          token="TOKEN"
          isModerator={false}
          domandePubblicate={domandePubblicate}
        />
      </NextIntlClientProvider>
    );
  });
}

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

describe('QAPanel — cosa dice delle domande dopo l’evento', () => {
  it('dove le domande si pubblicano lo dice, in testa e sotto il campo', () => {
    disegna(true);
    expect(container.textContent).toContain(t.qaPersistenceNote);
    expect(container.querySelector('.qa-composer__notice')?.textContent).toBe(
      t.personalDataNotice
    );
    expect(container.querySelector('[data-testid="lista"]')?.textContent).toBe('true');
  });

  it('dove non si pubblicano resta solo l’invito a non scrivere dati personali', () => {
    disegna(false);
    expect(container.textContent).not.toContain(t.qaPersistenceNote);
    expect(container.textContent).not.toContain('sulla pagina dell');
    expect(container.querySelector('.qa-composer__notice')?.textContent).toBe(
      t.personalDataNoticeNotPublished
    );
    expect(container.querySelector('[data-testid="lista"]')?.textContent).toBe('false');
  });
});

// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messaggi from '@/i18n/messages/it.json';

import QuestionForm from './question-form';

const t = messaggi.qa;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messaggi}>
        <QuestionForm eventSlug="evento" token="TOKEN" onSubmitted={vi.fn()} />
      </NextIntlClientProvider>
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const campo = () =>
  container.querySelector<HTMLTextAreaElement>('#qa-question-textarea')!;

describe('QuestionForm — avviso sui dati personali', () => {
  it('è sempre sotto il campo, prima di scrivere', () => {
    const avviso = container.querySelector('.qa-composer__notice');
    expect(avviso?.textContent).toBe(t.personalDataNotice);
    const posizione = campo().compareDocumentPosition(avviso!);
    expect(posizione & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.qa-composer__foot')?.contains(avviso!)).toBe(false);
  });

  it('chi usa uno screen reader lo sente con il campo, insieme all’invito', () => {
    const descritto = campo().getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(descritto).toContain('qa-question-hint');
    const testi = descritto.map((id) => document.getElementById(id)?.textContent);
    expect(testi).toEqual([t.ctaBody, t.personalDataNotice]);
  });

  it('dice che il testo può uscire senza il nome', () => {
    expect(t.personalDataNotice).toContain('senza il tuo nome');
  });

  it('dove le domande non si pubblicano resta l’invito, senza parlare della pagina', () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messaggi}>
          <QuestionForm
            eventSlug="evento"
            token="TOKEN"
            onSubmitted={vi.fn()}
            domandePubblicate={false}
          />
        </NextIntlClientProvider>
      );
    });
    const avviso = container.querySelector('.qa-composer__notice');
    expect(avviso?.textContent).toBe(t.personalDataNoticeNotPublished);
    expect(avviso?.textContent).toContain('dati personali');
    expect(avviso?.textContent).not.toContain('pagina');
  });
});

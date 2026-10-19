// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  percorso: (p: string) => p,
}));

import {
  RiepilogoQuestionari,
  contaBlocco,
  gruppiDelBlocco,
  type ModelloDiDomande,
} from './libreria-domande';
import { makeEmptyQuestionnaireBlock, type QuestionnaireBlock } from './step-4-content';

/**
 * Le domande dei questionari si vedono senza aprire l'editor: quante sono,
 * da quale modello vengono, e dopo l'evento il feedback predefinito che il
 * server aggiunge a un evento nuovo senza scelte.
 */

const FEEDBACK: ModelloDiDomande = {
  id: 'tpl-feedback',
  name: 'Feedback generico',
  description: null,
  itemCount: 2,
  usage: 'POST_EVENT',
  items: [
    {
      prompt: { it: 'Qualità audio', en: 'Audio quality' },
      type: 'LIKERT',
      scaleMin: 1,
      scaleMax: 5,
      required: true,
    },
    { prompt: { it: 'Commenti' }, type: 'OPEN_TEXT', required: false },
  ],
};

const PROFILO: ModelloDiDomande = {
  id: 'tpl-profilo',
  name: 'Profilo',
  description: null,
  itemCount: 1,
  usage: 'PRE_REGISTRATION',
};

const blocco = (patch: Partial<QuestionnaireBlock>): QuestionnaireBlock => ({
  ...makeEmptyQuestionnaireBlock(),
  ...patch,
});

describe('conteggio e gruppi', () => {
  const etichette = { daModello: (n: string) => `da ${n}`, dellEvento: 'evento' };

  it('conta le domande dei modelli, anche prima che arrivino, e quelle scritte per l evento', () => {
    const b = blocco({
      templateIds: ['tpl-feedback', 'tpl-profilo', 'sparito'],
      adhocQuestions: [
        {
          prompt: 'Una',
          type: 'OPEN_TEXT',
          options: [],
          scaleMin: null,
          scaleMax: null,
          required: false,
        },
      ],
    });
    // 2 domande lette, 1 dichiarata dal modello senza domande, nessuna dal
    // modello che non c'e' piu', 1 dell'evento.
    expect(contaBlocco(b, [FEEDBACK, PROFILO])).toBe(4);
  });

  it('raggruppa per provenienza, con le opzioni solo per le domande a scelta', () => {
    const b = blocco({
      templateIds: ['tpl-feedback'],
      adhocQuestions: [
        {
          prompt: 'Sì o no?',
          type: 'YES_NO',
          options: ['resto', 'resto'],
          scaleMin: null,
          scaleMax: null,
          required: true,
        },
        {
          prompt: 'Quale?',
          type: 'SINGLE_CHOICE',
          options: ['A', 'B'],
          scaleMin: null,
          scaleMax: null,
          required: false,
        },
      ],
    });
    const gruppi = gruppiDelBlocco(b, [FEEDBACK], etichette);
    expect(gruppi.map((g) => g.titolo)).toEqual(['da Feedback generico', 'evento']);
    expect(gruppi[1]?.domande.map((d) => d.options)).toEqual([[], ['A', 'B']]);
  });
});

describe('RiepilogoQuestionari', () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn();

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ rows: [FEEDBACK, PROFILO] }))
    );
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function mostra(props: Partial<Parameters<typeof RiepilogoQuestionari>[0]> = {}) {
    const onModifica = vi.fn();
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <RiepilogoQuestionari
            pre={makeEmptyQuestionnaireBlock()}
            post={makeEmptyQuestionnaireBlock()}
            feedbackPredefinito
            onModifica={onModifica}
            {...props}
          />
        </NextIntlClientProvider>
      );
    });
    return onModifica;
  }

  it('in creazione, senza scelte, dopo l evento mostra il feedback predefinito', async () => {
    await mostra();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/question-templates?domande=1', {
      cache: 'no-store',
    });
    expect(container.textContent).toContain('nessuna domanda in più');
    const dopo = container.querySelector('details summary');
    expect(dopo?.textContent).toContain('2 domande');
    expect(container.textContent).toContain('Qualità audio');
  });

  it('in modifica un questionario vuoto resta vuoto', async () => {
    await mostra({ feedbackPredefinito: false });
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toContain('nessun questionario di gradimento');
  });

  it('«Modifica» porta all editor, con un nome che dice quale', async () => {
    const onModifica = await mostra();
    const pulsanti = Array.from(container.querySelectorAll('button'));
    expect(pulsanti.map((b) => b.getAttribute('aria-label'))).toEqual([
      messages.admin.wizard.step3.editQuestionsBefore,
      messages.admin.wizard.step3.editQuestionsAfter,
    ]);
    act(() => pulsanti[0]?.click());
    expect(onModifica).toHaveBeenCalledTimes(1);
  });

  it('se la libreria non si legge restano il momento e «Modifica», senza numeri', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    await mostra();
    expect(container.textContent).toContain(messages.admin.wizard.step4.preHeading);
    expect(container.textContent).toContain(messages.admin.wizard.step4.postHeading);
    expect(container.textContent).not.toContain('nessuna domanda in più');
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });
});

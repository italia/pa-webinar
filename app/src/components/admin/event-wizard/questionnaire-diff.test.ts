import { describe, it, expect } from 'vitest';

import { questionnaireChanged } from './questionnaire-diff';
import type { AdhocQuestionDraft, QuestionnaireBlock } from './step-4-content';

function domanda(overrides: Partial<AdhocQuestionDraft> = {}): AdhocQuestionDraft {
  return {
    prompt: 'Voto complessivo',
    type: 'LIKERT',
    options: [],
    scaleMin: 1,
    scaleMax: 5,
    required: true,
    ...overrides,
  };
}

function blocco(overrides: Partial<QuestionnaireBlock> = {}): QuestionnaireBlock {
  return { templateIds: ['tpl-1'], adhocQuestions: [domanda()], ...overrides };
}

describe('questionnaireChanged', () => {
  it('un questionario non toccato non si riscrive', () => {
    // Il caso che contava: si apre la bozza di una copia, si cambia solo la
    // data e si salva. Riscrivere il questionario azzererebbe obbligatorietà e
    // titolo ereditati.
    expect(questionnaireChanged(blocco(), blocco())).toBe(false);
  });

  it('riconosce un modello aggiunto, tolto o riordinato', () => {
    const iniziale = blocco({ templateIds: ['tpl-1', 'tpl-2'] });
    expect(questionnaireChanged(blocco({ templateIds: ['tpl-1'] }), iniziale)).toBe(true);
    expect(
      questionnaireChanged(blocco({ templateIds: ['tpl-2', 'tpl-1'] }), iniziale),
    ).toBe(true);
  });

  it('riconosce ogni campo modificato di una domanda', () => {
    const casi: Partial<AdhocQuestionDraft>[] = [
      { prompt: 'Altro testo' },
      { type: 'OPEN_TEXT' },
      { options: ['sì', 'no'] },
      { scaleMin: 0 },
      { scaleMax: 10 },
      { required: false },
    ];
    for (const caso of casi) {
      const modificato = blocco({ adhocQuestions: [domanda(caso)] });
      expect(questionnaireChanged(modificato, blocco()), JSON.stringify(caso)).toBe(true);
    }
  });

  it('riconosce una domanda aggiunta o rimossa', () => {
    expect(
      questionnaireChanged(blocco({ adhocQuestions: [domanda(), domanda()] }), blocco()),
    ).toBe(true);
    expect(questionnaireChanged(blocco({ adhocQuestions: [] }), blocco())).toBe(true);
  });

  it('senza questionario iniziale conta solo se c’è qualcosa da creare', () => {
    expect(questionnaireChanged(blocco(), null)).toBe(true);
    expect(
      questionnaireChanged({ templateIds: [], adhocQuestions: [] }, null),
    ).toBe(false);
  });
});

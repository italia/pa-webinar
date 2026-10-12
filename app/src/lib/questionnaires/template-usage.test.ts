import { describe, expect, it } from 'vitest';

import { isForOtherMoment, templatesFor } from './template-usage';

const modelli = [
  { id: 'feedback', usage: 'POST_EVENT' as const },
  { id: 'profilo', usage: 'PRE_REGISTRATION' as const },
  { id: 'libero', usage: null },
];

describe('templatesFor', () => {
  it("prima dell'evento non propone i modelli di feedback", () => {
    expect(templatesFor('PRE_REGISTRATION', modelli).map((m) => m.id)).toEqual(['profilo', 'libero']);
  });

  it("dopo l'evento non propone quelli per l'iscrizione", () => {
    expect(templatesFor('POST_EVENT', modelli).map((m) => m.id)).toEqual(['feedback', 'libero']);
  });

  it('un modello già scelto resta, per poterlo togliere', () => {
    expect(templatesFor('PRE_REGISTRATION', modelli, ['feedback']).map((m) => m.id)).toEqual([
      'feedback',
      'profilo',
      'libero',
    ]);
  });
});

describe('isForOtherMoment', () => {
  it("dice solo dei modelli pensati per l'altro momento", () => {
    expect(isForOtherMoment('PRE_REGISTRATION', 'POST_EVENT')).toBe(true);
    expect(isForOtherMoment('PRE_REGISTRATION', 'PRE_REGISTRATION')).toBe(false);
    expect(isForOtherMoment('POST_EVENT', null)).toBe(false);
  });
});

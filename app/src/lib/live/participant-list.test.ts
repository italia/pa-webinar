import { describe, expect, it } from 'vitest';

import { elencoVisibileAlPubblico } from './participant-list';

describe('elencoVisibileAlPubblico', () => {
  it("di default e' nascosto", () => {
    expect(elencoVisibileAlPubblico({})).toBe(false);
    expect(
      elencoVisibileAlPubblico({ participantListVisible: false, eventType: 'SCHEDULED' })
    ).toBe(false);
    expect(elencoVisibileAlPubblico({ participantListVisible: null })).toBe(false);
  });

  it('lo mostra la scelta di chi organizza', () => {
    expect(elencoVisibileAlPubblico({ participantListVisible: true })).toBe(true);
  });

  it('con gli pseudonimi resta nascosto, anche se scelto', () => {
    expect(
      elencoVisibileAlPubblico({ participantListVisible: true, audienceAnonymous: true })
    ).toBe(false);
    expect(
      elencoVisibileAlPubblico({ audienceAnonymous: true, eventType: 'INSTANT' })
    ).toBe(false);
  });

  it('nelle chiamate rapide resta visibile', () => {
    expect(elencoVisibileAlPubblico({ eventType: 'INSTANT' })).toBe(true);
  });
});

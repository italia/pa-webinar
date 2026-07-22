import { describe, it, expect } from 'vitest';

import { shouldRetryWithJwt } from './index.js';

describe('shouldRetryWithJwt', () => {
  it('login sul dominio nascosto mai entrato in conferenza → si riprova col JWT', () => {
    expect(shouldRetryWithJwt(false, 'recorder@hidden.meet.jitsi')).toBe(true);
  });

  it('stanza rimasta vuota → NON si riprova', () => {
    // Entrati e usciti senza registrare nulla e' normale: ritentare rimetterebbe
    // in sala un bot, stavolta visibile, per tutta la grace iniziale.
    expect(shouldRetryWithJwt(true, 'recorder@hidden.meet.jitsi')).toBe(false);
  });

  it('gia in corso col JWT → non c e nessuna seconda strada', () => {
    expect(shouldRetryWithJwt(false, undefined)).toBe(false);
    expect(shouldRetryWithJwt(true, undefined)).toBe(false);
  });
});

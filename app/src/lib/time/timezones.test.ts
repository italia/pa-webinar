import { describe, expect, it } from 'vitest';

import { COMMON_TIMEZONES, timezoneLabel, timezoneOptions } from './timezones';

describe('timezoneOptions', () => {
  it("propone l'elenco comune quando il valore ne fa parte", () => {
    expect(timezoneOptions('Europe/Madrid')).toEqual([...COMMON_TIMEZONES]);
  });

  it('tiene in testa un fuso salvato che il menu non propone', () => {
    const opts = timezoneOptions('America/Bogota');
    expect(opts[0]).toBe('America/Bogota');
    expect(opts).toHaveLength(COMMON_TIMEZONES.length + 1);
  });

  it("senza valore restituisce l'elenco comune", () => {
    expect(timezoneOptions(null)).toEqual([...COMMON_TIMEZONES]);
    expect(timezoneOptions('')).toEqual([...COMMON_TIMEZONES]);
  });
});

describe('timezoneLabel', () => {
  it('sostituisce i trattini bassi con spazi', () => {
    expect(timezoneLabel('America/New_York')).toBe('America/New York');
  });
});

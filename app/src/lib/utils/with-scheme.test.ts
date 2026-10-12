import { describe, expect, it } from 'vitest';

import { withScheme } from './with-scheme';

describe('withScheme', () => {
  it.each([
    ['www.comune-esempio.it', 'https://www.comune-esempio.it'],
    ['  comune.example.it/pagina ', 'https://comune.example.it/pagina'],
    ['www.comune.it:8080/portale', 'https://www.comune.it:8080/portale'],
    ['localhost:3000', 'https://localhost:3000'],
    ['http://intranet.example.it', 'http://intranet.example.it'],
    ['https://www.example.org', 'https://www.example.org'],
    ['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'],
    ['mailto:info@example.org', 'mailto:info@example.org'],
    ['/privacy', '/privacy'],
    ['#contatti', '#contatti'],
    ['', ''],
  ])('%j diventa %j', (dentro, fuori) => {
    expect(withScheme(dentro)).toBe(fuori);
  });

  it('i valori che non sono testo passano come sono', () => {
    expect(withScheme(null)).toBeNull();
    expect(withScheme(undefined)).toBeUndefined();
  });
});

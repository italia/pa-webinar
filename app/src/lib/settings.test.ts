import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ prisma: {} }));

import { nomeEnte } from './settings';

describe('nomeEnte', () => {
  it("restituisce il nome dell'ente configurato", () => {
    expect(nomeEnte({ organizationName: 'Comune di Esempio' })).toBe('Comune di Esempio');
  });

  it('senza nome, o con soli spazi, dichiara il dato mancante invece di inventarlo', () => {
    expect(nomeEnte({ organizationName: '' })).toBeNull();
    expect(nomeEnte({ organizationName: '   ' })).toBeNull();
  });
});

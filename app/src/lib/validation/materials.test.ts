import { describe, expect, it } from 'vitest';

import { createMaterialAdminSchema } from './materials';
import { createMaterialSchema } from './schemas';

/**
 * Un materiale e' un link che chi partecipa clicca: solo http e https, sia
 * dall'amministrazione sia dalla sala.
 */
describe('indirizzo di un materiale', () => {
  it.each([
    ['https://www.example.org/slide.pdf', true],
    ['http://intranet.example.it/doc', true],
    ['javascript:alert(1)', false],
    ['data:text/html,<p>x</p>', false],
    ['ftp://example.org/file', false],
  ])('%s → accettato: %s', (url, atteso) => {
    expect(createMaterialAdminSchema.safeParse({ title: 'Doc', url }).success).toBe(atteso);
    expect(createMaterialSchema.safeParse({ title: 'Doc', url }).success).toBe(atteso);
  });
});

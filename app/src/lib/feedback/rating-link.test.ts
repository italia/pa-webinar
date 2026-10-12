// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';

import { issueRatingToken, verifyRatingToken } from './rating-link';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const ISCRIZIONE = '22222222-2222-4222-8222-222222222222';

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-app-di-prova-per-il-link-della-valutazione-0123456789';
});

describe('link della valutazione', () => {
  it('restituisce l\'iscrizione per il suo evento', () => {
    expect(verifyRatingToken(issueRatingToken(EVENTO, ISCRIZIONE)!, EVENTO)).toBe(ISCRIZIONE);
  });

  it('non vale per un altro evento, ne\' alterato', () => {
    const token = issueRatingToken(EVENTO, ISCRIZIONE)!;
    expect(verifyRatingToken(token, '99999999-9999-4999-8999-999999999999')).toBeNull();
    expect(verifyRatingToken(`${token.slice(0, -2)}xx`, EVENTO)).toBeNull();
    expect(verifyRatingToken('a.b', EVENTO)).toBeNull();
  });
});

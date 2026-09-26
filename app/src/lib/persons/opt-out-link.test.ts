import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rubricaOptOutUrl } from './opt-out-link';
import { verifyRubricaOptOutToken } from './opt-out-token';

const previousSecret = process.env.APP_SECRET;
beforeEach(() => {
  process.env.APP_SECRET = 'segreto-di-prova-lungo-almeno-trentadue-byte';
});
afterEach(() => {
  if (previousSecret === undefined) delete process.env.APP_SECRET;
  else process.env.APP_SECRET = previousSecret;
});

describe('rubricaOptOutUrl', () => {
  it('builds a localized link with a token that the opt-out endpoint accepts', () => {
    const url = rubricaOptOutUrl(
      { id: 'person-1', optedInToAddressBook: true },
      'https://portale.example.test/',
      'it',
    );
    expect(url).toMatch(/^https:\/\/portale\.example\.test\/it\/rubrica\/opt-out\?token=/);
    const token = new URL(url!).searchParams.get('token')!;
    expect(verifyRubricaOptOutToken(token)).toEqual({ personId: 'person-1' });
  });

  it('gives no link to someone who is not in the address book', () => {
    expect(rubricaOptOutUrl(null, 'https://portale.example.test', 'it')).toBeNull();
    expect(
      rubricaOptOutUrl({ id: 'p', optedInToAddressBook: false }, 'https://portale.example.test', 'it'),
    ).toBeNull();
  });
});

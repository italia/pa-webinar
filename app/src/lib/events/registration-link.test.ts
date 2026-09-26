// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';

import {
  registrationJoinUrl,
  signRegistrationEntry,
  verifyRegistrationEntry,
} from './registration-link';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ALTRO_EVENTO = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'tok-personale-di-prova-123';
const BASE = 'https://webinar.example.gov.it';

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-lungo-almeno-trentadue-caratteri';
});

describe('firma del link personale', () => {
  it("vale per quell'iscrizione a quell'evento", () => {
    const sig = signRegistrationEntry(EVENT_ID, TOKEN);
    expect(verifyRegistrationEntry(EVENT_ID, TOKEN, sig)).toBe(true);
  });

  it('non vale per un altro token o un altro evento', () => {
    const sig = signRegistrationEntry(EVENT_ID, TOKEN);
    expect(verifyRegistrationEntry(EVENT_ID, 'un-altro-token', sig)).toBe(false);
    expect(verifyRegistrationEntry(ALTRO_EVENTO, TOKEN, sig)).toBe(false);
  });

  it('una firma assente, troncata o inventata non vale', () => {
    const sig = signRegistrationEntry(EVENT_ID, TOKEN);
    expect(verifyRegistrationEntry(EVENT_ID, TOKEN, '')).toBe(false);
    expect(verifyRegistrationEntry(EVENT_ID, TOKEN, sig.slice(0, -2))).toBe(false);
    expect(verifyRegistrationEntry(EVENT_ID, TOKEN, 'x'.repeat(sig.length))).toBe(false);
    expect(verifyRegistrationEntry(EVENT_ID, '', sig)).toBe(false);
  });
});

describe('registrationJoinUrl', () => {
  it('iscrizione aperta: il link della sala, localizzato, come sempre', () => {
    expect(
      registrationJoinUrl({
        baseUrl: BASE,
        slug: 'evento',
        eventId: EVENT_ID,
        accessToken: TOKEN,
        locale: 'it',
        viaEmailEntry: false,
      }),
    ).toBe(`${BASE}/it/eventi/evento/live?token=${TOKEN}`);
  });

  it("solo su invito: passa dalla rotta d'ingresso, con token, firma e lingua", () => {
    const url = new URL(
      registrationJoinUrl({
        baseUrl: BASE,
        slug: 'evento',
        eventId: EVENT_ID,
        accessToken: TOKEN,
        locale: 'en',
        viaEmailEntry: true,
      }),
    );
    expect(url.origin + url.pathname).toBe(`${BASE}/api/events/evento/registrations/enter`);
    expect(url.searchParams.get('token')).toBe(TOKEN);
    expect(url.searchParams.get('lang')).toBe('en');
    expect(verifyRegistrationEntry(EVENT_ID, TOKEN, url.searchParams.get('sig') ?? '')).toBe(true);
  });
});

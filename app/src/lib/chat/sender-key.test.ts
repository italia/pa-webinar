import { createHash } from 'crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { withoutRawSenderId, type ChatEnvelope } from './pubsub';
import { guestSenderId, senderColourKey } from './sender-key';

const GUEST_IP = '198.51.100.23';
const GUEST_SENDER_ID = guestSenderId(GUEST_IP, 'Gina');

const previousSecret = process.env.APP_SECRET;
afterEach(() => {
  if (previousSecret === undefined) delete process.env.APP_SECRET;
  else process.env.APP_SECRET = previousSecret;
});

describe('senderColourKey', () => {
  it('is stable and short for the same sender', () => {
    process.env.APP_SECRET = 'segreto-di-prova-lungo-almeno-trentadue-byte';
    const a = senderColourKey(GUEST_SENDER_ID);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(senderColourKey(GUEST_SENDER_ID)).toBe(a);
    expect(senderColourKey('reg-altro')).not.toBe(a);
  });

  it('cannot be recomputed without APP_SECRET (no enumeration of name + IP)', () => {
    // Nome visibile accanto alla chiave + spazio IPv4 piccolo: con uno SHA-256
    // non firmato bastava provare tutti gli indirizzi per ritrovare l'IP.
    process.env.APP_SECRET = 'segreto-di-prova-lungo-almeno-trentadue-byte';
    const key = senderColourKey(GUEST_SENDER_ID);
    const unkeyed = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
    expect(key).not.toBe(unkeyed(GUEST_SENDER_ID));
    expect(key).not.toBe(unkeyed(`chat-sender-key:${GUEST_SENDER_ID}`));

    process.env.APP_SECRET = 'un-altro-segreto-lungo-almeno-trentadue-byte';
    expect(senderColourKey(GUEST_SENDER_ID)).not.toBe(key);
  });

  it('returns an empty key for an empty id', () => {
    expect(senderColourKey('')).toBe('');
  });
});

describe('withoutRawSenderId', () => {
  it('drops a raw senderId still published by an older pod during a rolling update', () => {
    const legacy = {
      id: 'm1',
      eventId: 'e1',
      senderId: GUEST_SENDER_ID,
      senderName: 'Gina',
      isModerator: false,
      text: 'ciao',
      createdAt: '2026-07-22T10:00:00.000Z',
    } as unknown as ChatEnvelope;
    const safe = withoutRawSenderId(legacy);
    expect(safe).not.toHaveProperty('senderId');
    expect(JSON.stringify(safe)).not.toContain(GUEST_SENDER_ID);
    expect(safe.text).toBe('ciao');
  });

  it('passes a current envelope through untouched', () => {
    const current: ChatEnvelope = {
      id: 'm1',
      eventId: 'e1',
      senderKey: 'abcdef0123456789',
      senderName: 'Gina',
      isModerator: false,
      text: 'ciao',
      createdAt: '2026-07-22T10:00:00.000Z',
    };
    expect(withoutRawSenderId(current)).toBe(current);
  });
});

describe('guestSenderId', () => {
  it('is stable for the same address and name, and does not contain the address', () => {
    process.env.APP_SECRET = 'segreto-di-prova-lungo-almeno-trentadue-byte';
    const id = guestSenderId(GUEST_IP, 'Gina');
    expect(id).toMatch(/^guest-[0-9a-f]{24}$/);
    expect(guestSenderId(GUEST_IP, 'Gina')).toBe(id);
    expect(guestSenderId(GUEST_IP, 'Anna')).not.toBe(id);
    const encoded = Buffer.from(GUEST_IP).toString('base64url');
    expect(id).not.toContain(encoded.slice(0, 8));
  });

  it('cannot be recomputed without APP_SECRET', () => {
    process.env.APP_SECRET = 'segreto-di-prova-lungo-almeno-trentadue-byte';
    const keyed = guestSenderId(GUEST_IP, 'Gina');
    const unkeyed = `guest-${createHash('sha256')
      .update(`chat-guest-id:${GUEST_IP}:Gina`)
      .digest('hex')
      .slice(0, 24)}`;
    expect(keyed).not.toBe(unkeyed);
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import messages from '@/i18n/messages/it.json';

import { roomReadHeaders, wordSubmitErrorKey, wordSubmitInit } from './word-cloud-request';

/**
 * Cosa manda il pannello della nuvola quando si scrive una parola.
 *
 * Il difetto che questi test fissano: il pannello mandava il token di sala
 * come identità e, a chi un token non l'aveva, la sola parola. Il server
 * rispondeva 403 al relatore e 422 a ogni ospite, e il pannello svuotava il
 * campo come se la parola fosse entrata. Il moderatore il campo non lo vedeva
 * proprio: in una chiamata rapida — ospiti più chi conduce — non scriveva
 * nessuno.
 */

function corpo(init: RequestInit | null): Record<string, unknown> {
  expect(init).not.toBeNull();
  return JSON.parse(String(init!.body)) as Record<string, unknown>;
}

function intestazioni(init: RequestInit | null): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

describe('wordSubmitInit — identità di chi scrive', () => {
  it("l'ospite scrive con l'identificativo del browser, senza token", () => {
    const init = wordSubmitInit('futuro', '', { voterGuestId: 'guest_abc' });
    expect(corpo(init)).toEqual({ word: 'futuro', guestId: 'guest_abc' });
    expect(intestazioni(init).Authorization).toBeUndefined();
  });

  it('il relatore manda il token di sala come prova di presenza, non come identità', () => {
    const init = wordSubmitInit('dati', 'TOKEN_RELATORE', { voterGuestId: 'guest_rel' });
    expect(corpo(init)).toEqual({ word: 'dati', guestId: 'guest_rel' });
    expect(corpo(init)).not.toHaveProperty('accessToken');
    expect(intestazioni(init).Authorization).toBe('Bearer TOKEN_RELATORE');
  });

  it("l'iscritto scrive con la propria registrazione", () => {
    const init = wordSubmitInit('apertura', 'ALICE', { voterAccessToken: 'ALICE' });
    expect(corpo(init)).toEqual({ word: 'apertura', accessToken: 'ALICE' });
  });

  it("senza un'identità non parte nessuna richiesta", () => {
    expect(wordSubmitInit('niente', 'TOKEN', {})).toBeNull();
  });
});

describe('wordSubmitErrorKey — perché la parola non è entrata', () => {
  it('il limite di parole ha un messaggio suo', async () => {
    const res = Response.json({ code: 'WORD_LIMIT_REACHED' }, { status: 409 });
    expect(await wordSubmitErrorKey(res)).toBe('errors.limit');
  });

  it('ogni altra 409 è il giro chiuso', async () => {
    expect(await wordSubmitErrorKey(Response.json({ code: 'CONFLICT' }, { status: 409 }))).toBe(
      'errors.closed',
    );
    expect(await wordSubmitErrorKey(new Response('non json', { status: 409 }))).toBe(
      'errors.closed',
    );
  });

  it('il tetto di invii ha un messaggio suo, che non invita a riprovare subito', async () => {
    expect(await wordSubmitErrorKey(new Response(null, { status: 429 }))).toBe(
      'errors.rateLimited',
    );
  });

  it('qualunque altro rifiuto è un invio non riuscito', async () => {
    for (const status of [401, 403, 422, 500]) {
      expect(await wordSubmitErrorKey(new Response(null, { status }))).toBe('errors.send');
    }
  });

  it('ogni chiave esiste nei messaggi', async () => {
    for (const chiave of [
      'errors.limit',
      'errors.closed',
      'errors.rateLimited',
      'errors.send',
    ] as const) {
      const [, voce] = chiave.split('.') as ['errors', keyof typeof messages.wordcloud.errors];
      expect(messages.wordcloud.errors[voce]).toBeTruthy();
    }
  });
});

describe('roomReadHeaders — con che cosa si legge il giro', () => {
  it('chi ha un token di sala lo mostra', () => {
    expect(roomReadHeaders('TOKEN_RELATORE')).toEqual({ Authorization: 'Bearer TOKEN_RELATORE' });
  });

  it("l'ospite non manda nessuna intestazione", () => {
    expect(roomReadHeaders('')).toBeUndefined();
  });
});

describe('WordCloud — il pannello usa queste regole', () => {
  // Spazi normalizzati: un a capo in più non è un cambio di comportamento.
  const src = readFileSync(path.join(__dirname, 'word-cloud.tsx'), 'utf8').replace(/\s+/g, ' ');

  it("costruisce l'invio da qui e dice perché una parola è stata respinta", () => {
    expect(src).toContain('wordSubmitInit(inputWord.trim(), token, { voterAccessToken, voterGuestId })');
    expect(src).toContain('setError(t(await wordSubmitErrorKey(res)))');
  });

  it('legge il giro mostrando il token di sala', () => {
    expect(src).toContain('fetch(url, { headers: roomReadHeaders(token) })');
  });

  it('non nasconde il campo a chi conduce', () => {
    // Il campo era dentro `{!isModerator && (…)}`.
    const campo = src.indexOf("placeholder={t('submitPlaceholder')}");
    expect(campo).toBeGreaterThan(-1);
    const prima = src.slice(Math.max(0, campo - 900), campo);
    expect(prima).not.toMatch(/!isModerator && \(/);
  });
});

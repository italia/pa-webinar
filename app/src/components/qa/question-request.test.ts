import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  questionSubmitBody,
  questionSubmitError,
  questionsReadUrl,
  upvoteInit,
} from './question-request';

/**
 * Con quale identità il modulo del Q&A invia una domanda.
 *
 * L'ospite mandava solo il nome, e il server limitava le domande anonime per
 * indirizzo IP: dietro lo stesso NAT — un ufficio, una rete di ente — la
 * prima domanda bloccava quelle di tutti gli altri per mezzo minuto. Ora
 * l'ospite manda anche l'identificativo stabile del browser, che è la chiave
 * del limite per persona.
 */
describe('questionSubmitBody', () => {
  it("l'ospite manda il nome e l'identificativo del browser", () => {
    expect(questionSubmitBody('Una domanda', '', { guestName: 'Anna', guestId: 'guest_abc' })).toEqual({
      text: 'Una domanda',
      guestName: 'Anna',
      guestId: 'guest_abc',
    });
  });

  it('un identificativo vuoto non viaggia: la domanda non va persa per questo', () => {
    const body = questionSubmitBody('Una domanda', '', { guestName: 'Anna', guestId: '' });
    expect(JSON.parse(JSON.stringify(body))).toEqual({ text: 'Una domanda', guestName: 'Anna' });
  });

  it('con un token la firma la mette il server: niente nome, niente identificativo', () => {
    expect(
      questionSubmitBody('Una domanda', 'TOKEN', { guestName: 'Anna', guestId: 'guest_abc' }),
    ).toEqual({ text: 'Una domanda', accessToken: 'TOKEN' });
  });
});

describe('dal pannello alla richiesta', () => {
  const dir = path.join(__dirname, '..');

  // Spazi normalizzati: un a capo in più non è un cambio di comportamento.
  const leggi = (...parti: string[]) =>
    readFileSync(path.join(dir, ...parti), 'utf8').replace(/\s+/g, ' ');

  it('il modulo costruisce il corpo da qui', () => {
    const src = leggi('qa', 'question-form.tsx');
    expect(src).toContain('questionSubmitBody(text.trim(), token, { guestName, guestId })');
  });

  it("il pannello passa l'identificativo al modulo", () => {
    const src = leggi('qa', 'qa-panel.tsx');
    expect(src).toMatch(/<QuestionForm[\s\S]*?guestId=\{guestId\}[\s\S]*?\/>/);
  });

  it('la lista legge e vota con l’identità di voto, non col token di sala', () => {
    const src = leggi('qa', 'question-list.tsx');
    expect(src).toContain('questionsReadUrl(`/api/events/${eventSlug}/questions`, { voterGuestId })');
    expect(src).toContain('upvoteInit(token, { voterAccessToken, voterGuestId })');
    expect(src).not.toContain('JSON.stringify({ accessToken: token })');
  });

  it("il pannello passa l'identità di voto alla lista", () => {
    const src = leggi('qa', 'qa-panel.tsx');
    expect(src).toMatch(
      /<QuestionList[\s\S]*?voterAccessToken=\{voterAccessToken\}[\s\S]*?voterGuestId=\{voterGuestId\}[\s\S]*?\/>/,
    );
  });

  it("la sala lo passa al pannello per chi entra senza token, e alla nuvola l'identità di voto", () => {
    // Quale identità sia, per ogni posto in sala, lo verifica voter-identity.test.
    const src = leggi('live', 'live-event-client.tsx');
    expect(src).toMatch(/<QAPanel[\s\S]*?guestId=\{!token \? voterGuestId : undefined\}[\s\S]*?\/>/);
    expect(src).toMatch(
      /<QAPanel[\s\S]*?voterAccessToken=\{voterAccessToken\}[\s\S]*?voterGuestId=\{voterGuestId\}[\s\S]*?\/>/,
    );
    expect(src).toMatch(
      /<WordCloud[\s\S]*?voterAccessToken=\{voterAccessToken\}[\s\S]*?voterGuestId=\{voterGuestId\}[\s\S]*?\/>/,
    );
  });
});

/**
 * Il messaggio per una domanda respinta. Il tetto della rete ferma anche chi
 * non ha ancora chiesto nulla: dirgli di aspettare prima di un'«altra» domanda
 * era falso.
 */
describe('questionSubmitError', () => {
  it('il limite della persona: attendere prima di un’altra domanda', () => {
    expect(questionSubmitError(429, 'RATE_LIMIT')).toBe('rateLimit');
    expect(questionSubmitError(429)).toBe('rateLimit');
  });

  it('il tetto della rete: riprovare fra qualche secondo', () => {
    expect(questionSubmitError(429, 'NETWORK_RATE_LIMIT')).toBe('busy');
  });

  it('ogni altro errore è generico', () => {
    expect(questionSubmitError(500)).toBe('generic');
    expect(questionSubmitError(401, 'UNAUTHORIZED')).toBe('generic');
  });

  it('il modulo usa questa regola', () => {
    const src = readFileSync(path.join(__dirname, 'question-form.tsx'), 'utf8');
    expect(src).toContain('questionSubmitError(res.status, code)');
  });
});

/**
 * Con quale identità si sostiene una domanda. Il pulsante mandava il token di
 * sala come `accessToken`: il server lo cerca fra le registrazioni, quindi
 * votavano soltanto gli iscritti, e a ospiti e relatori il pulsante non veniva
 * nemmeno mostrato.
 */
describe('upvoteInit', () => {
  function corpo(init: RequestInit | null): Record<string, unknown> {
    expect(init).not.toBeNull();
    return JSON.parse(String(init!.body)) as Record<string, unknown>;
  }
  const intestazioni = (init: RequestInit | null) =>
    (init?.headers ?? {}) as Record<string, string>;

  it("l'ospite vota con l'identificativo del browser, senza token", () => {
    const init = upvoteInit('', { voterGuestId: 'guest_abc' });
    expect(corpo(init)).toEqual({ guestId: 'guest_abc' });
    expect(intestazioni(init).Authorization).toBeUndefined();
  });

  it('il relatore manda il token di sala come prova di presenza, non come identità', () => {
    const init = upvoteInit('TOKEN_RELATORE', { voterGuestId: 'guest_rel' });
    expect(corpo(init)).toEqual({ guestId: 'guest_rel' });
    expect(intestazioni(init).Authorization).toBe('Bearer TOKEN_RELATORE');
  });

  it("l'iscritto vota con la propria registrazione", () => {
    expect(corpo(upvoteInit('ALICE', { voterAccessToken: 'ALICE' }))).toEqual({
      accessToken: 'ALICE',
    });
  });

  it("senza un'identità non parte nessuna richiesta", () => {
    expect(upvoteInit('TOKEN', {})).toBeNull();
  });
});

describe('questionsReadUrl', () => {
  const API = '/api/events/evento/questions';

  it("chi vota col browser legge con il proprio identificativo", () => {
    expect(questionsReadUrl(API, { voterGuestId: 'guest a&b' })).toBe(
      `${API}?guestId=guest%20a%26b`,
    );
  });

  it("l'iscritto legge l'elenco com'è: lo riconosce il token", () => {
    expect(questionsReadUrl(API, { voterAccessToken: 'ALICE' })).toBe(API);
    expect(questionsReadUrl(API, {})).toBe(API);
  });
});

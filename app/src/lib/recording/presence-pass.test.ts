// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/app-secret', () => ({
  tryGetAppSecret: () => 'segreto-di-prova-del-pass-di-presenza-lungo',
}));

import {
  buildPresencePassSetCookie,
  haPassDiPresenza,
  issuePresencePass,
  presencePassCookieName,
  scadenzaPass,
  verifyPresencePass,
} from './presence-pass';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const ALTRO = '22222222-2222-4222-8222-222222222222';
const ADESSO = new Date('2026-11-18T10:00:00Z');
const GIORNO = 86_400_000;

describe('scadenzaPass', () => {
  it('dura quanto la chiamata e’ conservata, dalla fine prevista', () => {
    const fine = new Date(ADESSO.getTime() + 4 * 3_600_000);
    expect(scadenzaPass({ endsAt: fine, dataRetentionDays: 7 }, ADESSO)).toEqual(
      new Date(fine.getTime() + 7 * GIORNO)
    );
  });

  it('o da adesso, se la chiamata va oltre la fine prevista', () => {
    const fine = new Date(ADESSO.getTime() - 3_600_000);
    expect(scadenzaPass({ endsAt: fine, dataRetentionDays: 7 }, ADESSO)).toEqual(
      new Date(ADESSO.getTime() + 7 * GIORNO)
    );
  });
});

describe('il pass', () => {
  const scadenza = new Date(ADESSO.getTime() + 7 * GIORNO);
  const pass = issuePresencePass(EVENTO, scadenza)!;

  it('vale per il suo evento fino alla scadenza', () => {
    expect(verifyPresencePass(pass, EVENTO, ADESSO)).toBe(true);
    expect(verifyPresencePass(pass, EVENTO, new Date(scadenza.getTime() + 1000))).toBe(
      false
    );
  });

  it('non vale per un altro evento, ne’ alterato, ne’ assente', () => {
    expect(verifyPresencePass(pass, ALTRO, ADESSO)).toBe(false);
    expect(verifyPresencePass(`${pass}x`, EVENTO, ADESSO)).toBe(false);
    expect(verifyPresencePass(undefined, EVENTO, ADESSO)).toBe(false);
  });

  it('una scadenza cambiata invalida la firma', () => {
    const [sec, sig] = pass.split('.');
    expect(verifyPresencePass(`${Number(sec) + 86_400}.${sig}`, EVENTO, ADESSO)).toBe(
      false
    );
  });

  it('non vale come link della visione, ne’ viceversa', async () => {
    const { issueViewingToken, verifyViewingToken } = await import('./viewing');
    const visione = issueViewingToken(
      EVENTO,
      String(Math.floor(scadenza.getTime() / 1000))
    )!;
    expect(verifyPresencePass(visione, EVENTO, ADESSO)).toBe(false);
    expect(verifyViewingToken(pass, EVENTO)).toBeNull();
  });

  it('e’ corto: un cookie per chiamata viaggia con ogni richiesta', () => {
    const cookie = buildPresencePassSetCookie(EVENTO, pass, scadenza, ADESSO).split(
      ';'
    )[0]!;
    expect(cookie.length).toBeLessThan(80);
  });

  it('si legge dal cookie dell’evento', () => {
    const biscotti = {
      get: (nome: string) =>
        nome === presencePassCookieName(EVENTO) ? { value: pass } : undefined,
    } as unknown as Parameters<typeof haPassDiPresenza>[0];
    expect(haPassDiPresenza(biscotti, EVENTO, ADESSO)).toBe(true);
    expect(haPassDiPresenza(biscotti, ALTRO, ADESSO)).toBe(false);
  });

  it('il cookie e’ HttpOnly, per tutto il sito, e scade con il pass', () => {
    const cookie = buildPresencePassSetCookie(EVENTO, pass, scadenza, ADESSO);
    expect(cookie).toContain(`${presencePassCookieName(EVENTO)}=${pass}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain(`Max-Age=${7 * 86_400}`);
  });
});

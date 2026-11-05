import { describe, expect, it } from 'vitest';

import { indirizzoSicuro } from './indirizzo-sicuro';

describe('indirizzoSicuro', () => {
  it.each([
    'https://esempio.test/copertina.jpg?w=800&h=600#in-alto',
    'http://esempio.test/a.png',
    'http://[2001:db8::1]:8443/a.png',
    'blob:https://esempio.test/0b0e1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
    'data:image/png;base64,iVBORw0KGgo=',
    'data:audio/mpeg;base64,SUQz',
    '/api/assets/materiali/slide.pdf',
    '/',
  ])('lascia intatto %s', (url) => {
    expect(indirizzoSicuro(url)).toBe(url);
  });

  it.each([
    'https://esempio.test/gia%20codificato.png',
    'https://esempio.test/100%.png',
    'https://esempio.test/a%25b.png',
    'https://esempio.test/quadra%5Bcodificata%5D.png',
  ])('non codifica due volte %s', (url) => {
    expect(indirizzoSicuro(url)).toBe(url);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:application/javascript,alert(1)',
    'file:///etc/passwd',
    '//altro.example/a.png',
    '/\\altro.example/a.png',
    '/ altro.example/a.png',
    'percorso/relativo.png',
    '',
    null,
    undefined,
  ])('rifiuta %j', (url) => {
    expect(indirizzoSicuro(url)).toBeUndefined();
  });

  it('un indirizzo ammesso resta quello ricevuto, scritto com era', () => {
    for (const url of [
      'HTTPS://esempio.test/a.png',
      'https://esempio.test/cartella\\a.png',
      'https://portale.test\\@altro.example/a.png',
      'https://esempio.test/a.png \n',
      'https://esempio.test/a\tb.png',
      'https://esempio.test/città.png',
      'https://esempio.test/a|b^c{d}.png',
      '/api/assets/a.png?v=2#x',
    ]) {
      expect(indirizzoSicuro(url)).toBe(url);
    }
  });

  it('un punto nel percorso non lo trasforma in un altro host', () => {
    for (const url of ['/.//altro.example/a.png', '/x/..//altro.example/a.png']) {
      expect(indirizzoSicuro(url)).toBe(url);
      expect(new URL(indirizzoSicuro(url) ?? '', 'https://portale.test').host).toBe(
        'portale.test'
      );
    }
  });

  it('un valore ammesso non porta con se virgolette doppie o parentesi angolari', () => {
    const pericoloso = 'https://esempio.test/a.png"><img src=x onerror=alert(1)>';
    const pulito = indirizzoSicuro(pericoloso);
    expect(pulito).toBe(
      'https://esempio.test/a.png%22%3E%3Cimg src=x onerror=alert(1)%3E'
    );
    expect(pulito).not.toMatch(/[<>"]/);
  });

  it('il corpo di un dato incorporato perde i segni di markup, non il contenuto', () => {
    expect(indirizzoSicuro('data:image/svg+xml,<svg xmlns="http://x"></svg>')).toBe(
      'data:image/svg+xml,%3Csvg xmlns=%22http://x%22%3E%3C/svg%3E'
    );
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { rateLimit, getClientIp, trustedProxyHops } from './rate-limit';

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests under limit', () => {
    const key = `test-allow-${Date.now()}`;
    const r1 = rateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = rateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = rateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it('blocks requests over limit', () => {
    const key = `test-block-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      rateLimit(key, { limit: 3, windowMs: 60_000 });
    }
    const result = rateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets after window expires', () => {
    const key = `test-reset-${Date.now()}`;
    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      rateLimit(key, { limit: 3, windowMs: 10_000 });
    }
    const blocked = rateLimit(key, { limit: 3, windowMs: 10_000 });
    expect(blocked.allowed).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(11_000);

    const afterReset = rateLimit(key, { limit: 3, windowMs: 10_000 });
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(2);
  });

  it('different keys have separate limits', () => {
    const keyA = `test-a-${Date.now()}`;
    const keyB = `test-b-${Date.now()}`;

    // Exhaust key A
    for (let i = 0; i < 2; i++) {
      rateLimit(keyA, { limit: 2, windowMs: 60_000 });
    }
    const blockedA = rateLimit(keyA, { limit: 2, windowMs: 60_000 });
    expect(blockedA.allowed).toBe(false);

    // Key B should still be allowed
    const allowedB = rateLimit(keyB, { limit: 2, windowMs: 60_000 });
    expect(allowedB.allowed).toBe(true);
  });

  it('returns resetAt in the future', () => {
    const key = `test-reset-at-${Date.now()}`;
    const result = rateLimit(key, { limit: 5, windowMs: 60_000 });
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });
});

// Richiesta come la vede il portale: l'X-Forwarded-For dei casi di prova è
// quello che arriva DOPO il passaggio dai proxy (la parte sinistra la sceglie
// il client, quella destra la scrivono i proxy).
function req(headers: Record<string, string> | [string, string][] = {}): Request {
  return new Request('http://localhost', { headers });
}

describe('getClientIp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('default (TRUSTED_PROXY_HOPS non impostata: solo l\'ingress è fidato)', () => {
    it('una sola voce, come la scrivono ingress-nginx e Traefik di default', () => {
      expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.7' }))).toBe('198.51.100.7');
    });

    it('prende la voce più a destra, quella accodata dall\'ingress', () => {
      // Traefik con forwardedHeaders.trustedIPs / insecure, o ingress-nginx con
      // compute-full-forwarded-for: il valore del client resta a sinistra.
      expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.9, 198.51.100.20' }))).toBe(
        '198.51.100.20',
      );
    });

    it('un client che ruota valori inventati resta nello stesso contatore', () => {
      const keys = new Set<string>();
      for (let i = 1; i <= 12; i++) {
        keys.add(getClientIp(req({ 'x-forwarded-for': `203.0.113.${i}, 192.0.2.50` })));
      }
      expect([...keys]).toEqual(['192.0.2.50']);
    });

    it('più voci inventate a sinistra non spostano la chiave', () => {
      expect(
        getClientIp(req({ 'x-forwarded-for': '10.0.0.1, 10.0.0.2, 127.0.0.1, 192.0.2.50' })),
      ).toBe('192.0.2.50');
    });

    it('più header X-Forwarded-For si leggono come una lista unica', () => {
      const headers: [string, string][] = [
        ['x-forwarded-for', '203.0.113.9'],
        ['x-forwarded-for', '192.0.2.50'],
      ];
      expect(getClientIp(req(headers))).toBe('192.0.2.50');
    });

    it('ignora gli spazi intorno alle voci', () => {
      expect(getClientIp(req({ 'x-forwarded-for': '  1.2.3.4  ' }))).toBe('1.2.3.4');
      expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.9 ,\t192.0.2.50 ' }))).toBe(
        '192.0.2.50',
      );
    });
  });

  describe('proxy fidati davanti all\'ingress', () => {
    it('TRUSTED_PROXY_HOPS=1: la voce accodata dal bilanciatore, non quella del client', () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
      // client (inventato) → bilanciatore (accoda il client vero) → ingress
      // (accoda il bilanciatore).
      expect(
        getClientIp(req({ 'x-forwarded-for': '203.0.113.9, 198.51.100.7, 10.1.0.4' })),
      ).toBe('198.51.100.7');
      expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.7, 10.1.0.4' }))).toBe(
        '198.51.100.7',
      );
    });

    it('TRUSTED_PROXY_HOPS=1: ruotare la voce più a sinistra non apre contatori nuovi', () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
      const keys = new Set<string>();
      for (let i = 1; i <= 12; i++) {
        keys.add(
          getClientIp(req({ 'x-forwarded-for': `203.0.113.${i}, 198.51.100.7, 10.1.0.4` })),
        );
      }
      expect([...keys]).toEqual(['198.51.100.7']);
    });

    it('TRUSTED_PROXY_HOPS=2: due proxy davanti all\'ingress', () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '2');
      expect(
        getClientIp(
          req({ 'x-forwarded-for': '203.0.113.9, 198.51.100.7, 172.16.0.2, 10.1.0.4' }),
        ),
      ).toBe('198.51.100.7');
    });

    it('meno voci del previsto: la prima (ingress che sostituisce l\'header)', () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '2');
      expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.7' }))).toBe('198.51.100.7');
      expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.7, 10.1.0.4' }))).toBe(
        '198.51.100.7',
      );
    });

    it('la porta accodata da alcuni application gateway non crea un contatore per connessione', () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
      expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.7:51234, 10.1.0.4' }))).toBe(
        '198.51.100.7',
      );
      expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.7:40001, 10.1.0.4' }))).toBe(
        '198.51.100.7',
      );
    });
  });

  describe('Application Load Balancer di Google Cloud (accoda client e proprio indirizzo)', () => {
    // Formato documentato: `<valore del client>,<client>,<indirizzo del
    // bilanciatore>`, senza spazi. Vale anche per l'ingress `gce` di GKE.
    const LB = '198.51.100.250';

    it('con il default 0 tutti finiscono nel contatore del bilanciatore', () => {
      expect(getClientIp(req({ 'x-forwarded-for': `203.0.113.50,${LB}` }))).toBe(LB);
      expect(getClientIp(req({ 'x-forwarded-for': `192.0.2.77,${LB}` }))).toBe(LB);
    });

    it('come ingress vale TRUSTED_PROXY_HOPS=1: la voce del client', () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
      expect(getClientIp(req({ 'x-forwarded-for': `203.0.113.50,${LB}` }))).toBe('203.0.113.50');
      expect(getClientIp(req({ 'x-forwarded-for': `192.0.2.77,${LB}` }))).toBe('192.0.2.77');
    });

    it('TRUSTED_PROXY_HOPS=1: i valori mandati dal client restano a sinistra', () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
      const keys = new Set<string>();
      for (let i = 1; i <= 12; i++) {
        keys.add(getClientIp(req({ 'x-forwarded-for': `10.9.0.${i},203.0.113.50,${LB}` })));
      }
      expect([...keys]).toEqual(['203.0.113.50']);
    });

    it('davanti a un ingress che accoda vale 2', () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '2');
      // client → bilanciatore (accoda client e sé stesso) → ingress (accoda
      // il proxy del bilanciatore da cui riceve la connessione).
      expect(
        getClientIp(req({ 'x-forwarded-for': `10.9.0.1,203.0.113.50,${LB}, 10.1.0.4` })),
      ).toBe('203.0.113.50');
    });
  });

  describe('un valore più alto della catena, con un ingress che accoda', () => {
    it('la chiave torna a essere quella scelta dal client', () => {
      // Nessun proxy davanti all'ingress: il valore giusto è 0. Con 1 (l'ingress
      // contato come in `trust proxy` di Express) si prende la voce inventata.
      vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
      const keys = new Set<string>();
      for (let i = 1; i <= 3; i++) {
        keys.add(getClientIp(req({ 'x-forwarded-for': `203.0.113.${i}, 192.0.2.50` })));
      }
      expect([...keys]).toEqual(['203.0.113.1', '203.0.113.2', '203.0.113.3']);
    });
  });

  describe('IPv6', () => {
    it('indirizzo nudo', () => {
      expect(getClientIp(req({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
    });

    it('maiuscole e minuscole danno la stessa chiave', () => {
      expect(getClientIp(req({ 'x-forwarded-for': '2001:DB8::ABCD' }))).toBe('2001:db8::abcd');
    });

    it('tra quadre, con o senza porta', () => {
      expect(getClientIp(req({ 'x-forwarded-for': '[2001:db8::1]:443' }))).toBe('2001:db8::1');
      expect(getClientIp(req({ 'x-forwarded-for': '[2001:db8::1]' }))).toBe('2001:db8::1');
    });

    it('un IPv6 nudo non ha porta: le ultime cifre fanno parte dell\'indirizzo', () => {
      expect(getClientIp(req({ 'x-forwarded-for': '2001:db8::1:443' }))).toBe('2001:db8::1:443');
    });

    it('IPv4 mappato in IPv6 torna IPv4', () => {
      expect(getClientIp(req({ 'x-forwarded-for': '::ffff:192.0.2.1' }))).toBe('192.0.2.1');
      expect(getClientIp(req({ 'x-forwarded-for': '::FFFF:192.0.2.1' }))).toBe('192.0.2.1');
    });

    it('voce IPv6 in una catena con IPv4', () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
      expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.9, 2001:db8::7, 10.1.0.4' }))).toBe(
        '2001:db8::7',
      );
    });
  });

  describe('valori non validi', () => {
    it.each([
      ['unknown'],
      ['_hidden'],
      ['not-an-ip'],
      ['example.org'],
      ['1.2.3.4.5'],
      ['256.1.1.1'],
      ['01.2.3.4'],
      ['1.2.3'],
      ['[1.2.3.4]'],
      ['[2001:db8::1'],
      ['<script>alert(1)</script>'],
      ['"192.0.2.1"'],
      [''],
      [' '],
    ])('la voce scelta %j dà "unknown", mai la stringa stessa', (entry) => {
      expect(getClientIp(req({ 'x-forwarded-for': `192.0.2.50, ${entry}` }))).toBe('unknown');
    });

    it('una voce valida a sinistra non salva una voce scelta non valida', () => {
      // Se si ripiegasse su un'altra voce, il client sceglierebbe la chiave.
      expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.9, garbage' }))).toBe('unknown');
    });

    it('virgole finali o vuote: la posizione conta da destra', () => {
      expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.9,' }))).toBe('unknown');
      expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.9,, 192.0.2.50' }))).toBe(
        '192.0.2.50',
      );
    });

    it('senza X-Forwarded-For: "unknown"', () => {
      expect(getClientIp(req())).toBe('unknown');
    });
  });

  describe('header che non si leggono', () => {
    it.each([
      ['x-real-ip', '203.0.113.9'],
      ['cf-connecting-ip', '203.0.113.9'],
      ['forwarded', 'for=203.0.113.9;proto=https'],
    ])('%s da solo non identifica il client', (name, value) => {
      expect(getClientIp(req({ [name]: value }))).toBe('unknown');
    });

    it('X-Real-IP inventato non prevale su X-Forwarded-For', () => {
      expect(
        getClientIp(req({ 'x-forwarded-for': '192.0.2.50', 'x-real-ip': '203.0.113.9' })),
      ).toBe('192.0.2.50');
    });
  });
});

describe('trustedProxyHops', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('default 0, non impostata o vuota', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', undefined);
    expect(trustedProxyHops()).toBe(0);
    vi.stubEnv('TRUSTED_PROXY_HOPS', '');
    expect(trustedProxyHops()).toBe(0);
  });

  it.each([
    ['0', 0],
    ['1', 1],
    [' 2 ', 2],
    ['10', 10],
  ])('%j → %i', (raw, hops) => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', raw);
    expect(trustedProxyHops()).toBe(hops);
  });

  it.each([['-1'], ['1.5'], ['two'], ['11'], ['1e1'], ['0x1'], ['999']])(
    '%j non è valido e vale 0',
    (raw) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.stubEnv('TRUSTED_PROXY_HOPS', raw);
      expect(trustedProxyHops()).toBe(0);
    },
  );

  it('con un valore non valido si usa la voce dell\'ingress', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('TRUSTED_PROXY_HOPS', 'tutti');
    expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.9, 192.0.2.50' }))).toBe('192.0.2.50');
  });
});

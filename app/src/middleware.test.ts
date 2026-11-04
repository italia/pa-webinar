// @vitest-environment node
/**
 * La guardia delle pagine: chi entra nell'area di amministrazione, quale lingua
 * si serve e quali intestazioni di sicurezza escono su ogni risposta. Il routing
 * delle lingue e' di next-intl: qui conta solo cio' che il middleware decide.
 */
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return { default: () => () => NextResponse.next() };
});

import middleware from './middleware';

const SEGRETO = 'segreto-di-prova-del-middleware-lungo-abbastanza';
const ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';

function richiesta(percorso: string, cookie: Record<string, string> = {}): NextRequest {
  const header = Object.entries(cookie)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('; ');
  return new NextRequest(new URL(percorso, 'http://localhost:3000'), {
    headers: header ? { cookie: header } : {},
  });
}

function sessione(role: string, opzioni: { segreto?: string; scadenza?: string } = {}) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(opzioni.scadenza ?? '1h')
    .sign(new TextEncoder().encode(opzioni.segreto ?? SEGRETO));
}

const alLogin = (r: Response, lingua = 'it') => {
  expect(r.status).toBe(307);
  expect(new URL(r.headers.get('location') ?? '').pathname).toBe(
    `/${lingua}/admin/login`
  );
};
const passa = (r: Response) => {
  expect(r.status).toBe(200);
  expect(r.headers.get('location')).toBeNull();
};

beforeEach(() => {
  process.env.APP_SECRET = SEGRETO;
});

describe('area di amministrazione', () => {
  it('senza sessione si va al login, nella lingua della pagina', async () => {
    alLogin(await middleware(richiesta('/it/admin')));
    alLogin(await middleware(richiesta('/it/admin/impostazioni')));
    alLogin(await middleware(richiesta('/en/admin/settings')), 'en');
  });

  it('le pagine per entrare restano aperte', async () => {
    passa(await middleware(richiesta('/it/admin/login')));
    passa(await middleware(richiesta('/en/admin/access')));
    passa(await middleware(richiesta('/it/admin/accesso')));
  });

  it('una sessione firmata di admin o di organizzatore entra', async () => {
    const admin = await sessione('admin');
    const organizzatore = await sessione('organizer');
    passa(await middleware(richiesta('/it/admin', { admin_session: admin })));
    passa(
      await middleware(richiesta('/it/admin/eventi', { admin_session: organizzatore }))
    );
  });

  it('non entra una sessione falsa, scaduta o con un altro ruolo', async () => {
    const altraChiave = await sessione('admin', {
      segreto: 'un-altro-segreto-altrettanto-lungo-abbastanza',
    });
    const scaduta = await sessione('admin', { scadenza: '-1m' });
    const partecipante = await sessione('participant');
    alLogin(await middleware(richiesta('/it/admin', { admin_session: altraChiave })));
    alLogin(await middleware(richiesta('/it/admin', { admin_session: scaduta })));
    alLogin(await middleware(richiesta('/it/admin', { admin_session: partecipante })));
    alLogin(await middleware(richiesta('/it/admin', { admin_session: 'non-un-token' })));
  });

  it('senza APP_SECRET nessuna sessione vale', async () => {
    const valida = await sessione('admin');
    delete process.env.APP_SECRET;
    alLogin(await middleware(richiesta('/it/admin', { admin_session: valida })));
  });

  it('il link di gestione apre la pagina dell’evento e la sua modifica', async () => {
    passa(await middleware(richiesta(`/it/admin/eventi/${ID}?token=${TOKEN}`)));
    passa(await middleware(richiesta(`/it/admin/eventi/${ID}/modifica?token=${TOKEN}`)));
    passa(await middleware(richiesta(`/en/admin/events/${ID}?token=${TOKEN}`)));
  });

  it('il token non apre altro: il wizard resta dietro la sessione', async () => {
    alLogin(await middleware(richiesta(`/it/admin/eventi/nuovo?token=${TOKEN}`)));
    alLogin(await middleware(richiesta(`/en/admin/events/new?token=${TOKEN}`)), 'en');
    alLogin(await middleware(richiesta(`/it/admin/impostazioni?token=${TOKEN}`)));
    alLogin(
      await middleware(richiesta(`/it/admin/eventi/${ID}/modifica/altro?token=${TOKEN}`))
    );
  });

  it('un token che non e’ un UUID non vale come link di gestione', async () => {
    alLogin(await middleware(richiesta(`/it/admin/eventi/${ID}?token=non-un-uuid`)));
    alLogin(await middleware(richiesta(`/it/admin/eventi/${ID}`)));
  });
});

describe('lingue attive', () => {
  const attive = { enabled_locales: JSON.stringify(['it', 'en']) };

  it('una lingua spenta rimanda alla predefinita, stesso percorso', async () => {
    const r = await middleware(richiesta('/de/veranstaltungen', attive));
    expect(r.status).toBe(307);
    expect(new URL(r.headers.get('location') ?? '').pathname).toBe('/it/veranstaltungen');
  });

  it('la predefinita dell’istanza vince su quella del prodotto', async () => {
    const r = await middleware(richiesta('/de/x', { ...attive, default_locale: 'en' }));
    expect(new URL(r.headers.get('location') ?? '').pathname).toBe('/en/x');
  });

  it('una predefinita sconosciuta non porta a una pagina inesistente', async () => {
    const r = await middleware(richiesta('/de/x', { ...attive, default_locale: 'xx' }));
    expect(new URL(r.headers.get('location') ?? '').pathname).toBe('/it/x');
  });

  it('un cookie guasto o senza lingue valide le lascia tutte accese', async () => {
    passa(await middleware(richiesta('/de/x', { enabled_locales: 'non-json' })));
    passa(
      await middleware(richiesta('/de/x', { enabled_locales: JSON.stringify(['xx']) }))
    );
  });
});

describe('intestazioni di sicurezza', () => {
  it('ogni pagina non si incornicia e dichiara la sua politica', async () => {
    const r = await middleware(richiesta('/it'));
    const csp = r.headers.get('content-security-policy') ?? '';
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('strict-transport-security')).toContain('includeSubDomains');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('il nonce cambia a ogni richiesta ed e’ quello della politica', async () => {
    const [a, b] = await Promise.all([
      middleware(richiesta('/it')),
      middleware(richiesta('/it')),
    ]);
    const nonce = a.headers.get('x-nonce') ?? '';
    expect(nonce).not.toBe('');
    expect(nonce).not.toBe(b.headers.get('x-nonce'));
    expect(a.headers.get('content-security-policy')).toContain(`'nonce-${nonce}'`);
  });

  it('anche l’area di amministrazione porta le intestazioni', async () => {
    const r = await middleware(
      richiesta('/it/admin', { admin_session: await sessione('admin') })
    );
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('WebAssembly solo nella sala', async () => {
    const sala = await middleware(richiesta('/it/eventi/prova/live'));
    const home = await middleware(richiesta('/it'));
    expect(sala.headers.get('content-security-policy')).toContain("'wasm-unsafe-eval'");
    expect(home.headers.get('content-security-policy')).not.toContain(
      "'wasm-unsafe-eval'"
    );
  });
});

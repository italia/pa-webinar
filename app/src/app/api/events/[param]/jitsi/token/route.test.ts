// @vitest-environment node
/**
 * Questa route decide CHI entra nella sala e con quali poteri: è l'unico punto
 * in cui la piattaforma firma un'identità che Jitsi poi crede sulla parola.
 * I test qui sotto fissano le decisioni (moderatore/relatore/ospite, evento
 * attivo o no, identità legata al browser che ha registrato), non la forma
 * della risposta.
 */
import { createHash } from 'crypto';

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';

import { encryptPII } from '@/lib/crypto/pii';
import { eventAccessCookieName, signEventAccess } from '@/lib/event-session';
import { readGravatarRef } from '@/lib/gravatar-ref';
import { invalidateSettingsCache } from '@/lib/settings';
import { prisma } from '@/lib/db';

import { POST } from './route';

// Il cookie `event_access` è letto via next/headers: qui lo serviamo da una
// mappa che ogni test riempie (vi.hoisted perché vi.mock viene issato in cima).
const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn(), update: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
    siteSetting: { upsert: vi.fn() },
  },
}));

const JWT_SECRET = 'test-secret-for-jitsi-token-route';
const JWT_ISSUER = 'pa-webinar-test';
const JWT_AUDIENCE = 'jitsi';
const APP_URL = 'https://webinar.example.gov.it';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const SLUG = 'evento-di-prova';
const ROOM = 'evt-evento-di-prova';
const PRIMARY_TOKEN = '22222222-2222-4222-8222-222222222222';
const GRANT_TOKEN = '33333333-3333-4333-8333-333333333333';
const REGISTRATION_ID = '44444444-4444-4444-8444-444444444444';
const ACCESS_TOKEN = 'accessToken-del-registrato';
const REGISTRANT_EMAIL = 'mario.rossi@example.com';
const REGISTRANT_MD5 = createHash('md5').update(REGISTRANT_EMAIL).digest('hex');

let encryptedName: string;
let encryptedEmail: string;

beforeAll(() => {
  // Importare la route tira dentro Next, che carica `app/.env`: fissiamo qui
  // tutto ciò che ci serve, altrimenti i valori di sviluppo (secret, issuer,
  // APP_SECRET troppo corto) deciderebbero l'esito dei test.
  process.env.JITSI_JWT_SECRET = JWT_SECRET;
  process.env.JITSI_JWT_ISSUER = JWT_ISSUER;
  process.env.JITSI_JWT_AUDIENCE = JWT_AUDIENCE;
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  // ≥32 byte, altrimenti tryGetAppSecret() torna null e il cookie firmato non
  // verrebbe MAI verificato: il ramo "proprietario del token" sparirebbe.
  process.env.APP_SECRET = 'test-app-secret-per-la-route-del-token-jitsi';
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;

  encryptedName = encryptPII('Mario Rossi');
  encryptedEmail = encryptPII(REGISTRANT_EMAIL);
});

type EventOverrides = Partial<{ status: string }>;

function eventRow(overrides: EventOverrides = {}) {
  return {
    id: EVENT_ID,
    slug: SLUG,
    jitsiRoomName: ROOM,
    status: 'LIVE',
    moderatorToken: PRIMARY_TOKEN,
    moderatorName: 'Moderatore',
    ...overrides,
  };
}

function registrationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REGISTRATION_ID,
    eventId: EVENT_ID,
    accessToken: ACCESS_TOKEN,
    displayName: encryptedName,
    email: encryptedEmail,
    joinedAt: null,
    ...overrides,
  };
}

function setGravatarEnabled(enabled: boolean) {
  vi.mocked(prisma.siteSetting.upsert).mockResolvedValue({
    id: 'singleton',
    gravatarEnabled: enabled,
  } as never);
  // La cache dei settings vive 60s a livello di modulo: senza questo il primo
  // valore letto varrebbe per tutto il file.
  invalidateSettingsCache();
}

// I rami ospite passano da un rate limit per-IP in-memory che sopravvive fra
// test: un IP diverso per chiamata tiene i test indipendenti dall'ordine.
let ipCounter = 0;

async function post(body: Record<string, unknown>): Promise<Response> {
  ipCounter += 1;
  const request = new Request(`http://localhost:3000/api/events/${SLUG}/jitsi/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.0.0.${ipCounter}`,
    },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as NextRequest, {
    params: Promise.resolve({ param: SLUG }),
  });
}

interface JitsiUser {
  name: string;
  displayName: string;
  id: string;
  avatar: string;
  affiliation: string;
  moderator: string;
}

async function minted(res: Response) {
  const body = (await res.json()) as { jwt: string; displayName: string; role: string };
  // Firma verificata davvero: un JWT che Prosody rifiuterebbe non fa entrare
  // nessuno, per quanto corretto sia il resto del payload.
  const { payload } = await jwtVerify(
    body.jwt,
    new TextEncoder().encode(JWT_SECRET),
    { issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
  );
  return {
    body,
    payload,
    user: (payload.context as { user: JitsiUser }).user,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  vi.mocked(prisma.event.findUnique).mockResolvedValue(eventRow() as never);
  vi.mocked(prisma.registration.update).mockResolvedValue({} as never);
  setGravatarEnabled(false);
});

// ── Grant da magic link (moderatore primario, co-moderatore, relatore) ──

describe('POST jitsi/token — grant da magic link', () => {
  it('un co-moderatore per-riga riceve i poteri di moderazione', async () => {
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue({
      id: 'grant-1',
      eventId: EVENT_ID,
      revokedAt: null,
      role: 'MODERATOR',
      name: encryptPII('Anna Bianchi'),
      email: null,
    } as never);

    const res = await post({ moderatorToken: GRANT_TOKEN });
    expect(res.status).toBe(200);

    const { body, payload, user } = await minted(res);
    expect(body.role).toBe('moderator');
    // Il nome della riga è cifrato a riposo: se arrivasse così com'è nel JWT,
    // in sala si vedrebbe il ciphertext.
    expect(body.displayName).toBe('Anna Bianchi');
    expect(payload.moderator).toBe(true);
    expect(payload.affiliation).toBe('owner');
    expect(user.moderator).toBe('true');
    expect(user.id.startsWith('mod-')).toBe(true);
  });

  it('un relatore (SPEAKER) entra SENZA poteri di moderazione', async () => {
    // I relatori parlano, non moderano: un JWT con moderator=true darebbe loro
    // mute-all, espulsioni e registrazione su Jitsi.
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue({
      id: 'grant-2',
      eventId: EVENT_ID,
      revokedAt: null,
      role: 'SPEAKER',
      name: encryptPII('Luca Neri'),
      email: null,
    } as never);

    const res = await post({ moderatorToken: GRANT_TOKEN });
    expect(res.status).toBe(200);

    const { body, payload, user } = await minted(res);
    expect(body.role).toBe('speaker');
    expect(body.displayName).toBe('Luca Neri');
    expect(payload.moderator).toBe(false);
    expect(payload.affiliation).toBe('member');
    expect(user.moderator).toBe('false');
  });

  it('il link primario CONDIVISO senza nome digitato non conia nulla', async () => {
    // Il token primario è uno solo per tutto il team: senza il nome digitato
    // ogni moderatore entrerebbe come "Moderatore" e in chat, lista
    // partecipanti e analytics collasserebbero in una sola identità.
    const res = await post({ moderatorToken: PRIMARY_TOKEN });

    // ValidationError → 422 (non 400: vedi lib/errors).
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; jwt?: string };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.jwt).toBeUndefined();
    // Nessun fallback silenzioso su event.moderatorName.
    expect(prisma.eventModerator.findUnique).not.toHaveBeenCalled();
  });

  it('il link primario con nome digitato conia sotto quel nome', async () => {
    const res = await post({
      moderatorToken: PRIMARY_TOKEN,
      displayNameOverride: '  Giulia Verdi  ',
    });
    expect(res.status).toBe(200);

    const { body, payload } = await minted(res);
    expect(body.displayName).toBe('Giulia Verdi');
    expect(body.role).toBe('moderator');
    expect(payload.moderator).toBe(true);
  });

  it('uno spazio non è un nome: il link condiviso lo rifiuta', async () => {
    // `"   ".trim()` è vuoto: senza il trim il client aggirerebbe il vincolo
    // con due spazi e tornerebbe l'identità unica.
    const res = await post({
      moderatorToken: PRIMARY_TOKEN,
      displayNameOverride: '    ',
    });
    expect(res.status).toBe(422);
  });

  it('un token grant non risolto non conia nulla', async () => {
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue(null as never);

    const res = await post({ moderatorToken: GRANT_TOKEN });
    expect(res.status).toBe(403);
  });
});

// ── accessToken di registrazione ──

describe('POST jitsi/token — accessToken di registrazione', () => {
  it("rifiuta un accessToken valido ma di un ALTRO evento", async () => {
    // Il token esiste (registrazione legittima altrove): senza il confronto
    // eventId, un iscritto a un evento entrerebbe in tutti gli altri.
    vi.mocked(prisma.registration.findUnique).mockResolvedValue(
      registrationRow({ eventId: '99999999-9999-4999-8999-999999999999' }) as never,
    );

    const res = await post({ accessToken: ACCESS_TOKEN });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; jwt?: string };
    expect(body.code).toBe('FORBIDDEN');
    expect(body.jwt).toBeUndefined();
    expect(prisma.registration.update).not.toHaveBeenCalled();
  });

  it('rifiuta un accessToken inesistente', async () => {
    vi.mocked(prisma.registration.findUnique).mockResolvedValue(null as never);

    const res = await post({ accessToken: 'token-inventato' });
    expect(res.status).toBe(403);
  });

  it('il browser che ha registrato entra come il registrato e segna joinedAt', async () => {
    vi.mocked(prisma.registration.findUnique).mockResolvedValue(
      registrationRow() as never,
    );
    cookieJar.set(
      eventAccessCookieName(EVENT_ID),
      await signEventAccess(EVENT_ID, ACCESS_TOKEN, 3600),
    );

    const res = await post({ accessToken: ACCESS_TOKEN });
    expect(res.status).toBe(200);

    const { body, payload, user } = await minted(res);
    expect(body.role).toBe('participant');
    expect(body.displayName).toBe('Mario Rossi');
    expect(payload.moderator).toBe(false);
    expect(user.id.startsWith(`reg-${REGISTRATION_ID}`)).toBe(true);
    expect(prisma.registration.update).toHaveBeenCalledTimes(1);
  });

  it('al rientro non riscrive joinedAt (la riconnessione non deve dipendere da una write)', async () => {
    vi.mocked(prisma.registration.findUnique).mockResolvedValue(
      registrationRow({ joinedAt: new Date('2026-07-22T09:00:00Z') }) as never,
    );
    cookieJar.set(
      eventAccessCookieName(EVENT_ID),
      await signEventAccess(EVENT_ID, ACCESS_TOKEN, 3600),
    );

    const res = await post({ accessToken: ACCESS_TOKEN });
    expect(res.status).toBe(200);
    expect(prisma.registration.update).not.toHaveBeenCalled();
  });

  it('un link INOLTRATO non presta l\'identità del registrato (F7)', async () => {
    // Chi apre il link di qualcun altro entra — il token condiviso autorizza
    // l'accesso — ma sotto il proprio nome e con un'identità ospite fresca:
    // mai nome, posto o consenso alla registrazione dell'iscritto.
    vi.mocked(prisma.registration.findUnique).mockResolvedValue(
      registrationRow() as never,
    );
    // Nessun cookie: il browser non è quello che ha registrato.

    const res = await post({
      accessToken: ACCESS_TOKEN,
      displayNameOverride: 'Passante Curioso',
    });
    expect(res.status).toBe(200);

    const { body, user } = await minted(res);
    expect(body.displayName).toBe('Passante Curioso');
    expect(user.name).toBe('Passante Curioso');
    expect(user.id.startsWith('guest-')).toBe(true);
    expect(JSON.stringify(user)).not.toContain('Mario Rossi');
    expect(JSON.stringify(user)).not.toContain(REGISTRATION_ID);
    // L'identità del registrato non viene toccata: nessun joinedAt.
    expect(prisma.registration.update).not.toHaveBeenCalled();
  });

  it('un link inoltrato senza nome digitato non conia nulla', async () => {
    vi.mocked(prisma.registration.findUnique).mockResolvedValue(
      registrationRow() as never,
    );

    const res = await post({ accessToken: ACCESS_TOKEN });
    expect(res.status).toBe(422);
  });

  it('il cookie di un ALTRO evento non prova il possesso del token', async () => {
    // Il cookie è firmato ma legato a un altro eventId: se passasse, basterebbe
    // un evento qualsiasi per rivendicare l'identità altrove.
    vi.mocked(prisma.registration.findUnique).mockResolvedValue(
      registrationRow() as never,
    );
    const otherEventId = '55555555-5555-4555-8555-555555555555';
    cookieJar.set(
      eventAccessCookieName(EVENT_ID),
      await signEventAccess(otherEventId, ACCESS_TOKEN, 3600),
    );

    const res = await post({ accessToken: ACCESS_TOKEN });
    expect(res.status).toBe(422); // cade nel ramo ospite: serve un nome digitato
  });
});

// ── Stato dell'evento ──

describe('POST jitsi/token — stato dell\'evento', () => {
  beforeEach(() => {
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue({
      id: 'grant-1',
      eventId: EVENT_ID,
      revokedAt: null,
      role: 'MODERATOR',
      name: encryptPII('Anna Bianchi'),
      email: null,
    } as never);
  });

  it.each(['PUBLISHED', 'LIVE'])('%s conia il token', async (status) => {
    // PUBLISHED è la finestra pre-avvio: il moderatore deve poter entrare
    // prima che l'evento passi LIVE, altrimenti nessuno lo apre mai.
    vi.mocked(prisma.event.findUnique).mockResolvedValue(eventRow({ status }) as never);

    const res = await post({ moderatorToken: GRANT_TOKEN });
    expect(res.status).toBe(200);
  });

  it.each(['DRAFT', 'PROVISIONING', 'IDLE', 'ENDED', 'ARCHIVED'])(
    '%s risponde 409 senza coniare',
    async (status) => {
      // Su PROVISIONING/IDLE il bridge non è pronto: un JWT qui scaricherebbe
      // l'utente su un JVB freddo invece di passare dalla schermata di attesa.
      vi.mocked(prisma.event.findUnique).mockResolvedValue(eventRow({ status }) as never);

      const res = await post({ moderatorToken: GRANT_TOKEN });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string; jwt?: string };
      expect(body.code).toBe('CONFLICT');
      expect(body.jwt).toBeUndefined();
      // Il controllo precede ogni risoluzione di identità.
      expect(prisma.eventModerator.findUnique).not.toHaveBeenCalled();
    },
  );

  it('evento inesistente: 404', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(null as never);

    const res = await post({ moderatorToken: GRANT_TOKEN });
    expect(res.status).toBe(404);
  });
});

// ── Ramo ospite ──

describe('POST jitsi/token — ramo ospite', () => {
  it('su LIVE conia un JWT da ospite, senza poteri', async () => {
    const res = await post({ guestName: 'Ospite Anonimo' });
    expect(res.status).toBe(200);

    const { body, payload, user } = await minted(res);
    expect(body.role).toBe('guest');
    expect(payload.moderator).toBe(false);
    expect(user.id.startsWith('guest-')).toBe(true);
    // 2h fisse: l'ospite non ha una registrazione da cui rigenerare il token.
    expect((payload.exp as number) - (payload.iat as number)).toBe(7200);
  });

  it('su PUBLISHED è chiuso (409): il ramo ospite esiste solo su LIVE', async () => {
    // Prima dell'avvio si passa dalla registrazione; l'ingresso senza nome né
    // consenso è concesso solo a evento in corso.
    vi.mocked(prisma.event.findUnique).mockResolvedValue(
      eventRow({ status: 'PUBLISHED' }) as never,
    );

    const res = await post({ guestName: 'Ospite Anonimo' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { jwt?: string };
    expect(body.jwt).toBeUndefined();
  });
});

// ── Gravatar (opt-in dell'amministratore) ──

describe('POST jitsi/token — Gravatar', () => {
  async function participantAvatar(): Promise<string> {
    vi.mocked(prisma.registration.findUnique).mockResolvedValue(
      registrationRow() as never,
    );
    cookieJar.set(
      eventAccessCookieName(EVENT_ID),
      await signEventAccess(EVENT_ID, ACCESS_TOKEN, 3600),
    );
    const res = await post({ accessToken: ACCESS_TOKEN });
    const { user } = await minted(res);
    return user.avatar;
  }

  it('spento: l\'avatar resta l\'SVG con le iniziali', async () => {
    setGravatarEnabled(false);
    expect(await participantAvatar()).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('acceso: l\'avatar passa dal NOSTRO proxy, senza email né hash in chiaro', async () => {
    // Jitsi diffonde context.user.avatar in presenza a tutta la sala: quello
    // che finisce nell'URL è pubblico verso il pubblico dell'evento (ADR-004).
    setGravatarEnabled(true);
    const avatar = await participantAvatar();

    expect(avatar.startsWith(`${APP_URL}/api/avatar?`)).toBe(true);
    expect(avatar).not.toContain('gravatar.com');
    expect(avatar).not.toContain('mario.rossi');
    expect(avatar).not.toContain('example.com');
    expect(avatar).not.toContain(REGISTRANT_MD5);

    const ref = new URL(avatar).searchParams.get('g');
    expect(ref).toBeTruthy();
    expect(readGravatarRef(ref!)).toBe(REGISTRANT_MD5);
  });

  it('acceso: vale anche per un co-moderatore con email', async () => {
    // Chi sta sullo schermo è soprattutto chi modera: se l'avatar valesse solo
    // per il pubblico, la funzione si vedrebbe dove conta meno.
    setGravatarEnabled(true);
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue({
      id: 'grant-1',
      eventId: EVENT_ID,
      revokedAt: null,
      role: 'MODERATOR',
      name: encryptPII('Anna Bianchi'),
      email: encryptPII('anna.bianchi@example.com'),
    } as never);

    const res = await post({ moderatorToken: GRANT_TOKEN });
    const { user } = await minted(res);
    expect(user.avatar.startsWith(`${APP_URL}/api/avatar?`)).toBe(true);
    expect(user.avatar).not.toContain('anna.bianchi');
  });

  it('acceso: il link primario condiviso resta senza Gravatar', async () => {
    // Nessuna persona dietro un token di team: niente email, niente avatar
    // di qualcun altro addosso a chiunque lo apra.
    setGravatarEnabled(true);

    const res = await post({
      moderatorToken: PRIMARY_TOKEN,
      displayNameOverride: 'Giulia Verdi',
    });
    const { user } = await minted(res);
    expect(user.avatar).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});

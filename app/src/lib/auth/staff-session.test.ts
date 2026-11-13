// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { SignJWT } from 'jose';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const findUnique = vi.fn();
const eventCount = vi.fn();
const recordingFindUnique = vi.fn();
const speakerFindUnique = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    staffAccount: { findUnique: (...a: unknown[]) => findUnique(...a) },
    event: { count: (...a: unknown[]) => eventCount(...a) },
    recording: { findUnique: (...a: unknown[]) => recordingFindUnique(...a) },
    speaker: { findUnique: (...a: unknown[]) => speakerFindUnique(...a) },
  },
}));
vi.mock('react', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // Senza un renderer React `cache` non memorizza nulla: qui basta la funzione.
  cache: <T,>(fn: T) => fn,
}));

const decifra = vi.hoisted(() => ({ fn: (v: string | null) => (v ? `chiaro:${v}` : null) as string | null }));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string | null) => decifra.fn(v) }));

import {
  eventScope,
  getStaffSession,
  staffPerIntestazione,
  isEventManager,
  puoGestire,
  requireAdmin,
  requireEventManager,
  requireRecordingManager,
  requireSpeakerManager,
  requireStaff,
  signStaffSession,
  type StaffSession,
} from './staff-session';

const admin: StaffSession = { role: 'admin', accountId: null };
const org: StaffSession = { role: 'organizer', accountId: 'a1', emailHash: 'hash-a1' };

describe('chi gestisce un evento (ADR-014)', () => {
  it('il filtro sugli elenchi: i propri eventi e quelli in cui si è organizzatori', () => {
    expect(eventScope(admin)).toEqual({});
    expect(eventScope(org)).toEqual({
      AND: [
        {
          OR: [
            { createdById: 'a1' },
            { additionalMods: { some: { organizer: true, revokedAt: null, emailHash: 'hash-a1' } } },
          ],
        },
      ],
    });
  });

  it('il filtro non si perde se chi lo usa aggiunge una sua ricerca', () => {
    // Una rotta con una ricerca assegna `where.OR` dopo aver sparso il filtro:
    // la regola sta in `AND` e resta.
    const where: Record<string, unknown> = { eventType: 'INSTANT', ...eventScope(org) };
    where.OR = [{ slug: { contains: 'x' } }];
    expect(where.AND).toEqual(eventScope(org).AND);
  });

  it('il singolo evento segue la stessa regola', async () => {
    eventCount.mockReset();
    eventCount.mockResolvedValueOnce(1);
    const ID = '11111111-2222-4333-8444-555555555555';
    expect(await puoGestire(org, ID)).toBe(true);
    expect(eventCount).toHaveBeenCalledWith({ where: { id: ID, ...eventScope(org) } });
    eventCount.mockResolvedValueOnce(0);
    expect(await puoGestire(org, ID)).toBe(false);
    // L'admin non interroga nulla; un id malformato non è di nessuno.
    expect(await puoGestire(admin, ID)).toBe(true);
    expect(await puoGestire(org, 'non-un-id')).toBe(false);
    expect(eventCount).toHaveBeenCalledTimes(2);
  });
});

describe('la sessione rilegge l’account (ADR-014)', () => {
  const SECRET = 'x'.repeat(40);
  const ID = '11111111-2222-4333-8444-555555555555';
  const cookiesCon = (token: string) =>
    ({ get: (n: string) => (n === 'admin_session' ? { value: token } : undefined) }) as never;

  beforeEach(() => {
    process.env.APP_SECRET = SECRET;
    findUnique.mockReset();
  });

  it('la chiave dell’istanza è un admin senza account', async () => {
    const token = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    expect(await getStaffSession(cookiesCon(token))).toEqual({ role: 'admin', accountId: null });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('un account amministratore è admin con il suo nome', async () => {
    findUnique.mockResolvedValue({ id: ID, active: true, role: 'ADMIN' });
    const token = await signStaffSession({ id: ID, role: 'ADMIN' });
    expect(await getStaffSession(cookiesCon(token))).toEqual({ role: 'admin', accountId: ID });
  });

  it('il ruolo viene dall’account, non dal token: un admin declassato è organizzatore', async () => {
    findUnique.mockResolvedValue({ id: ID, active: true, role: 'ORGANIZER', emailHash: 'hash-x' });
    const token = await signStaffSession({ id: ID, role: 'ADMIN' });
    expect(await getStaffSession(cookiesCon(token))).toEqual({
      role: 'organizer',
      accountId: ID,
      emailHash: 'hash-x',
    });
  });

  it('un account disattivato non ha sessione, qualunque sia il token', async () => {
    findUnique.mockResolvedValue({ id: ID, active: false, role: 'ADMIN' });
    const token = await signStaffSession({ id: ID, role: 'ADMIN' });
    expect(await getStaffSession(cookiesCon(token))).toBeNull();
  });
});

describe('lo staff dell’evento, su una rotta aperta anche al link', () => {
  const SECRET = 'x'.repeat(40);
  const ID = '11111111-2222-4333-8444-555555555555';
  const EVENTO = '66666666-7777-4888-8999-000000000000';
  const cookiesCon = (token: string | null) =>
    ({
      get: (n: string) => (n === 'admin_session' && token ? { value: token } : undefined),
    }) as never;

  beforeEach(() => {
    process.env.APP_SECRET = SECRET;
    findUnique.mockReset();
    eventCount.mockReset();
  });

  it('senza sessione, o con una che non gestisce l’evento: no, senza rifiutare', async () => {
    expect(await isEventManager(cookiesCon(null), EVENTO)).toBe(false);
    findUnique.mockResolvedValue({ id: ID, active: true, role: 'ORGANIZER', emailHash: 'h' });
    eventCount.mockResolvedValueOnce(0);
    const token = await signStaffSession({ id: ID, role: 'ORGANIZER' });
    expect(await isEventManager(cookiesCon(token), EVENTO)).toBe(false);
  });

  it('chi lo gestisce: sì', async () => {
    findUnique.mockResolvedValue({ id: ID, active: true, role: 'ORGANIZER', emailHash: 'h' });
    eventCount.mockResolvedValueOnce(1);
    const token = await signStaffSession({ id: ID, role: 'ORGANIZER' });
    expect(await isEventManager(cookiesCon(token), EVENTO)).toBe(true);
  });
});

describe('chi e\' entrato, per l\'intestazione', () => {
  const SECRET = 'x'.repeat(40);
  const ID = '11111111-2222-4333-8444-555555555555';
  const cookiesCon = (token: string) =>
    ({ get: (n: string) => (n === 'admin_session' ? { value: token } : undefined) }) as never;

  beforeEach(() => {
    process.env.APP_SECRET = SECRET;
    findUnique.mockReset();
    decifra.fn = (v) => (v ? `chiaro:${v}` : null);
  });

  it('la chiave dell\'istanza non ha nome; un account ha il suo, letto una volta', async () => {
    const chiave = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    expect(await staffPerIntestazione(cookiesCon(chiave))).toEqual({ ruolo: 'admin', nome: null });

    findUnique.mockResolvedValue({ id: ID, active: true, role: 'ORGANIZER', emailHash: 'h', name: 'cifrato' });
    const token = await signStaffSession({ id: ID, role: 'ORGANIZER' });
    expect(await staffPerIntestazione(cookiesCon(token))).toEqual({ ruolo: 'organizer', nome: 'chiaro:cifrato' });
  });

  it('una chiave PII guasta non rompe la pagina: resta il ruolo, senza nome', async () => {
    decifra.fn = () => {
      throw new Error('PII key');
    };
    findUnique.mockResolvedValue({ id: ID, active: true, role: 'ADMIN', emailHash: 'h', name: 'cifrato' });
    const token = await signStaffSession({ id: ID, role: 'ADMIN' });
    expect(await staffPerIntestazione(cookiesCon(token))).toEqual({ ruolo: 'admin', nome: null });
  });
});

describe('le guardie delle rotte dello staff', () => {
  const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
  const ORG_ID = '22222222-2222-4222-8222-222222222222';
  const RISORSA = '33333333-3333-4333-8333-333333333333';
  const chiave = new TextEncoder().encode('segreto-di-prova-lungo-almeno-trentadue-byte');

  const biscotti = (token?: string) =>
    ({ get: () => (token ? { value: token } : undefined) }) as unknown as Parameters<
      typeof requireStaff
    >[0];
  const token = (corpo: Record<string, unknown>, sub?: string, firma = chiave) => {
    const jwt = new SignJWT(corpo).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h');
    return (sub ? jwt.setSubject(sub) : jwt).sign(firma);
  };
  const conAccount = (id: string, role: 'ADMIN' | 'ORGANIZER') =>
    findUnique.mockResolvedValue({ id, active: true, role, emailHash: 'hash', name: 'n' });

  beforeEach(() => {
    process.env.APP_SECRET = 'segreto-di-prova-lungo-almeno-trentadue-byte';
    vi.clearAllMocks();
  });

  it('senza sessione tutte rispondono 401', async () => {
    await expect(requireStaff(biscotti())).rejects.toMatchObject({ statusCode: 401 });
    await expect(requireAdmin(biscotti())).rejects.toMatchObject({ statusCode: 401 });
    await expect(requireEventManager(biscotti(), RISORSA)).rejects.toMatchObject({ statusCode: 401 });
    await expect(requireRecordingManager(biscotti(), RISORSA)).rejects.toMatchObject({ statusCode: 401 });
    await expect(requireSpeakerManager(biscotti(), RISORSA)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('un token firmato con un altro segreto non e’ una sessione', async () => {
    const falso = await token({ role: 'admin' }, undefined, new TextEncoder().encode('x'.repeat(44)));
    await expect(getStaffSession(biscotti(falso))).resolves.toBeNull();
  });

  it('senza account, un ruolo diverso da admin non vale nulla', async () => {
    await expect(getStaffSession(biscotti(await token({ role: 'organizer' })))).resolves.toBeNull();
  });

  it('un ruolo sconosciuto o un soggetto malformato non leggono l’account', async () => {
    await expect(getStaffSession(biscotti(await token({ role: 'x' }, ORG_ID)))).resolves.toBeNull();
    await expect(getStaffSession(biscotti(await token({ role: 'admin' }, 'non-uuid')))).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('senza APP_SECRET non c’e’ sessione', async () => {
    const valido = await token({ role: 'admin' });
    delete process.env.APP_SECRET;
    await expect(getStaffSession(biscotti(valido))).resolves.toBeNull();
  });

  it('l’organizzatore non passa dove serve l’amministratore', async () => {
    conAccount(ORG_ID, 'ORGANIZER');
    await expect(
      requireAdmin(biscotti(await token({ role: 'admin' }, ORG_ID))),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('un identificativo malformato e’ 400 per tutti, prima della sessione', async () => {
    await expect(requireEventManager(biscotti(), 'non-uuid')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('l’evento altrui e quello inesistente rispondono allo stesso modo', async () => {
    conAccount(ORG_ID, 'ORGANIZER');
    eventCount.mockResolvedValue(0);
    await expect(
      requireEventManager(biscotti(await token({ role: 'organizer' }, ORG_ID)), RISORSA),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('l’amministratore gestisce qualunque registrazione e relatore, senza letture', async () => {
    conAccount(ADMIN_ID, 'ADMIN');
    const sessione = biscotti(await token({ role: 'admin' }, ADMIN_ID));
    await expect(requireRecordingManager(sessione, RISORSA)).resolves.toMatchObject({ role: 'admin' });
    await expect(requireSpeakerManager(sessione, RISORSA)).resolves.toMatchObject({ role: 'admin' });
    expect(recordingFindUnique).not.toHaveBeenCalled();
    expect(speakerFindUnique).not.toHaveBeenCalled();
  });

  it('l’organizzatore gestisce le registrazioni dei suoi eventi, non le altre', async () => {
    conAccount(ORG_ID, 'ORGANIZER');
    const sessione = biscotti(await token({ role: 'organizer' }, ORG_ID));
    recordingFindUnique.mockResolvedValue({ eventId: RISORSA });
    eventCount.mockResolvedValue(1);
    await expect(requireRecordingManager(sessione, RISORSA)).resolves.toMatchObject({ role: 'organizer' });
    eventCount.mockResolvedValue(0);
    await expect(requireRecordingManager(sessione, RISORSA)).rejects.toMatchObject({ statusCode: 403 });
    recordingFindUnique.mockResolvedValue(null);
    await expect(requireRecordingManager(sessione, RISORSA)).rejects.toMatchObject({ statusCode: 403 });
    await expect(requireRecordingManager(sessione, 'non-uuid')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('lo stesso per i relatori di una registrazione', async () => {
    conAccount(ORG_ID, 'ORGANIZER');
    const sessione = biscotti(await token({ role: 'organizer' }, ORG_ID));
    speakerFindUnique.mockResolvedValue({ recording: { eventId: RISORSA } });
    eventCount.mockResolvedValue(1);
    await expect(requireSpeakerManager(sessione, RISORSA)).resolves.toMatchObject({ role: 'organizer' });
    eventCount.mockResolvedValue(0);
    await expect(requireSpeakerManager(sessione, RISORSA)).rejects.toMatchObject({ statusCode: 403 });
    speakerFindUnique.mockResolvedValue(null);
    await expect(requireSpeakerManager(sessione, RISORSA)).rejects.toMatchObject({ statusCode: 403 });
    await expect(requireSpeakerManager(sessione, 'non-uuid')).rejects.toMatchObject({ statusCode: 403 });
  });
});

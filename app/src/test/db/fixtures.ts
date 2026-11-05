import { randomUUID } from 'node:crypto';

import type { Prisma, StaffRole } from '@prisma/client';

import { signStaffSession } from '@/lib/auth/staff-session';
import { encryptPII, hashEmail } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { invalidateSettingsCache } from '@/lib/settings';

import { biscotti } from './biscotti';

let tabelle: string[] | undefined;

/**
 * Ogni prova parte da tabelle vuote, comprese le righe scritte dalle migrazioni.
 * `DELETE` e non `TRUNCATE`, che qui costerebbe un secondo a prova. Il ruolo
 * `replica` spegne i vincoli per la durata della transazione, cosi' l'ordine
 * delle tabelle non conta: l'utente del database di prova deve essere superuser,
 * come quello creato dall'immagine ufficiale di PostgreSQL.
 */
export async function svuotaDatabase(): Promise<void> {
  tabelle ??= (
    await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  ).map((t) => t.tablename);
  await prisma.$transaction([
    prisma.$executeRawUnsafe('SET LOCAL session_replication_role = replica'),
    ...tabelle.map((t) => prisma.$executeRawUnsafe(`DELETE FROM "${t}"`)),
  ]);
  invalidateSettingsCache();
  biscotti.clear();
}

export function creaEvento(campi: Partial<Prisma.EventUncheckedCreateInput> = {}) {
  const id = randomUUID();
  return prisma.event.create({
    data: {
      slug: `evento-${id}`,
      jitsiRoomName: `stanza-${id}`,
      moderatorToken: randomUUID(),
      startsAt: new Date(Date.now() - 3_600_000),
      endsAt: new Date(Date.now() + 3_600_000),
      title: { it: 'Evento di prova' },
      status: 'LIVE',
      ...campi,
    },
  });
}

export function creaIscrizione(eventId: string) {
  const email = `${randomUUID()}@example.org`;
  return prisma.registration.create({
    data: {
      eventId,
      displayName: encryptPII('Persona Iscritta'),
      email: encryptPII(email),
      emailHash: hashEmail(email),
      consentGiven: true,
      consentTimestamp: new Date(),
      accessToken: randomUUID(),
    },
  });
}

/** Una sessione di chiamata e, se serve, la registrazione che ne nasce. */
export async function creaSessione(
  eventId: string,
  campi: Partial<Prisma.CallSessionUncheckedCreateInput> = {}
) {
  return prisma.callSession.create({
    data: {
      eventId,
      jitsiRoomName: `stanza-${randomUUID()}`,
      startedAt: new Date(Date.now() - 1_800_000),
      ...campi,
    },
  });
}

export async function creaRegistrazione(
  eventId: string,
  status: Prisma.RecordingUncheckedCreateInput['status'] = 'READY'
) {
  const sessione = await creaSessione(eventId);
  return prisma.recording.create({
    data: {
      callSessionId: sessione.id,
      eventId,
      blobKey: `recordings/${randomUUID()}.mp4`,
      status,
    },
  });
}

export function creaLavoro(
  recordingId: string,
  status: Prisma.PostprodJobUncheckedCreateInput['status']
) {
  return prisma.postprodJob.create({
    data: {
      recordingId,
      kind: 'TRANSCRIBE',
      payload: {},
      idempotencyKey: randomUUID(),
      status,
    },
  });
}

/** Un account dello staff con la sua sessione: la prossima richiesta arriva da lui. */
export async function entraCome(role: StaffRole) {
  const email = `${randomUUID()}@example.org`;
  const account = await prisma.staffAccount.create({
    data: {
      email: encryptPII(email),
      emailHash: hashEmail(email),
      name: encryptPII('Persona dello staff'),
      role,
    },
  });
  biscotti.set('admin_session', await signStaffSession(account));
  return account;
}

export function esci(): void {
  biscotti.delete('admin_session');
}

export function richiesta(
  url: string,
  metodo = 'GET',
  corpo?: unknown,
  token?: string
): Request {
  return new Request(`http://localhost${url}`, {
    method: metodo,
    headers: {
      ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

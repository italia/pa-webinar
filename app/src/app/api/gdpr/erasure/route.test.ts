// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La cancellazione (art. 17) deve togliere tutto cio' che appartiene alla
 * persona, non solo le iscrizioni: la voce di rubrica, gli inviti, e le righe
 * che puntano l'iscrizione con onDelete SetNull o non la puntano affatto
 * (feedback, risposte ai questionari, chat, email accodate). Cancellare solo
 * le iscrizioni lasciava nome e messaggi di chi aveva chiesto di sparire.
 */
const tx = {
  eventFeedback: { deleteMany: vi.fn() },
  questionnaireResponse: { deleteMany: vi.fn() },
  chatMessage: { deleteMany: vi.fn() },
  wordCloudSubmission: { deleteMany: vi.fn() },
  chatMessageReaction: { deleteMany: vi.fn() },
  captionSegment: { deleteMany: vi.fn() },
  roomOccupant: { deleteMany: vi.fn() },
  registration: { deleteMany: vi.fn() },
  postprodArtifact: { findMany: vi.fn() },
  recordingConsent: { deleteMany: vi.fn() },
  multitrackConsent: { deleteMany: vi.fn() },
  $executeRaw: vi.fn(),
};
const invalidate = vi.hoisted(() => vi.fn());
const prove = vi.hoisted(() => ({
  conservaProve: vi.fn(),
  tipiDelleProveEsistenti: vi.fn(),
  togliNomeDalleProve: vi.fn(),
  togliNomeDelleIscrizioni: vi.fn(),
}));
vi.mock('@/lib/gdpr/retained-consent-proofs', () => prove);
vi.mock('@/lib/auth/moderator', () => ({ invalidateModeratorCache: invalidate }));
vi.mock('@/lib/db', () => ({
  prisma: {
    person: { deleteMany: vi.fn() },
    eventInvitation: { deleteMany: vi.fn() },
    eventModerator: { deleteMany: vi.fn(), findMany: vi.fn() },
    eventPersonPhoto: { deleteMany: vi.fn() },
    profilePhoto: { deleteMany: vi.fn() },
    registration: { findMany: vi.fn() },
    chatMessage: { findMany: vi.fn() },
    gdprAuditLog: { create: vi.fn() },
    retainedConsentProof: { count: vi.fn() },
    staffAccount: { findUnique: vi.fn() },
    recordingConsent: { findMany: vi.fn() },
    multitrackConsent: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/azure/blob-storage', () => ({
  isAzureConfigured: () => true,
  deleteBlob: vi.fn(async () => true),
}));
vi.mock('@/lib/gdpr/request-token', () => ({
  verifyGdprToken: (token: string) => (token === 'valido' ? { emailHash: 'h'.repeat(64) } : null),
}));

import { deleteBlob } from '@/lib/azure/blob-storage';
import { prisma } from '@/lib/db';

import { POST } from './route';

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  person: { deleteMany: Fn };
  eventInvitation: { deleteMany: Fn };
  eventModerator: { deleteMany: Fn; findMany: Fn };
  eventPersonPhoto: { deleteMany: Fn };
  profilePhoto: { deleteMany: Fn };
  registration: { findMany: Fn };
  chatMessage: { findMany: Fn };
  gdprAuditLog: { create: Fn };
  retainedConsentProof: { count: Fn };
  staffAccount: { findUnique: Fn };
  recordingConsent: { findMany: Fn };
  multitrackConsent: { findMany: Fn };
  $transaction: Fn;
};

let ip = 0;
function req(token: string): Request {
  ip += 1;
  return new Request(`https://portale.example.test/api/gdpr/erasure?t=${token}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': `203.0.113.${ip}` },
  });
}
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  db.person.deleteMany.mockResolvedValue({ count: 1 });
  db.eventInvitation.deleteMany.mockResolvedValue({ count: 2 });
  db.eventModerator.deleteMany.mockResolvedValue({ count: 1 });
  db.eventModerator.findMany.mockResolvedValue([{ id: 'grant-1', eventId: 'evt-1', token: 'tok-1', photoId: null }]);
  tx.recordingConsent.deleteMany.mockResolvedValue({ count: 1 });
  tx.multitrackConsent.deleteMany.mockResolvedValue({ count: 1 });
  db.multitrackConsent.findMany.mockResolvedValue([]);
  prove.conservaProve.mockResolvedValue(0);
  prove.tipiDelleProveEsistenti.mockResolvedValue([]);
  prove.togliNomeDalleProve.mockResolvedValue(new Map());
  prove.togliNomeDelleIscrizioni.mockResolvedValue(0);
  db.staffAccount.findUnique.mockResolvedValue(null);
  db.recordingConsent.findMany.mockResolvedValue([]);
  db.retainedConsentProof.count.mockResolvedValue(0);
  db.eventPersonPhoto.deleteMany.mockResolvedValue({ count: 0 });
  db.profilePhoto.deleteMany.mockResolvedValue({ count: 1 });
  db.chatMessage.findMany.mockResolvedValue([]);
  db.gdprAuditLog.create.mockResolvedValue({});
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  tx.eventFeedback.deleteMany.mockResolvedValue({ count: 1 });
  tx.questionnaireResponse.deleteMany.mockResolvedValue({ count: 1 });
  tx.chatMessage.deleteMany.mockResolvedValue({ count: 3 });
  tx.wordCloudSubmission.deleteMany.mockResolvedValue({ count: 2 });
  tx.chatMessageReaction.deleteMany.mockResolvedValue({ count: 0 });
  tx.captionSegment.deleteMany.mockResolvedValue({ count: 0 });
  tx.roomOccupant.deleteMany.mockResolvedValue({ count: 0 });
  tx.registration.deleteMany.mockResolvedValue({ count: 1 });
  tx.postprodArtifact.findMany.mockResolvedValue([]);
  tx.$executeRaw.mockResolvedValue(2);
});

describe('POST /api/gdpr/erasure', () => {
  it('deletes the address-book entry together with the registrations', async () => {
    db.registration.findMany.mockResolvedValue([{ id: 'r1', eventId: 'e1' }]);
    const res = await POST(req('valido') as never, ctx as never);
    expect(res.status).toBe(200);
    expect(db.person.deleteMany).toHaveBeenCalledWith({ where: { emailHash: 'h'.repeat(64) } });
    expect(await res.json()).toEqual({
      ok: true,
      deleted: 1,
      addressBookDeleted: true,
      invitationsDeleted: 2,
      grantsDeleted: 1,
      grantPhotosDeleted: 0,
      profilePhotoDeleted: true,
      feedbackDeleted: 1,
      questionnaireResponsesDeleted: 1,
      chatMessagesDeleted: 3,
      outboxRowsDeleted: 2,
      consentProofsKept: 0,
    });
  });

  it('deletes what points at the registration without a cascade', async () => {
    db.registration.findMany.mockResolvedValue([
      { id: 'r1', eventId: 'e1' },
      { id: 'r2', eventId: 'e2' },
    ]);
    await POST(req('valido') as never, ctx as never);
    const ids = { in: ['r1', 'r2'] };
    expect(tx.eventFeedback.deleteMany).toHaveBeenCalledWith({ where: { registrationId: ids } });
    expect(tx.questionnaireResponse.deleteMany).toHaveBeenCalledWith({
      where: { registrationId: ids },
    });
    expect(tx.chatMessage.deleteMany).toHaveBeenCalledWith({
      where: { senderId: { in: ['reg-r1', 'reg-r2'] } },
    });
    expect(tx.chatMessageReaction.deleteMany).toHaveBeenCalledWith({
      where: { senderId: { in: ['reg-r1', 'reg-r2'] } },
    });
    // Le frasi dei sottotitoli e i posti in sala: il posto e' reg-<id>-<suffisso>.
    const postiInSala = { OR: [{ seatId: { startsWith: 'reg-r1-' } }, { seatId: { startsWith: 'reg-r2-' } }] };
    expect(tx.captionSegment.deleteMany).toHaveBeenCalledWith({ where: postiInSala });
    // E dalla trascrizione gia' costruita dai sottotitoli degli eventi della persona.
    expect(tx.postprodArtifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ modelId: 'live-captions', recording: { eventId: { in: ['e1', 'e2'] } } }),
      }),
    );
    expect(tx.roomOccupant.deleteMany).toHaveBeenCalledWith({ where: postiInSala });
    // Le parole di «In una parola» non hanno una chiave verso l'iscrizione:
    // la cascata non le porta via, e dopo la conservazione restano.
    expect(tx.wordCloudSubmission.deleteMany).toHaveBeenCalledWith({ where: { registrationId: ids } });
    // Il lock dell'evento della concessione, quelli delle iscrizioni, poi le
    // email accodate.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(4);
    const sql = (n: number) => (tx.$executeRaw.mock.calls[n]![0] as TemplateStringsArray).join('?');
    expect(sql(0)).toContain('pg_advisory_xact_lock');
    expect(sql(1)).toContain('pg_advisory_xact_lock');
    expect(sql(2)).toContain('pg_advisory_xact_lock');
    expect(sql(3)).toContain('DELETE FROM email_outbox');
    expect(tx.registration.deleteMany).toHaveBeenCalledWith({ where: { id: ids } });
    expect(db.gdprAuditLog.create).toHaveBeenCalledTimes(2);
  });

  it('deletes the files attached to the deleted chat messages', async () => {
    db.registration.findMany.mockResolvedValue([{ id: 'r1', eventId: 'e1' }]);
    db.chatMessage.findMany.mockResolvedValue([{ attachmentBlobPath: 'assets/chat/a.pdf' }]);
    await POST(req('valido') as never, ctx as never);
    expect(deleteBlob).toHaveBeenCalledWith('assets/chat/a.pdf');
  });

  it('reports the attachment files that storage failed to delete', async () => {
    db.registration.findMany.mockResolvedValue([{ id: 'r1', eventId: 'e1' }]);
    db.chatMessage.findMany.mockResolvedValue([{ attachmentBlobPath: 'assets/chat/a.pdf' }]);
    vi.mocked(deleteBlob).mockRejectedValueOnce(new Error('storage down'));
    const errore = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(req('valido') as never, ctx as never);
    expect(await res.json()).toMatchObject({ ok: true, attachmentFilesNotDeleted: 1 });
    expect(errore).toHaveBeenCalled();
    errore.mockRestore();
  });

  it('deletes address-book entry and invitations even when no registration is left', async () => {
    db.registration.findMany.mockResolvedValue([]);
    const res = await POST(req('valido') as never, ctx as never);
    expect(db.person.deleteMany).toHaveBeenCalled();
    expect(db.eventInvitation.deleteMany).toHaveBeenCalledWith({
      where: { emailHash: 'h'.repeat(64) },
    });
    expect(tx.registration.deleteMany).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      ok: true,
      deleted: 0,
      addressBookDeleted: true,
      invitationsDeleted: 2,
      grantsDeleted: 1,
      grantPhotosDeleted: 0,
      profilePhotoDeleted: true,
      consentProofsKept: 0,
    });
    // Le concessioni nominali con lo stesso indirizzo vanno via anche loro, e
    // il loro link smette subito di valere.
    expect(db.eventModerator.deleteMany).toHaveBeenCalledWith({ where: { emailHash: 'h'.repeat(64) } });
    // Le prove del consenso date con quelle concessioni vanno via con loro.
    const scelte = {
      where: {
        eventId: { in: ['evt-1'] },
        OR: [{ emailHash: 'h'.repeat(64) }, { eventModeratorId: { in: ['grant-1'] } }],
      },
    };
    expect(tx.recordingConsent.deleteMany).toHaveBeenCalledWith(scelte);
    expect(tx.multitrackConsent.deleteMany).toHaveBeenCalledWith(scelte);
    expect(invalidate).toHaveBeenCalledWith('evt-1', 'tok-1');
    // La foto e' legata all'email: va via anche senza iscrizioni.
    expect(db.profilePhoto.deleteMany).toHaveBeenCalledWith({ where: { emailHash: 'h'.repeat(64) } });
  });

  it('deletes the photos of the erased grants that no other event uses', async () => {
    db.registration.findMany.mockResolvedValue([]);
    db.eventModerator.findMany.mockResolvedValue([
      { eventId: 'evt-1', token: 'tok-1', photoId: 'foto-1' },
      { eventId: 'evt-2', token: 'tok-2', photoId: null },
    ]);
    db.eventPersonPhoto.deleteMany.mockResolvedValue({ count: 1 });
    const res = await POST(req('valido') as never, ctx as never);
    // Dopo le concessioni, e solo se nessun altro le usa.
    expect(db.eventPersonPhoto.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['foto-1'] }, leadOf: { none: {} }, grants: { none: {} } },
    });
    expect(db.eventModerator.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.eventPersonPhoto.deleteMany.mock.invocationCallOrder[0]!,
    );
    expect(await res.json()).toMatchObject({ grantsDeleted: 1, grantPhotosDeleted: 1 });
  });

  it('copies the proofs of a grant in the transaction that deletes them, before deleting', async () => {
    db.registration.findMany.mockResolvedValue([]);
    prove.tipiDelleProveEsistenti.mockResolvedValue(['recording', 'transcription']);
    prove.conservaProve.mockResolvedValue(1);
    db.retainedConsentProof.count.mockResolvedValue(1);

    const res = await POST(req('valido') as never, ctx as never);

    expect(prove.conservaProve).toHaveBeenCalledWith(tx, {
      eventId: 'evt-1',
      tipi: ['recording', 'transcription'],
      grantIds: ['grant-1'],
      staffAccountIds: [],
      emailHash: 'h'.repeat(64),
      senzaNome: true,
      adesso: expect.any(Date),
    });
    expect(prove.conservaProve.mock.invocationCallOrder[0]).toBeLessThan(
      tx.recordingConsent.deleteMany.mock.invocationCallOrder[0]!,
    );
    expect(await res.json()).toMatchObject({ consentProofsKept: 1 });
    const riga = db.gdprAuditLog.create.mock.calls[0]![0] as {
      data: { eventId: string; action: string; recordCount: number; details: string };
    };
    expect(riga.data).toMatchObject({ eventId: 'evt-1', action: 'DATA_DELETED', recordCount: 1 });
    expect(JSON.parse(riga.data.details)).toMatchObject({ consentProofsWithoutName: 1 });
  });

  it('treats the consents given with a staff account like those of a grant', async () => {
    db.registration.findMany.mockResolvedValue([]);
    db.eventModerator.findMany.mockResolvedValue([]);
    db.eventModerator.deleteMany.mockResolvedValue({ count: 0 });
    db.staffAccount.findUnique.mockResolvedValue({ id: 'staff-1' });
    db.recordingConsent.findMany.mockResolvedValue([{ eventId: 'evt-2' }, { eventId: 'evt-1' }]);
    prove.tipiDelleProveEsistenti.mockResolvedValue(['recording']);
    prove.conservaProve.mockResolvedValue(1);

    await POST(req('valido') as never, ctx as never);

    expect(db.staffAccount.findUnique).toHaveBeenCalledWith({
      where: { emailHash: 'h'.repeat(64) },
      select: { id: true },
    });
    expect(prove.conservaProve.mock.calls.map((c) => c[1].eventId)).toEqual(['evt-1', 'evt-2']);
    expect(prove.conservaProve.mock.calls[0]![1]).toMatchObject({
      grantIds: [],
      staffAccountIds: ['staff-1'],
      senzaNome: true,
    });
    expect(prove.conservaProve.mock.invocationCallOrder[1]).toBeLessThan(
      tx.recordingConsent.deleteMany.mock.invocationCallOrder[0]!,
    );
    expect(tx.recordingConsent.deleteMany).toHaveBeenCalledWith({
      where: {
        eventId: { in: ['evt-1', 'evt-2'] },
        OR: [
          { emailHash: 'h'.repeat(64) },
          { eventModeratorId: { in: [] } },
          { staffAccountId: 'staff-1' },
        ],
      },
    });
  });

  it('reaches the proofs of someone whose grant or account is gone, by the address', async () => {
    db.registration.findMany.mockResolvedValue([]);
    db.eventModerator.findMany.mockResolvedValue([]);
    db.eventModerator.deleteMany.mockResolvedValue({ count: 0 });
    db.staffAccount.findUnique.mockResolvedValue(null);
    db.multitrackConsent.findMany.mockResolvedValue([{ eventId: 'evt-3' }]);
    prove.tipiDelleProveEsistenti.mockResolvedValue(['transcription']);

    await POST(req('valido') as never, ctx as never);

    expect(db.multitrackConsent.findMany.mock.calls[0]![0].where.OR).toContainEqual({
      emailHash: 'h'.repeat(64),
    });
    expect(prove.conservaProve.mock.calls[0]![1]).toMatchObject({
      eventId: 'evt-3',
      emailHash: 'h'.repeat(64),
      senzaNome: true,
    });
    expect(tx.multitrackConsent.deleteMany).toHaveBeenCalled();
  });

  it('opens no transaction without grants or staff consents', async () => {
    db.registration.findMany.mockResolvedValue([]);
    db.eventModerator.findMany.mockResolvedValue([]);
    await POST(req('valido') as never, ctx as never);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('someone with only kept proofs leaves a trace in the log for each event', async () => {
    db.registration.findMany.mockResolvedValue([]);
    db.eventModerator.findMany.mockResolvedValue([]);
    db.eventModerator.deleteMany.mockResolvedValue({ count: 0 });
    prove.togliNomeDalleProve.mockResolvedValue(
      new Map([
        ['ev-1', 2],
        ['ev-2', 1],
      ]),
    );
    db.retainedConsentProof.count.mockResolvedValue(3);

    const res = await POST(req('valido') as never, ctx as never);

    expect(prove.togliNomeDalleProve).toHaveBeenCalledWith('h'.repeat(64), expect.any(Date));
    expect(await res.json()).toMatchObject({ deleted: 0, consentProofsKept: 3 });
    const righe = db.gdprAuditLog.create.mock.calls.map(
      (c) => (c[0] as { data: { eventId: string; recordCount: number } }).data,
    );
    expect(righe.map((r) => [r.eventId, r.recordCount])).toEqual([
      ['ev-1', 2],
      ['ev-2', 1],
    ]);
  });

  it('removes the name after the registrations: a cleanup in progress has finished by then', async () => {
    db.registration.findMany.mockResolvedValue([{ id: 'r1', eventId: 'e1' }]);
    await POST(req('valido') as never, ctx as never);
    expect(tx.registration.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      prove.togliNomeDalleProve.mock.invocationCallOrder[0]!,
    );
  });

  it('an event with both registrations and kept proofs gets one log row', async () => {
    db.registration.findMany.mockResolvedValue([{ id: 'r1', eventId: 'e1' }]);
    prove.togliNomeDalleProve.mockResolvedValue(new Map([['e1', 2]]));
    await POST(req('valido') as never, ctx as never);
    expect(db.gdprAuditLog.create).toHaveBeenCalledTimes(1);
    expect(db.gdprAuditLog.create.mock.calls[0]![0]).toMatchObject({
      data: { eventId: 'e1', recordCount: 3 },
    });
  });

  it('copies the proofs of a registration before it goes, without the name', async () => {
    db.registration.findMany.mockResolvedValue([{ id: 'r1', eventId: 'ev-1' }]);
    prove.tipiDelleProveEsistenti.mockResolvedValue(['recording', 'transcription']);
    prove.conservaProve.mockResolvedValue(2);
    db.retainedConsentProof.count.mockResolvedValue(2);

    const res = await POST(req('valido') as never, ctx as never);

    expect(prove.conservaProve).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventId: 'ev-1', registrationIds: ['r1'], senzaNome: true }),
    );
    expect(prove.conservaProve.mock.invocationCallOrder[0]).toBeLessThan(
      tx.registration.deleteMany.mock.invocationCallOrder[0]!,
    );
    expect(await res.json()).toMatchObject({ deleted: 1, consentProofsKept: 2 });
  });

  it('touches nothing with an invalid token', async () => {
    const res = await POST(req('falso') as never, ctx as never);
    expect(res.status).toBe(401);
    expect(db.person.deleteMany).not.toHaveBeenCalled();
    expect(db.eventInvitation.deleteMany).not.toHaveBeenCalled();
    expect(db.eventModerator.deleteMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

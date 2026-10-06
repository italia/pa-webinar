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
  chatMessageReaction: { deleteMany: vi.fn() },
  registration: { deleteMany: vi.fn() },
  $executeRaw: vi.fn(),
};
vi.mock('@/lib/db', () => ({
  prisma: {
    person: { deleteMany: vi.fn() },
    eventInvitation: { deleteMany: vi.fn() },
    profilePhoto: { deleteMany: vi.fn() },
    registration: { findMany: vi.fn() },
    chatMessage: { findMany: vi.fn() },
    gdprAuditLog: { create: vi.fn() },
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
  profilePhoto: { deleteMany: Fn };
  registration: { findMany: Fn };
  chatMessage: { findMany: Fn };
  gdprAuditLog: { create: Fn };
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
  db.profilePhoto.deleteMany.mockResolvedValue({ count: 1 });
  db.chatMessage.findMany.mockResolvedValue([]);
  db.gdprAuditLog.create.mockResolvedValue({});
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  tx.eventFeedback.deleteMany.mockResolvedValue({ count: 1 });
  tx.questionnaireResponse.deleteMany.mockResolvedValue({ count: 1 });
  tx.chatMessage.deleteMany.mockResolvedValue({ count: 3 });
  tx.chatMessageReaction.deleteMany.mockResolvedValue({ count: 0 });
  tx.registration.deleteMany.mockResolvedValue({ count: 1 });
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
      profilePhotoDeleted: true,
      feedbackDeleted: 1,
      questionnaireResponsesDeleted: 1,
      chatMessagesDeleted: 3,
      outboxRowsDeleted: 2,
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
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
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
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      ok: true,
      deleted: 0,
      addressBookDeleted: true,
      invitationsDeleted: 2,
      profilePhotoDeleted: true,
    });
    // La foto e' legata all'email: va via anche senza iscrizioni.
    expect(db.profilePhoto.deleteMany).toHaveBeenCalledWith({ where: { emailHash: 'h'.repeat(64) } });
  });

  it('touches nothing with an invalid token', async () => {
    const res = await POST(req('falso') as never, ctx as never);
    expect(res.status).toBe(401);
    expect(db.person.deleteMany).not.toHaveBeenCalled();
    expect(db.eventInvitation.deleteMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

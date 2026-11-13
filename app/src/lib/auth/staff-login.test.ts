// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il link monouso dello staff (ADR-014): nel database solo l'hash, una sola
 * sessione per link, e nessuna differenza fra un token sbagliato, scaduto o gia'
 * usato per chi chiama.
 */
const { prisma, enqueueEmail } = vi.hoisted(() => ({
  prisma: {
    staffLoginToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    staffAccount: { update: vi.fn() },
  },
  enqueueEmail: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/email/outbox', () => ({ enqueueEmail }));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ siteName: 'PA Webinar' }),
}));
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string | null) => (v?.startsWith('cifrato:') ? v.slice(8) : null),
}));

import { DURATA_LINK_MINUTI, consumaLinkAccesso, inviaLinkAccesso } from './staff-login';

const account = { id: 'acc-1', email: 'cifrato:anna@example.com', name: 'cifrato:Anna' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://webinar.example.gov.it';
  prisma.staffLoginToken.updateMany.mockResolvedValue({ count: 1 });
});

function linkNellaMail(): URL {
  const { text } = enqueueEmail.mock.calls[0]![0] as { text: string };
  const trovato = /https:\/\/\S+/.exec(text);
  return new URL(trovato?.[0] ?? '');
}

describe('invio del link', () => {
  it('salva solo l’hash del token che manda per email', async () => {
    await inviaLinkAccesso(account, 'it');
    const salvato = prisma.staffLoginToken.create.mock.calls[0]![0].data as {
      accountId: string;
      tokenHash: string;
    };
    const token = linkNellaMail().searchParams.get('t') ?? '';
    expect(token).not.toBe('');
    expect(salvato.accountId).toBe('acc-1');
    expect(salvato.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(salvato.tokenHash).not.toBe(token);
  });

  it('il link scade dopo la durata stabilita', async () => {
    const prima = Date.now();
    await inviaLinkAccesso(account, 'it');
    const { expiresAt } = prisma.staffLoginToken.create.mock.calls[0]![0].data as {
      expiresAt: Date;
    };
    const minuti = (expiresAt.getTime() - prima) / 60_000;
    expect(minuti).toBeGreaterThanOrEqual(DURATA_LINK_MINUTI);
    expect(minuti).toBeLessThan(DURATA_LINK_MINUTI + 1);
  });

  it('la mail va all’indirizzo in chiaro, nella lingua della pagina', async () => {
    await inviaLinkAccesso(account, 'en');
    const mail = enqueueEmail.mock.calls[0]![0] as { to: string; metadata: unknown };
    expect(mail.to).toBe('anna@example.com');
    expect(mail.metadata).toEqual({ kind: 'staff-login', accountId: 'acc-1' });
    expect(linkNellaMail().pathname.startsWith('/en/')).toBe(true);
  });

  it('una lingua inesistente non produce un link a una pagina che non c’e’', async () => {
    await inviaLinkAccesso(account, 'xx');
    expect(linkNellaMail().pathname.startsWith('/it/')).toBe(true);
  });

  it('senza un indirizzo leggibile non si accoda niente', async () => {
    await inviaLinkAccesso({ ...account, email: 'illeggibile' }, 'it');
    expect(enqueueEmail).not.toHaveBeenCalled();
  });
});

describe('consumo del link', () => {
  const riga = { id: 't-1', accountId: 'acc-1', account: { active: true } };

  it('un link valido apre la sessione e segna l’ultimo accesso', async () => {
    prisma.staffLoginToken.findUnique.mockResolvedValue(riga);
    await expect(consumaLinkAccesso('token')).resolves.toBe('acc-1');
    expect(prisma.staffLoginToken.findUnique.mock.calls[0]![0].where).toEqual({
      tokenHash: createHash('sha256').update('token').digest('hex'),
    });
    expect(prisma.staffAccount.update).toHaveBeenCalledOnce();
  });

  it('il consumo controlla insieme uso e scadenza, in un colpo solo', async () => {
    prisma.staffLoginToken.findUnique.mockResolvedValue(riga);
    await consumaLinkAccesso('token');
    const { where } = prisma.staffLoginToken.updateMany.mock.calls[0]![0] as {
      where: { id: string; usedAt: null; expiresAt: { gt: Date } };
    };
    expect(where.id).toBe('t-1');
    expect(where.usedAt).toBeNull();
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it('un link gia’ usato o scaduto non apre, e non tocca l’account', async () => {
    prisma.staffLoginToken.findUnique.mockResolvedValue(riga);
    prisma.staffLoginToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(consumaLinkAccesso('token')).resolves.toBeNull();
    expect(prisma.staffAccount.update).not.toHaveBeenCalled();
  });

  it('un account disattivato non entra, e il link resta non consumato', async () => {
    prisma.staffLoginToken.findUnique.mockResolvedValue({
      ...riga,
      account: { active: false },
    });
    await expect(consumaLinkAccesso('token')).resolves.toBeNull();
    expect(prisma.staffLoginToken.updateMany).not.toHaveBeenCalled();
  });

  it('un token sconosciuto non apre', async () => {
    prisma.staffLoginToken.findUnique.mockResolvedValue(null);
    await expect(consumaLinkAccesso('token')).resolves.toBeNull();
  });

  it('un token vuoto o enorme non arriva al database', async () => {
    await expect(consumaLinkAccesso('')).resolves.toBeNull();
    await expect(consumaLinkAccesso('x'.repeat(201))).resolves.toBeNull();
    expect(prisma.staffLoginToken.findUnique).not.toHaveBeenCalled();
  });
});

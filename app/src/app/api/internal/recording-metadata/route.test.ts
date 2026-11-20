// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ event: { findUnique: vi.fn() } }));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: () => {} }));
vi.mock('@/lib/crypto/pii', () => ({
  encryptPII: (v: string) => `enc:${v}`,
  tryDecryptPII: (v: string | null) => (v?.startsWith('enc:') ? v.slice(4) : v),
}));

import { GET } from './route';

const chiedi = async () =>
  (await (
    await GET(
      new NextRequest('http://localhost/api/internal/recording-metadata?room=stanza'),
      {
        params: Promise.resolve({}),
      } as never
    )
  ).json()) as Record<string, unknown>;

/** I metadati che finiscono nel file del video: solo chi conduce, come nel video. */
describe('GET /api/internal/recording-metadata', () => {
  beforeEach(() => {
    db.event.findUnique.mockResolvedValue({
      title: { it: 'Evento' },
      description: { it: '' },
      organizerName: null,
      organizers: [],
      moderatorName: 'Chi modera',
      startsAt: new Date('2026-11-18T09:00:00Z'),
      endsAt: new Date('2026-11-18T10:00:00Z'),
      additionalMods: [
        { name: 'enc:Anna Relatrice', role: 'SPEAKER' },
        { name: 'enc:Chi modera', role: 'MODERATOR' },
        { name: 'enc:Bruno Moderatore', role: 'MODERATOR' },
      ],
    });
  });

  it('nomina chi conduce, una volta per nome, con il ruolo', async () => {
    expect((await chiedi()).hosts).toEqual([
      { name: 'Chi modera', role: 'moderator' },
      { name: 'Anna Relatrice', role: 'speaker' },
      { name: 'Bruno Moderatore', role: 'moderator' },
    ]);
  });

  it('non legge ne restituisce chi partecipa, ne nomi ne nickname', async () => {
    const corpo = await chiedi();
    expect(corpo).not.toHaveProperty('participants');
    expect(corpo).not.toHaveProperty('participantNames');
    const select = db.event.findUnique.mock.calls[0]![0].select as Record<
      string,
      unknown
    >;
    expect(select).not.toHaveProperty('registrations');
    expect(db.event.findUnique.mock.calls[0]![0].select.additionalMods.where).toEqual({
      revokedAt: null,
    });
  });
});

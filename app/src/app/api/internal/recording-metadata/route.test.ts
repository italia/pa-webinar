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

/** I metadati che finiscono nel file del video: chi ha un nickname vi compare con quello. */
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
      registrations: [
        {
          displayName: 'enc:Maria Rossi',
          nickname: 'enc:Luna',
          joinedAt: new Date(),
          leftAt: null,
        },
        {
          displayName: 'enc:Luca Neri',
          nickname: null,
          joinedAt: new Date(),
          leftAt: null,
        },
      ],
    });
  });

  it('il nickname al posto del nome, il nome per chi non ne ha', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/internal/recording-metadata?room=stanza'),
      {
        params: Promise.resolve({}),
      } as never
    );
    const corpo = (await res.json()) as { participantNames: string[] };
    expect(corpo.participantNames).toEqual(['Luna', 'Luca Neri']);
    expect(JSON.stringify(corpo)).not.toContain('Maria Rossi');
  });
});

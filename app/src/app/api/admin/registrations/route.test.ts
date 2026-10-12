// @vitest-environment node
/**
 * L'elenco iscritti dell'amministrazione: il consenso alla registrazione
 * dato in sala d'attesa (iscritto prima che l'evento registrasse) conta
 * come quello dato all'iscrizione, nella risposta e nel CSV.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/lib/auth/admin-session', () => ({ isAdminAuthenticated: vi.fn(async () => true) }));
vi.mock('@/lib/crypto/pii', () => ({
  decryptPII: (v: string) => v,
  tryDecryptPII: (v: string) => v,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    registration: { findMany: vi.fn(), count: vi.fn(async () => 1), groupBy: vi.fn(async () => []) },
  },
}));

import { prisma } from '@/lib/db';

import { GET } from './route';

function riga(o: Record<string, unknown>) {
  return {
    id: 'r1',
    eventId: 'e1',
    event: { slug: 'evento', title: { it: 'Evento' }, startsAt: new Date('2026-10-01T10:00:00Z') },
    displayName: 'Relatore 1',
    email: 'relatore@example.org',
    organization: null,
    organizationRole: null,
    organizationType: null,
    consentRecording: null,
    consentMultitrack: null,
    consentFutureCommunications: false,
    joinedAt: null,
    leftAt: null,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    _count: { recordingConsents: 0, multitrackConsents: 0 },
    ...o,
  };
}

const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/admin/registrations — consensi dati in sala', () => {
  it('una prova data in sala vale come consenso', async () => {
    vi.mocked(prisma.registration.findMany).mockResolvedValue([
      riga({ _count: { recordingConsents: 1, multitrackConsents: 1 } }),
      riga({ id: 'r2', consentRecording: false }),
    ] as never);
    const res = await GET(new Request('http://localhost/api/admin/registrations') as never, ctx as never);
    const { rows: righe } = (await res.json()) as {
      rows: { consentRecording: boolean | null; consentMultitrack: boolean | null }[];
    };
    expect(righe[0]).toMatchObject({ consentRecording: true, consentMultitrack: true });
    expect(righe[1]).toMatchObject({ consentRecording: false, consentMultitrack: null });
  });

  it('il CSV riporta lo stesso', async () => {
    vi.mocked(prisma.registration.findMany).mockResolvedValue([
      riga({ _count: { recordingConsents: 1, multitrackConsents: 0 } }),
    ] as never);
    const res = await GET(
      new Request('http://localhost/api/admin/registrations?format=csv') as never,
      ctx as never,
    );
    const [, prima] = (await res.text()).split('\n');
    expect(prima).toContain(',yes,,no,');
  });
});

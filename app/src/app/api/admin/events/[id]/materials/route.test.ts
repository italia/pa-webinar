// @vitest-environment node
/**
 * Creare un materiale dall'area admin: quale file può puntare.
 *
 * Il `blobPath` arriva dal client, e togliere il materiale cancella quel blob.
 * Si accetta solo la chiave di un documento caricato, ed è il file che l'URL
 * del materiale serve, e che nessun altro usa già: così chi gestisce un evento
 * non può far puntare un proprio materiale al logo del sito, a un allegato di
 * chat, al file di un altro evento o all'informativa privacy di un altro
 * evento, e poi cancellarlo togliendo il materiale o lasciandolo alla
 * retention del proprio evento.
 */

import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: 'staff-session' }) })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  requireEventManager: vi.fn(async () => ({ role: 'organizer', accountId: 'org-1' })),
}));
vi.mock('@/lib/audit/admin-audit', () => ({
  logAdminAction: vi.fn(async () => undefined),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn(), findFirst: vi.fn() },
    eventMaterial: { create: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/live-state/publish', () => ({
  pokeLivePanel: vi.fn(),
}));

import { prisma } from '@/lib/db';

import { POST } from './route';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedCreate = prisma.eventMaterial.create as unknown as ReturnType<typeof vi.fn>;
const mockedOtherMaterial = prisma.eventMaterial.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedPrivacyNotice = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const KEY = 'assets/document/2026/09/66666666-6666-4666-8666-666666666666-slide.pdf';
const servedUrl = (key: string) =>
  `https://webinar.example.gov.it/api/assets/${key.replace(/^assets\//, '')}`;

const ctx = () => ({ params: Promise.resolve({ id: EVENT_ID }) });

function post(body: unknown): NextRequest {
  return new Request(`https://webinar.example.gov.it/api/admin/events/${EVENT_ID}/materials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEvent.mockResolvedValue({ id: EVENT_ID, moderatorName: 'Conduzione' });
  mockedOtherMaterial.mockResolvedValue(null);
  mockedPrivacyNotice.mockResolvedValue(null);
  mockedCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'mat-1',
    description: null,
    fileName: null,
    fileSize: null,
    mimeType: null,
    blobPath: null,
    createdAt: new Date('2026-09-25T10:00:00.000Z'),
    ...data,
  }));
});

describe('POST /api/admin/events/[id]/materials — il file del materiale', () => {
  it('un documento caricato, con l’URL che lo serve: creato', async () => {
    const res = await POST(
      post({ title: 'Slide', type: 'FILE', url: servedUrl(KEY), blobPath: KEY }),
      ctx(),
    );
    expect(res.status).toBe(201);
    expect(mockedCreate.mock.calls[0]![0].data).toMatchObject({ blobPath: KEY, type: 'FILE' });
  });

  it('un link senza file: creato', async () => {
    const res = await POST(post({ title: 'Sito', url: 'https://example.org' }), ctx());
    expect(res.status).toBe(201);
  });

  it('il logo del sito come file del materiale: 422, nessuna riga', async () => {
    const logo = 'assets/image/2026/09/88888888-8888-4888-8888-888888888888-logo.png';
    const res = await POST(
      post({ title: 'x', type: 'FILE', url: servedUrl(logo), blobPath: logo }),
      ctx(),
    );
    expect(res.status).toBe(422);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('l’allegato di chat di un altro evento: 422', async () => {
    const chat =
      'assets/chat/99999999-9999-4999-8999-999999999999/2026/09/66666666-6666-4666-8666-666666666666-doc.pdf';
    const res = await POST(
      post({ title: 'x', type: 'FILE', url: servedUrl(chat), blobPath: chat }),
      ctx(),
    );
    expect(res.status).toBe(422);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('il file che il materiale di un altro evento usa già: 422', async () => {
    mockedOtherMaterial.mockResolvedValue({ id: 'materiale-di-un-altro-evento' });
    const res = await POST(
      post({ title: 'x', type: 'FILE', url: servedUrl(KEY), blobPath: KEY }),
      ctx(),
    );
    expect(res.status).toBe(422);
    expect(mockedCreate).not.toHaveBeenCalled();
    // Conta chi tiene la chiave e chi serve lo stesso file con l'URL.
    expect(mockedOtherMaterial).toHaveBeenCalledWith({
      where: { OR: [{ blobPath: KEY }, { url: { endsWith: `/api/assets/${KEY.slice(7)}` } }] },
      select: { id: true },
    });
  });

  it('l’informativa privacy di un evento: 422', async () => {
    mockedPrivacyNotice.mockResolvedValue({ id: 'evento-con-quell-informativa' });
    const res = await POST(
      post({ title: 'x', type: 'FILE', url: servedUrl(KEY), blobPath: KEY }),
      ctx(),
    );
    expect(res.status).toBe(422);
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedPrivacyNotice).toHaveBeenCalledWith({
      where: { privacyPolicyUrl: { endsWith: `/api/assets/${KEY.slice(7)}` } },
      select: { id: true },
    });
  });

  it('un link non tiene un file: blobPath senza tipo FILE, 422', async () => {
    for (const body of [
      { title: 'x', type: 'LINK', url: servedUrl(KEY), blobPath: KEY },
      // Senza tipo il materiale è un link.
      { title: 'x', url: servedUrl(KEY), blobPath: KEY },
    ]) {
      const res = await POST(post(body), ctx());
      expect(res.status).toBe(422);
    }
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('una chiave che non è il file servito dall’URL: 422', async () => {
    const res = await POST(
      post({ title: 'x', type: 'FILE', url: 'https://x.example', blobPath: KEY }),
      ctx(),
    );
    expect(res.status).toBe(422);
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

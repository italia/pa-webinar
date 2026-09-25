// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const { visible, settings } = vi.hoisted(() => ({
  visible: vi.fn(),
  settings: vi.fn(),
}));

vi.mock('@/lib/status-page', () => ({ statusDataVisible: visible }));
vi.mock('@/lib/settings', () => ({ getSettings: settings }));
vi.mock('@/lib/db', () => ({ prisma: {} }));

import { GET } from './route';

describe('GET /api/status/infrastructure', () => {
  it('pagina di stato spenta: 404 prima di leggere configurazione o topologia', async () => {
    // Domini, namespace e repliche sono proprio ciò che l'amministrazione
    // sceglie di non pubblicare spegnendo la pagina.
    visible.mockResolvedValue(false);
    const res = await GET(
      new Request('http://localhost:3000/api/status/infrastructure') as never,
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(404);
    expect(settings).not.toHaveBeenCalled();
  });
});

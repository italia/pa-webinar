// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const impostazioni = vi.hoisted(() => ({
  valore: { organizationUrl: '', jitsiWatermarkUrl: '', logoUrl: '' } as Record<string, string>,
}));
vi.mock('@/lib/settings', () => ({ getSettings: async () => impostazioni.valore }));

import { jitsiInterfaceConfigOverwrite } from '@/lib/jitsi/config';

import { GET } from './route';

describe('GET /api/jitsi-branding.json', () => {
  it('la scena ha lo stesso colore dell’interfaceConfig, con filigrana e riquadri della sala', async () => {
    const res = await GET();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = await res.json();
    expect(body.backgroundColor).toBe(jitsiInterfaceConfigOverwrite.DEFAULT_BACKGROUND);
    expect(body.backgroundImageUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(body.customTheme.palette.thumbnailBackground).toBe(body.customTheme.palette.ui02);
    // Nessun avatar con le iniziali dello stesso colore della scena.
    expect(body.avatarBackgrounds).not.toContain(body.backgroundColor);
  });

  it('senza un logo scelto, nessun logo: nemmeno quello predefinito del server Jitsi', async () => {
    expect((await (await GET()).json()).logoImageUrl).toBe('');
    impostazioni.valore = { ...impostazioni.valore, logoUrl: 'https://ente.example/logo.svg' };
    expect((await (await GET()).json()).logoImageUrl).toBe('https://ente.example/logo.svg');
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn() }));

import { sceltaOrganizzatore } from './organizer';

describe('sceltaOrganizzatore', () => {
  it("l'ente dell'evento, poi quello dell'installazione, poi il nome del sito", () => {
    const sito = {
      organizationName: 'Ente dell’installazione',
      siteName: 'Webinar dell’ente',
    };
    expect(sceltaOrganizzatore('Ente organizzatore', sito)).toBe('Ente organizzatore');
    expect(sceltaOrganizzatore(null, sito)).toBe('Ente dell’installazione');
    expect(
      sceltaOrganizzatore('  ', { organizationName: '', siteName: 'Webinar dell’ente' })
    ).toBe('Webinar dell’ente');
    expect(sceltaOrganizzatore(undefined, {})).toBe('PA Webinar');
  });
});

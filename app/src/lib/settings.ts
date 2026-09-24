import type { SiteSetting } from '@prisma/client';

import { prisma } from './db';

let cachedSettings: SiteSetting | null = null;
let cacheExpiry = 0;

const CACHE_TTL_MS = 60_000;

export async function getSettings(): Promise<SiteSetting> {
  if (cachedSettings && Date.now() < cacheExpiry) {
    return cachedSettings;
  }

  cachedSettings = await prisma.siteSetting.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  });

  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return cachedSettings;
}

export function invalidateSettingsCache(): void {
  cachedSettings = null;
  cacheExpiry = 0;
}

/**
 * Il nome dell'ente titolare, per i testi legali integrati; `null` se non e'
 * configurato. Non ricade sul nome del sito: un testo legale che indica il
 * software come titolare sembra plausibile ed e' falso, meglio che dichiari
 * il dato mancante.
 */
export function nomeEnte(settings: Pick<SiteSetting, 'organizationName'>): string | null {
  return settings.organizationName.trim() || null;
}

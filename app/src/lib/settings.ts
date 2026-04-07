import type { SiteSetting } from '@prisma/client';

import { prisma } from './db';

let cachedSettings: SiteSetting | null = null;
let cacheExpiry = 0;

const CACHE_TTL_MS = 60_000;

export async function getSettings(): Promise<SiteSetting> {
  if (cachedSettings && Date.now() < cacheExpiry) {
    return cachedSettings;
  }

  cachedSettings = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
  });

  if (!cachedSettings) {
    cachedSettings = await prisma.siteSetting.create({
      data: { id: 'singleton' },
    });
  }

  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return cachedSettings;
}

export function invalidateSettingsCache(): void {
  cachedSettings = null;
  cacheExpiry = 0;
}

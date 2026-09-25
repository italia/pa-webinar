import { Prisma, type SiteSetting } from '@prisma/client';

import { prisma } from './db';

let cachedSettings: SiteSetting | null = null;
let cacheExpiry = 0;

const CACHE_TTL_MS = 60_000;

/**
 * La riga delle impostazioni, creata al primo uso. `upsert` di Prisma non e'
 * atomico — legge e poi scrive — e su un'installazione nuova le prime
 * richieste arrivano insieme: una crea la riga, le altre urtano il vincolo
 * di unicita'. Per loro la riga ora esiste, e basta rileggerla.
 */
async function leggiOCrea(): Promise<SiteSetting> {
  try {
    return await prisma.siteSetting.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return prisma.siteSetting.findUniqueOrThrow({ where: { id: 'singleton' } });
    }
    throw err;
  }
}

export async function getSettings(): Promise<SiteSetting> {
  if (cachedSettings && Date.now() < cacheExpiry) {
    return cachedSettings;
  }

  cachedSettings = await leggiOCrea();

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

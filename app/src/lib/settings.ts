import { Prisma, type SiteSetting } from '@prisma/client';

import { prisma } from './db';

let cachedSettings: SiteSetting | null = null;
let cacheExpiry = 0;

const CACHE_TTL_MS = 60_000;

/**
 * La riga delle impostazioni, creata al primo uso. Di norma esiste gia' e
 * basta leggerla. Su un'installazione nuova le prime richieste arrivano
 * insieme: la creazione e' un `INSERT ... ON CONFLICT DO NOTHING`
 * (`skipDuplicates`), che non fallisce se un'altra richiesta l'ha appena
 * creata. Un `upsert` di Prisma invece legge e poi scrive: chi perde la gara
 * urta il vincolo di unicita', e il client registra l'errore nel log anche
 * quando qui viene gestito — a ogni primo avvio, un errore che non c'e'.
 *
 * Senza cache: chi deve leggere il valore appena scritto (il pannello delle
 * impostazioni) la chiama direttamente invece di `getSettings`.
 */
export async function leggiOCrea(): Promise<SiteSetting> {
  const esistente = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });
  if (esistente) return esistente;
  try {
    await prisma.siteSetting.createMany({
      data: [{ id: 'singleton' }],
      skipDuplicates: true,
    });
  } catch (err) {
    // Rete di sicurezza: se il vincolo scatta comunque, la riga ora esiste.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
      throw err;
    }
  }
  return prisma.siteSetting.findUniqueOrThrow({ where: { id: 'singleton' } });
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

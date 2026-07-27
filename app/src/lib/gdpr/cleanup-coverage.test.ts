import fs from 'fs';
import path from 'path';

import { Prisma } from '@prisma/client';
import { describe, it, expect } from 'vitest';

import { PURGED_BY_CLEANUP, NOT_PURGED_BY_CLEANUP } from './cleanup-coverage';

/**
 * La rete di sicurezza della retention. Il difetto che chiude non è teorico:
 * la chat e le concessioni nominali sono sopravvissute alla conservazione
 * perché nessuno si accorgeva che mancavano dall'elenco.
 */
const CLEANUP_ROUTE = path.resolve(__dirname, '../../app/api/cron/cleanup/route.ts');

/** Ogni tabella con una colonna `eventId`: sono quelle che vivono e muoiono con l'evento. */
function eventScopedModels(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'eventId'))
    .map((m) => m.name);
}

/** `EventModerator` → `eventModerator`, come lo chiama il client di Prisma. */
function clientName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

describe('copertura della pulizia periodica', () => {
  it('classifica OGNI tabella legata a un evento', () => {
    const classified = new Set([
      ...Object.keys(PURGED_BY_CLEANUP),
      ...Object.keys(NOT_PURGED_BY_CLEANUP),
    ]);
    const unclassified = eventScopedModels().filter((m) => !classified.has(m));
    expect(unclassified).toEqual([]);
  });

  it('nessuna tabella sta in entrambi gli elenchi', () => {
    const both = Object.keys(PURGED_BY_CLEANUP).filter((m) => m in NOT_PURGED_BY_CLEANUP);
    expect(both).toEqual([]);
  });

  it('non classifica tabelle che nello schema non esistono più', () => {
    const known = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name));
    const ghosts = [...Object.keys(PURGED_BY_CLEANUP), ...Object.keys(NOT_PURGED_BY_CLEANUP)]
      .filter((m) => !known.has(m));
    expect(ghosts).toEqual([]);
  });

  it('ogni tabella dichiarata purgata compare davvero nella transazione', () => {
    // Classificare non cancella: senza questo confronto l'elenco potrebbe
    // dichiarare una pulizia che nessuno esegue.
    const source = fs.readFileSync(CLEANUP_ROUTE, 'utf-8');
    const absent = Object.keys(PURGED_BY_CLEANUP).filter(
      (model) => !source.includes(`tx.${clientName(model)}.`),
    );
    expect(absent).toEqual([]);
  });

  it('ogni scelta porta una motivazione leggibile', () => {
    for (const [model, reason] of Object.entries({
      ...PURGED_BY_CLEANUP,
      ...NOT_PURGED_BY_CLEANUP,
    })) {
      expect(reason.length, model).toBeGreaterThan(15);
    }
  });
});

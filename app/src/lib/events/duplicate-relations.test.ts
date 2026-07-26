import { Prisma } from '@prisma/client';
import { describe, it, expect } from 'vitest';

import {
  DUPLICATED_EVENT_RELATIONS,
  NOT_DUPLICATED_EVENT_RELATIONS,
  DUPLICATE_SOURCE_INCLUDE,
  duplicatedRelations,
  type DuplicableRelations,
} from './duplicate-relations';

/**
 * Il gemello del test sulle colonne. Quello guardava solo gli scalari, e le
 * relazioni erano "gestite dalla rotta": è esattamente per questo che tag,
 * organizzatori, co-moderatori, agenda e questionari si perdevano a ogni
 * duplicazione senza che nessun test se ne accorgesse.
 */
const eventModel = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Event');

function eventRelationFields(): string[] {
  if (!eventModel) throw new Error('Event model not found in the Prisma DMMF');
  return eventModel.fields.filter((f) => f.kind === 'object').map((f) => f.name);
}

/** Sorgente completa: una relazione per tipo, con i campi che il builder legge. */
function fullSource(): DuplicableRelations {
  return {
    tagLinks: [{ tagId: 'tag-1' }],
    organizers: [{ name: 'Ente A', logoUrl: null, websiteUrl: 'https://esempio.gov.it', sortOrder: 0 }],
    additionalMods: [
      { name: 'cifrato:nome', email: 'cifrato:email', role: 'MODERATOR' },
      { name: 'cifrato:nome2', email: null, role: 'SPEAKER' },
    ],
    agendaItems: [{ label: 'Apertura', sortOrder: 0 }],
    reminders: [{ offsetMinutes: 1440, label: 'Un giorno prima' }],
    questionnaires: [
      {
        placement: 'POST_EVENT',
        title: { it: 'Come è andata?' },
        description: null,
        required: false,
        allowEdit: true,
        templates: [{ templateId: 'tpl-1', sortOrder: 0 }],
        adhocItems: [
          {
            prompt: { it: 'Voto complessivo' },
            type: 'LIKERT',
            options: null,
            scaleMin: 1,
            scaleMax: 5,
            scaleMinLabel: null,
            scaleMaxLabel: { it: 'Ottimo' },
            required: true,
            sortOrder: 0,
          },
        ],
      },
    ],
  };
}

describe('classificazione delle relazioni di Event', () => {
  it('classifica OGNI relazione come ereditata o esclusa con motivo', () => {
    const classified = new Set<string>([
      ...DUPLICATED_EVENT_RELATIONS,
      ...Object.keys(NOT_DUPLICATED_EVENT_RELATIONS),
    ]);
    const unclassified = eventRelationFields().filter((f) => !classified.has(f));
    expect(unclassified).toEqual([]);
  });

  it('nessuna relazione sta in entrambi gli elenchi', () => {
    const both = DUPLICATED_EVENT_RELATIONS.filter(
      (r) => r in NOT_DUPLICATED_EVENT_RELATIONS,
    );
    expect(both).toEqual([]);
  });

  it('ogni relazione che si copia viene anche CARICATA dalla sorgente', () => {
    // Se le due cose divergono, il builder riceve `undefined` e perde la
    // relazione in silenzio: è il difetto che questo file esiste per impedire.
    const loaded = Object.keys(DUPLICATE_SOURCE_INCLUDE);
    expect([...DUPLICATED_EVENT_RELATIONS].sort()).toEqual(loaded.sort());
  });

  it('ogni esclusione porta una motivazione leggibile', () => {
    for (const [rel, reason] of Object.entries(NOT_DUPLICATED_EVENT_RELATIONS)) {
      expect(reason.length, rel).toBeGreaterThan(15);
    }
  });
});

describe('duplicatedRelations', () => {
  it('non eredita MAI il token dei co-moderatori: è una credenziale', () => {
    const out = duplicatedRelations(fullSource()) as {
      additionalMods: { create: { token: string; name: string }[] };
    };
    const tokens = out.additionalMods.create.map((m) => m.token);
    expect(tokens).toHaveLength(2);
    for (const token of tokens) {
      expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
    // Due persone, due credenziali distinte.
    expect(new Set(tokens).size).toBe(2);
  });

  it('copia la scaletta ma non il suo stato di esecuzione', () => {
    const out = duplicatedRelations(fullSource()) as {
      agendaItems: { create: Record<string, unknown>[] };
    };
    const item = out.agendaItems.create[0]!;
    expect(item).toEqual({ label: 'Apertura', sortOrder: 0 });
    expect(item.completed).toBeUndefined();
    expect(item.completedAt).toBeUndefined();
  });

  it('omette i Json nullable invece di passarli come null (Prisma li rifiuta)', () => {
    const out = duplicatedRelations(fullSource()) as {
      questionnaires: {
        create: { adhocItems: { create: Record<string, unknown>[] } }[];
      };
    };
    const item = out.questionnaires.create[0]!.adhocItems.create[0]!;
    expect('options' in item).toBe(false);
    expect('scaleMinLabel' in item).toBe(false);
    // Quello valorizzato invece c'è.
    expect(item.scaleMaxLabel).toEqual({ it: 'Ottimo' });
  });

  it('una relazione vuota non compare affatto nel payload', () => {
    const empty: DuplicableRelations = {
      tagLinks: [],
      organizers: [],
      additionalMods: [],
      agendaItems: [],
      reminders: [],
      questionnaires: [],
    };
    expect(duplicatedRelations(empty)).toEqual({});
  });

  it('copia tag, organizzatori, promemoria e questionari con i loro campi', () => {
    const out = duplicatedRelations(fullSource()) as Record<string, { create: unknown[] }>;
    expect(out.tagLinks?.create).toEqual([{ tagId: 'tag-1' }]);
    expect(out.organizers?.create).toEqual([
      { name: 'Ente A', logoUrl: null, websiteUrl: 'https://esempio.gov.it', sortOrder: 0 },
    ]);
    expect(out.reminders?.create).toEqual([{ offsetMinutes: 1440, label: 'Un giorno prima' }]);
    const q = (out.questionnaires?.create as Record<string, unknown>[])[0]!;
    expect(q.placement).toBe('POST_EVENT');
    expect(q.templates).toEqual({ create: [{ templateId: 'tpl-1', sortOrder: 0 }] });
  });
});

import { Prisma } from '@prisma/client';
import { describe, it, expect } from 'vitest';

import {
  DUPLICATED_EVENT_RELATIONS,
  NOT_DUPLICATED_EVENT_RELATIONS,
  DUPLICATE_SOURCE_INCLUDE,
  duplicatedRelations,
  type DuplicateSource,
} from './duplicate-relations';

/**
 * Il gemello del test sulle colonne: quello guarda gli scalari, questo le
 * relazioni. Copre tre cose distinte — che ogni relazione dello schema sia
 * classificata, che quelle da copiare siano davvero caricate E costruite, e che
 * le regole di sicurezza dentro la query restino dove sono.
 */
const eventModel = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Event');

function eventRelationFields(): string[] {
  if (!eventModel) throw new Error('Event model not found in the Prisma DMMF');
  return eventModel.fields.filter((f) => f.kind === 'object').map((f) => f.name);
}

/** Sorgente completa: una relazione per tipo, con i campi che il builder legge. */
function fullSource(): DuplicateSource {
  return {
    tagLinks: [{ tagId: 'tag-1' }],
    organizers: [
      { name: 'Ente A', logoUrl: null, websiteUrl: 'https://esempio.gov.it', sortOrder: 0 },
    ],
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

  it('ogni relazione che si copia viene anche COSTRUITA dal builder', () => {
    // L'anello che mancava: elenco e query possono essere allineati mentre il
    // costruttore non ha il ramo corrispondente, e la relazione non viene
    // copiata senza che nessun test se ne accorga.
    const built = Object.keys(duplicatedRelations(fullSource()));
    expect([...DUPLICATED_EVENT_RELATIONS].sort()).toEqual(built.sort());
  });

  it('ogni esclusione porta una motivazione leggibile', () => {
    for (const [rel, reason] of Object.entries(NOT_DUPLICATED_EVENT_RELATIONS)) {
      expect(reason.length, rel).toBeGreaterThan(15);
    }
  });

  it('non ricarica le concessioni revocate: la regola sta nella query', () => {
    // Regola di sicurezza: chi si è vista revocare l'accesso non deve ritrovarlo
    // su ogni copia dell'evento con un link nuovo e funzionante. Vive dentro
    // l'include e non è esprimibile nel tipo, quindi va asserita qui.
    expect(DUPLICATE_SOURCE_INCLUDE.additionalMods.where).toEqual({ revokedAt: null });
  });

  it('non legge lo stato di esecuzione della scaletta', () => {
    const selected = Object.keys(DUPLICATE_SOURCE_INCLUDE.agendaItems.select);
    expect(selected).not.toContain('completed');
    expect(selected).not.toContain('completedAt');
  });
});

describe('duplicatedRelations', () => {
  it('non eredita MAI il token dei co-moderatori: è una credenziale', () => {
    const out = duplicatedRelations(fullSource());
    const created = out.additionalMods?.create as { token: string }[];
    const tokens = created.map((m) => m.token);
    expect(tokens).toHaveLength(2);
    for (const token of tokens) {
      expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
    // Due persone, due credenziali distinte.
    expect(new Set(tokens).size).toBe(2);
  });

  it('copia la scaletta ma non il suo stato di esecuzione', () => {
    const out = duplicatedRelations(fullSource());
    const items = out.agendaItems?.create as Record<string, unknown>[];
    expect(items[0]).toEqual({ label: 'Apertura', sortOrder: 0 });
    expect(items[0]?.completed).toBeUndefined();
    expect(items[0]?.completedAt).toBeUndefined();
  });

  it('omette i Json nullable invece di passarli come null (Prisma li rifiuta)', () => {
    const out = duplicatedRelations(fullSource());
    const questionnaires = out.questionnaires?.create as {
      adhocItems: { create: Record<string, unknown>[] };
    }[];
    const item = questionnaires[0]!.adhocItems.create[0]!;
    expect('options' in item).toBe(false);
    expect('scaleMinLabel' in item).toBe(false);
    // Quello valorizzato invece c'è.
    expect(item.scaleMaxLabel).toEqual({ it: 'Ottimo' });
  });

  it('ricade sul default per i Json obbligatori con valore nullo', () => {
    // `title`/`description` non sono nullable e hanno `{}` come default: un null
    // letto dal DB farebbe rifiutare l'insert, e con esso l'INTERA copia, perché
    // è un unico inserimento annidato.
    const out = duplicatedRelations(fullSource());
    const questionnaires = out.questionnaires?.create as Record<string, unknown>[];
    expect(questionnaires[0]?.description).toEqual({});
    expect(questionnaires[0]?.title).toEqual({ it: 'Come è andata?' });
  });

  it('una relazione vuota non compare affatto nel payload', () => {
    const empty: DuplicateSource = {
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
    const out = duplicatedRelations(fullSource());
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

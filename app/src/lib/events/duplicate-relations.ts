/**
 * Quali RELAZIONI di un evento eredita una copia, e quali no.
 *
 * Il gemello di `duplicate-fields.ts`, che fa lo stesso lavoro per le colonne
 * scalari. Due elenchi esaustivi, così un test verifica contro lo schema di
 * Prisma che OGNI relazione sia classificata: se ne aggiungi una e la dimentichi,
 * fallisce la suite invece del prossimo evento duplicato.
 *
 * Il criterio è uno solo: **la copia eredita la configurazione, non la vita
 * dell'occorrenza**. Chi si è iscritto, cosa ha chiesto, come ha votato, cosa è
 * stato registrato appartengono all'evento che si è svolto.
 *
 * Il controllo esaustivo vale per le relazioni di primo livello di `Event`. I
 * livelli sotto (i modelli e le domande dentro un questionario) sono presidiati
 * dai tipi, non da un elenco: aggiungerne uno all'include lo rende disponibile al
 * costruttore, ma dimenticarlo non fa fallire nessun test.
 *
 * I tipi non sono scritti a mano: la sorgente è derivata da `DUPLICATE_SOURCE_INCLUDE`
 * e il risultato dal tipo di creazione di Prisma. È deliberato — un tipo scritto a
 * mano (o un cast) lascia passare un campo tolto dal `select`, che poi arriva
 * al costruttore come `undefined` e sparisce senza errori né test rossi.
 */

import { randomUUID } from 'crypto';

import type { Prisma } from '@prisma/client';

/** Relazioni che la copia eredita. */
export const DUPLICATED_EVENT_RELATIONS = [
  'tagLinks',
  'organizers',
  'additionalMods',
  'agendaItems',
  'questionnaires',
  'reminders',
] as const;

type DuplicatedRelation = (typeof DUPLICATED_EVENT_RELATIONS)[number];

/** Relazioni deliberatamente NON copiate, con il motivo. */
export const NOT_DUPLICATED_EVENT_RELATIONS: Record<string, string> = {
  // Legami che viaggiano già con una colonna scalare (vedi duplicate-fields).
  gdprTemplate: 'il legame viaggia con la colonna gdprTemplateId',
  recurrenceSeries: 'idem con recurrenceSeriesId: l’appartenenza a una serie si assegna, non si eredita',
  seriesChildren: 'lato inverso: le occorrenze figlie restano dell’originale',

  // Persone e loro azioni: copiarle significherebbe iscrivere o invitare
  // qualcuno a un evento a cui non ha mai detto di sì.
  registrations: 'sono le persone iscritte a QUELL’occorrenza, e sono dati personali',
  invitations: 'un invito è un’azione verso una persona, non configurazione: la copia nasce in bozza e gli inviti si mandano quando la data è confermata',

  // Vita dell'evento.
  questions: 'domande poste durante quell’evento',
  chatMessages: 'conversazione di quell’evento (e dati personali cifrati)',
  liveReactions: 'reazioni di quell’evento',
  wordCloudRounds: 'giri di word cloud con le parole di chi c’era',
  feedback: 'giudizi su quell’evento',
  callSessions: 'sessioni della call che si è svolta',
  gdprAuditLogs: 'registro delle cancellazioni: appartiene alla riga che le ha subite',
  recordings: 'artefatti prodotti da quell’occorrenza',

  // Casi discutibili, esclusi con motivo esplicito.
  polls: 'un sondaggio nasce quando lo si lancia e porta con sé i voti; copiare le sole domande sarebbe una funzione a parte (modelli di sondaggio), non una duplicazione',
  materials: 'i materiali sono il contenuto di quel giorno (slide, allegati); una serie che usa sempre gli stessi merita una scelta esplicita, non un’eredità silenziosa',
};

/**
 * Cosa caricare dalla sorgente. Sta qui e non nella rotta perché include e
 * costruttore devono cambiare insieme: il tipo della sorgente è derivato da
 * questo oggetto, quindi togliere un campo qui rompe la compilazione del
 * costruttore invece di far sparire il dato in silenzio.
 */
export const DUPLICATE_SOURCE_INCLUDE = {
  tagLinks: { select: { tagId: true } },
  organizers: { select: { name: true, logoUrl: true, websiteUrl: true, sortOrder: true } },
  additionalMods: {
    // Solo le concessioni ancora valide: una revoca vale per l'occorrenza in
    // cui è avvenuta, ma ri-creare una persona già revocata sarebbe rimetterle
    // in mano un accesso che le era stato tolto. È una regola di sicurezza, non
    // un dettaglio della query: un test la verifica.
    where: { revokedAt: null },
    select: { name: true, email: true, role: true },
  },
  agendaItems: {
    // `completed`/`completedAt` NON si leggono: sono lo stato di esecuzione
    // della riunione che si è svolta, non la scaletta.
    select: { label: true, sortOrder: true },
  },
  reminders: { select: { offsetMinutes: true, label: true } },
  questionnaires: {
    select: {
      placement: true,
      title: true,
      description: true,
      required: true,
      allowEdit: true,
      templates: { select: { templateId: true, sortOrder: true } },
      adhocItems: {
        select: {
          prompt: true,
          type: true,
          options: true,
          scaleMin: true,
          scaleMax: true,
          scaleMinLabel: true,
          scaleMaxLabel: true,
          required: true,
          sortOrder: true,
        },
      },
    },
  },
} as const satisfies Prisma.EventInclude;

/**
 * La sorgente, con le sole relazioni che si copiano e con i soli campi che
 * l'include carica davvero. Derivata, non scritta: è questo che rende il
 * costruttore sensibile a una modifica dell'include.
 */
export type DuplicateSource = Pick<
  Prisma.EventGetPayload<{ include: typeof DUPLICATE_SOURCE_INCLUDE }>,
  DuplicatedRelation
>;

/** Il payload di creazione annidato, verificato contro i tipi di Prisma. */
export type DuplicatedRelationsPayload = Partial<
  Pick<Prisma.EventCreateInput, DuplicatedRelation>
>;

/**
 * Prisma rifiuta `null` esplicito su una colonna Json nullable: va OMESSA.
 * Stessa trappola già gestita per gli scalari in `duplicatedConfig`.
 */
function optionalJson<K extends string>(
  key: K,
  value: Prisma.JsonValue | null,
): Record<K, Prisma.InputJsonValue> | Record<string, never> {
  return value === null || value === undefined
    ? {}
    : ({ [key]: value } as Record<K, Prisma.InputJsonValue>);
}

/**
 * Le colonne Json NON nullable (titolo e descrizione del questionario) hanno
 * `{}` come default nello schema, ma il tipo letto ammette comunque il null
 * JSON: passandolo, Prisma rifiuta l'inserimento e — dato che la copia è un
 * unico insert annidato — l'intera duplicazione fallirebbe. Si ricade sul
 * default.
 */
function requiredJson(value: Prisma.JsonValue | null): Prisma.InputJsonValue {
  return value === null || value === undefined ? {} : value;
}

/**
 * Costruisce le `create` annidate per `prisma.event.create`. Le relazioni vuote
 * non compaiono affatto: passare `{ create: [] }` funziona, ma sporca il
 * payload e rende più difficile leggere cosa è stato davvero copiato.
 */
export function duplicatedRelations(source: DuplicateSource): DuplicatedRelationsPayload {
  const out: DuplicatedRelationsPayload = {};

  if (source.tagLinks.length > 0) {
    out.tagLinks = { create: source.tagLinks.map((l) => ({ tagId: l.tagId })) };
  }

  if (source.organizers.length > 0) {
    out.organizers = {
      create: source.organizers.map((o) => ({
        name: o.name,
        logoUrl: o.logoUrl,
        websiteUrl: o.websiteUrl,
        sortOrder: o.sortOrder,
      })),
    };
  }

  if (source.additionalMods.length > 0) {
    out.additionalMods = {
      create: source.additionalMods.map((m) => ({
        // Nome ed email restano cifrati: si copiano i valori così come sono,
        // senza decifrare nulla. Seguono la retention dell'evento copiato, che
        // li cancella insieme al resto (vedi /api/cron/cleanup).
        name: m.name,
        email: m.email,
        role: m.role,
        // Il token NON si eredita mai: è la credenziale con cui si entra in
        // sala da moderatore. Riusarlo darebbe al vecchio link il controllo
        // della stanza nuova — ed è la stessa regola già applicata al token
        // principale dell'evento.
        token: randomUUID(),
      })),
    };
  }

  if (source.agendaItems.length > 0) {
    out.agendaItems = {
      create: source.agendaItems.map((a) => ({ label: a.label, sortOrder: a.sortOrder })),
    };
  }

  if (source.reminders.length > 0) {
    out.reminders = {
      create: source.reminders.map((r) => ({ offsetMinutes: r.offsetMinutes, label: r.label })),
    };
  }

  if (source.questionnaires.length > 0) {
    out.questionnaires = {
      create: source.questionnaires.map((q) => ({
        placement: q.placement,
        title: requiredJson(q.title),
        description: requiredJson(q.description),
        required: q.required,
        allowEdit: q.allowEdit,
        ...(q.templates.length > 0
          ? {
              templates: {
                create: q.templates.map((t) => ({
                  templateId: t.templateId,
                  sortOrder: t.sortOrder,
                })),
              },
            }
          : {}),
        ...(q.adhocItems.length > 0
          ? {
              adhocItems: {
                create: q.adhocItems.map((i) => ({
                  prompt: requiredJson(i.prompt),
                  type: i.type,
                  scaleMin: i.scaleMin,
                  scaleMax: i.scaleMax,
                  required: i.required,
                  sortOrder: i.sortOrder,
                  ...optionalJson('options', i.options),
                  ...optionalJson('scaleMinLabel', i.scaleMinLabel),
                  ...optionalJson('scaleMaxLabel', i.scaleMaxLabel),
                })),
              },
            }
          : {}),
      })),
    };
  }

  return out;
}

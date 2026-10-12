/**
 * Il glossario della post-produzione AI: per ogni termine, come si scrive,
 * come puo' arrivare dalla trascrizione automatica, come si pronuncia nel
 * doppiaggio e come si traduce.
 *
 * Due livelli: le voci dell'istanza (senza evento), che valgono per tutti gli
 * eventi, e quelle di un evento, che su un termine uguale (maiuscole a parte)
 * prendono il posto della voce dell'istanza. Le voci dell'istanza le aggiunge
 * tutto lo staff; chi organizza modifica e cancella solo quelle che ha
 * aggiunto (canEditInstanceTerm), l'amministrazione tutte. Il worker lo riceve con il job
 * (providerHints.glossary) e lo applica in infra/ai/worker/glossary.py:
 *   - trascrizione: termini nel suggerimento iniziale a Whisper, forme
 *     sbagliate riportate alla forma scritta, correzione con il modello;
 *   - traduzione: il termine non si traduce, o si traduce come indicato;
 *   - doppiaggio: la pronuncia per lingua, o la lettura lettera per lettera.
 */

import type { GlossaryTerm, Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { locales } from '@/i18n/config';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';

export const GLOSSARY_READINGS = ['auto', 'spell', 'word'] as const;
export type GlossaryReading = (typeof GLOSSARY_READINGS)[number];

/** Quante voci al massimo, per l'istanza e per un evento. */
export const GLOSSARY_MAX_INSTANCE = 500;
export const GLOSSARY_MAX_EVENT = 200;

const LINGUE = locales as readonly string[];

/** Un testo per lingua; `*` vale per tutte le lingue senza un testo proprio. */
const perLingua = (conTutte: boolean) =>
  z
    .record(
      z.string().refine((k) => LINGUE.includes(k) || (conTutte && k === '*'), {
        message: 'unknown language',
      }),
      z.string().trim().min(1).max(120),
    )
    .refine((o) => Object.keys(o).length <= LINGUE.length + 1, { message: 'too many languages' });

const unaRiga = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\r\n]/.test(v), { message: 'single line only' });

export const glossaryTermInputSchema = z.object({
  term: unaRiga(80),
  aliases: z.array(unaRiga(80)).max(12).default([]),
  reading: z.enum(GLOSSARY_READINGS).default('auto'),
  spoken: perLingua(true).default({}),
  translations: perLingua(false).default({}),
  note: z.string().trim().max(300).nullable().optional(),
});
export type GlossaryTermInput = z.infer<typeof glossaryTermInputSchema>;

export const glossaryTermPatchSchema = glossaryTermInputSchema.partial();
export type GlossaryTermPatch = z.infer<typeof glossaryTermPatchSchema>;

/** Una voce come la usano la pagina e il worker. */
export interface GlossaryEntry {
  id: string;
  /** null per le voci dell'istanza. */
  eventId: string | null;
  term: string;
  aliases: string[];
  reading: GlossaryReading;
  spoken: Record<string, string>;
  translations: Record<string, string>;
  note: string | null;
  /** Chi ha aggiunto una voce dell'istanza (account dello staff), se noto. */
  createdById: string | null;
  /** Se chi chiede puo' modificarla: lo calcola la rotta. */
  canEdit?: boolean;
}

function testi(v: Prisma.JsonValue): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) if (typeof x === 'string' && x.trim()) out[k] = x;
  return out;
}

export function toGlossaryEntry(row: GlossaryTerm): GlossaryEntry {
  return {
    id: row.id,
    eventId: row.eventId,
    term: row.term,
    aliases: row.aliases ?? [],
    reading: (GLOSSARY_READINGS as readonly string[]).includes(row.reading)
      ? (row.reading as GlossaryReading)
      : 'auto',
    spoken: testi(row.spoken),
    translations: testi(row.translations),
    note: row.note,
    createdById: row.createdById,
  };
}

/** Una voce dell'istanza si modifica dall'amministrazione, o da chi
 *  organizza se l'ha aggiunta lui. */
export function canEditInstanceTerm(
  session: { role: 'admin' | 'organizer'; accountId: string | null },
  entry: Pick<GlossaryEntry, 'createdById'>,
): boolean {
  if (session.role === 'admin') return true;
  return session.accountId !== null && entry.createdById === session.accountId;
}

const chiave = (term: string) => term.trim().toLocaleLowerCase('it');

/** Le voci dell'evento prendono il posto di quelle dell'istanza con lo
 *  stesso termine. Prima le voci dell'evento, poi quelle dell'istanza, in
 *  ordine alfabetico: chi ha poco spazio (i prompt del worker) tiene le
 *  prime. */
export function mergeGlossary(instance: GlossaryEntry[], event: GlossaryEntry[]): GlossaryEntry[] {
  const dellEvento = new Set(event.map((e) => chiave(e.term)));
  const ordina = (l: GlossaryEntry[]) => [...l].sort((a, b) => a.term.localeCompare(b.term, 'it'));
  return [...ordina(event), ...ordina(instance.filter((e) => !dellEvento.has(chiave(e.term))))];
}

type Db = PrismaClient | Prisma.TransactionClient;

export async function listGlossary(eventId: string | null, db: Db = prisma): Promise<GlossaryEntry[]> {
  const rows = await db.glossaryTerm.findMany({ where: { eventId }, orderBy: { term: 'asc' } });
  return rows.map(toGlossaryEntry);
}

/** Il glossario che vale per un evento: l'istanza piu' l'evento. */
export async function glossaryForEvent(eventId: string, db: Db = prisma): Promise<GlossaryEntry[]> {
  const rows = await db.glossaryTerm.findMany({
    where: { OR: [{ eventId: null }, { eventId }] },
    orderBy: { term: 'asc' },
  });
  const entries = rows.map(toGlossaryEntry);
  return mergeGlossary(
    entries.filter((e) => e.eventId === null),
    entries.filter((e) => e.eventId !== null),
  );
}

/**
 * I termini da suggerire a Whisper, in un testo di al massimo `max`
 * caratteri: prima quelli dell'evento, poi quelli dell'istanza. Il
 * suggerimento ha poco spazio (circa 200 token), e un termine dell'evento
 * e' quasi sempre piu' utile di una sigla generica.
 */
export function asrPromptTerms(glossary: GlossaryEntry[], max: number): string {
  const ordinati = [
    ...glossary.filter((e) => e.eventId !== null),
    ...glossary.filter((e) => e.eventId === null),
  ];
  const scelti: string[] = [];
  let lunghezza = 0;
  for (const e of ordinati) {
    const extra = (scelti.length ? 2 : 0) + e.term.length;
    if (lunghezza + extra > max) break;
    scelti.push(e.term);
    lunghezza += extra;
  }
  return scelti.join(', ');
}

/** Cio' che il worker riceve: niente identificativi, solo le regole. */
export function glossaryHints(glossary: GlossaryEntry[]) {
  return glossary.map(({ term, aliases, reading, spoken, translations, note }) => ({
    term,
    aliases,
    reading,
    spoken,
    translations,
    note,
  }));
}

async function termineGiaUsato(db: Db, eventId: string | null, term: string, tranneId?: string) {
  const uguale = await db.glossaryTerm.findFirst({
    where: {
      eventId,
      term: { equals: term.trim(), mode: 'insensitive' },
      ...(tranneId ? { NOT: { id: tranneId } } : {}),
    },
    select: { id: true },
  });
  if (uguale) throw new AppError('This term is already in the glossary', 409, 'CONFLICT');
}

function datiVoce(input: GlossaryTermPatch) {
  return {
    ...(input.term !== undefined ? { term: input.term.trim() } : {}),
    ...(input.aliases !== undefined
      ? { aliases: [...new Set(input.aliases.map((a) => a.trim()).filter(Boolean))] }
      : {}),
    ...(input.reading !== undefined ? { reading: input.reading } : {}),
    ...(input.spoken !== undefined ? { spoken: input.spoken } : {}),
    ...(input.translations !== undefined ? { translations: input.translations } : {}),
    ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
  };
}

export async function getGlossaryTerm(
  id: string,
  eventId: string | null,
  db: Db = prisma,
): Promise<GlossaryEntry | null> {
  const row = await db.glossaryTerm.findFirst({ where: { id, eventId } });
  return row ? toGlossaryEntry(row) : null;
}

export async function createGlossaryTerm(
  eventId: string | null,
  input: GlossaryTermInput,
  { createdById = null, db = prisma }: { createdById?: string | null; db?: Db } = {},
): Promise<GlossaryEntry> {
  const quante = await db.glossaryTerm.count({ where: { eventId } });
  if (quante >= (eventId ? GLOSSARY_MAX_EVENT : GLOSSARY_MAX_INSTANCE)) {
    throw new AppError('The glossary is full', 409, 'GLOSSARY_FULL');
  }
  await termineGiaUsato(db, eventId, input.term);
  const row = await db.glossaryTerm.create({
    data: { eventId, createdById, ...datiVoce(input), term: input.term.trim() },
  });
  return toGlossaryEntry(row);
}

/** Modifica una voce di quel livello: una rotta dell'evento non tocca le
 *  voci dell'istanza, e viceversa. */
export async function updateGlossaryTerm(
  id: string,
  eventId: string | null,
  patch: GlossaryTermPatch,
  db: Db = prisma,
): Promise<GlossaryEntry> {
  const attuale = await db.glossaryTerm.findFirst({ where: { id, eventId }, select: { id: true } });
  if (!attuale) throw new NotFoundError('Glossary term');
  if (patch.term !== undefined) await termineGiaUsato(db, eventId, patch.term, id);
  const row = await db.glossaryTerm.update({ where: { id }, data: datiVoce(patch) });
  return toGlossaryEntry(row);
}

export async function deleteGlossaryTerm(id: string, eventId: string | null, db: Db = prisma): Promise<void> {
  const { count } = await db.glossaryTerm.deleteMany({ where: { id, eventId } });
  if (count === 0) throw new NotFoundError('Glossary term');
}

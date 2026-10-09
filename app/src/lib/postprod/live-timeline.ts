/**
 * La cronologia della sala per la post-produzione: cosa e' successo e quando,
 * sulla stessa base dei tempi della trascrizione (secondi dall'inizio della
 * registrazione), cosi' la sintesi sa collocare argomenti, sondaggi, domande e
 * reazioni accanto a cio' che si e' detto.
 *
 * Mette insieme due fonti, entrambe con l'ora del server:
 *  - il registro delle azioni dal vivo (live_actions, lib/live/actions.ts):
 *    agenda, sondaggi, «In una parola», stati delle domande, funzioni,
 *    registrazione, timer, mani alzate, fine evento;
 *  - le righe che un'ora ce l'hanno gia': domande del Q&A e domande in chat
 *    (il testo, mai chi le ha scritte), materiali condivisi, e l'attivita'
 *    della chat e delle reazioni contata per finestre di cinque minuti.
 *
 * Lo zero e' l'inizio del media (recordingTimeZero); quando e' stimato la
 * cronologia lo dice (`exact: false`), e i tempi possono allora essere
 * spostati anche di minuti rispetto alla trascrizione.
 */

import { Prisma } from '@prisma/client';

import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import type { LiveFlagField } from '@/lib/live-state/pubsub';
import { normalizeWord } from '@/lib/wordcloud/normalize';

export interface TimelineEntry {
  /** Secondi dall'inizio della registrazione (negativi: prima). */
  offsetSec: number;
  kind: string;
  text: string;
}

/** Un capitolo della registrazione: un argomento dell'agenda avviato. */
export interface TimelineChapter {
  /** Secondi dall'inizio della registrazione (0 se avviato prima). */
  offsetSec: number;
  title: string;
}

export interface LiveTimeline {
  /** Ora del server dello zero. */
  t0: string;
  /** Vero se lo zero e' l'inizio del media, falso se approssimato. */
  exact: boolean;
  entries: TimelineEntry[];
  /**
   * Gli argomenti dell'agenda nell'ordine in cui chi conduce li ha avviati:
   * i capitoli della registrazione, con l'ora dichiarata in sala. Quello in
   * corso quando la registrazione e' partita apre a zero. Vuoto se la
   * agenda non e' stata usata.
   */
  chapters: TimelineChapter[];
}

/**
 * I capitoli dagli argomenti dell'agenda (`agenda.topic`), in ordine di
 * tempo.
 *
 * Prima dello zero conta solo l'argomento in corso quando la registrazione
 * parte, che la apre: l'ultimo avviato (CURRENT), purche' nel frattempo non
 * sia stato concluso, saltato o riaperto (ogni altro stato dello stesso
 * argomento lo chiude). Dopo lo zero ogni avvio apre un capitolo; due avvii di
 * seguito dello stesso argomento sono uno.
 *
 * `fine` e' la fine della registrazione: un argomento avviato da li' in poi
 * non e' nella registrazione e non e' un suo capitolo.
 */
export function chaptersFromActions(
  azioni: ReadonlyArray<{ at: Date; kind: string; data: unknown }>,
  t0: Date,
  fine?: Date | null,
): TimelineChapter[] {
  const voci = azioni
    .filter((a) => a.kind === 'agenda.topic')
    .map((a) => {
      const data = (a.data && typeof a.data === 'object' ? a.data : {}) as Record<string, unknown>;
      const label = str(data.label).trim();
      return {
        at: a.at,
        id: str(data.itemId) || label,
        // Un avvio vale solo con un titolo da mostrare.
        avvio: data.status === 'CURRENT' && label.length > 0,
        label: data.label,
      };
    })
    .filter((v) => v.id.length > 0)
    .sort((x, y) => x.at.getTime() - y.at.getTime());

  let inCorso: { id: string; title: string } | null = null;
  const out: Array<TimelineChapter & { id: string }> = [];
  for (const v of voci) {
    const offsetSec = Math.round((v.at.getTime() - t0.getTime()) / 1000);
    if (offsetSec <= 0) {
      if (v.avvio) inCorso = { id: v.id, title: cita(v.label) };
      else if (inCorso?.id === v.id) inCorso = null;
      continue;
    }
    if (fine && v.at.getTime() >= fine.getTime()) break;
    if (!v.avvio) continue;
    // L'argomento in corso allo zero apre la registrazione.
    if (inCorso) {
      out.push({ id: inCorso.id, offsetSec: 0, title: inCorso.title });
      inCorso = null;
    }
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.id === v.id) continue;
    out.push({ id: v.id, offsetSec, title: cita(v.label) });
  }
  if (inCorso) out.push({ id: inCorso.id, offsetSec: 0, title: inCorso.title });
  return out.map(({ offsetSec, title }) => ({ offsetSec, title }));
}

/** Quanto prima dello zero si guarda: una domanda preparata o un sondaggio
 *  aperto prima di avviare la registrazione sono contesto. */
const BEFORE_MS = 30 * 60_000;
/** Dopo la fine: le chiusure arrivano qualche istante dopo. */
const AFTER_MS = 5 * 60_000;
/** Finestra di conteggio di chat, reazioni e mani alzate. */
const BUCKET_MS = 5 * 60_000;
/** Righe dell'agenda lette per i capitoli: ben oltre ogni agenda vera,
 *  solo un tetto alla lettura. */
const MAX_AGENDA_ACTIONS = 1_000;
/** Voci al massimo: oltre, il prompt non le regge. */
const MAX_ENTRIES = 250;
/** Lunghezza massima di un testo citato. */
const MAX_TEXT = 280;

/** Le funzioni che chi modera accende e spegne durante l'evento: una per
 *  ogni flag attivabile dal vivo, e il compilatore pretende che ci siano
 *  tutte (un flag nuovo senza nome qui sparirebbe dalla cronologia). */
const FEATURE_NAMES: Record<LiveFlagField, string> = {
  qaEnabled: 'Q&A',
  chatEnabled: 'chat',
  wordCloudEnabled: '«In una parola»',
  agendaEnabled: 'agenda',
  recordingEnabled: 'registrazione',
};

function cita(testo: unknown): string {
  const t = String(testo ?? '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Il testo di un'azione del registro; null se non va in cronologia. */
export function describeAction(
  kind: string,
  data: Record<string, unknown>,
  domande: ReadonlyMap<string, { text: string; answerText: string | null }>,
): string | null {
  switch (kind) {
    case 'agenda.topic': {
      const label = cita(data.label);
      const stato: Record<string, string> = {
        CURRENT: 'Argomento avviato',
        DONE: 'Argomento concluso',
        SKIPPED: 'Argomento saltato',
        PENDING: 'Argomento riaperto',
      };
      const verbo = stato[str(data.status)];
      return verbo && label ? `${verbo}: «${label}»` : null;
    }
    case 'poll.opened': {
      const opzioni = Array.isArray(data.options) ? data.options.map(cita).join(' / ') : '';
      return `Sondaggio aperto: «${cita(data.question)}»${opzioni ? ` (risposte: ${opzioni})` : ''}`;
    }
    case 'poll.closed':
    case 'poll.published': {
      const opzioni = Array.isArray(data.options) ? data.options : [];
      const conti = Array.isArray(data.counts) ? data.counts : [];
      const risultati = opzioni.map((o, i) => `${cita(o)} ${Number(conti[i] ?? 0)}`).join(', ');
      const totale = Number(data.totalVotes ?? 0);
      const verbo = kind === 'poll.closed' ? 'Sondaggio chiuso' : 'Risultati del sondaggio pubblicati';
      return `${verbo}: «${cita(data.question)}» — ${risultati} (${totale} voti)`;
    }
    case 'poll.reopened':
      return `Sondaggio riaperto: «${cita(data.question)}»`;
    case 'poll.deleted':
      return `Sondaggio eliminato: «${cita(data.question)}»`;
    case 'wordcloud.opened':
      return `Domanda «In una parola»: «${cita(data.prompt)}»`;
    case 'wordcloud.closed': {
      const parole = Array.isArray(data.words)
        ? data.words
            .map((w) => (w && typeof w === 'object' ? (w as { word?: unknown; count?: unknown }) : null))
            .filter((w): w is { word?: unknown; count?: unknown } => w !== null)
            .map((w) => `${cita(w.word)} (${Number(w.count ?? 0)})`)
            .join(', ')
        : '';
      return `Risposte a «${cita(data.prompt)}»: ${parole || 'nessuna'}`;
    }
    case 'wordcloud.word_removed':
      return 'Il moderatore ha tolto una parola dalla nuvola';
    case 'question.status': {
      const q = domande.get(str(data.questionId));
      if (!q) return null;
      if (data.status === 'DISMISSED') return null;
      if (data.answered && q.answerText) {
        return `Risposta scritta alla domanda «${cita(q.text)}»: «${cita(q.answerText)}»`;
      }
      if (data.status === 'ANSWERED') return `Domanda segnata come risposta: «${cita(q.text)}»`;
      if (data.status === 'HIGHLIGHTED') return `Domanda messa in evidenza: «${cita(q.text)}»`;
      return null;
    }
    case 'feature.toggled': {
      const chiave = str(data.feature);
      const nome = chiave in FEATURE_NAMES ? FEATURE_NAMES[chiave as LiveFlagField] : null;
      if (!nome) return null;
      return `Funzione ${nome} ${data.enabled ? 'attivata' : 'disattivata'}`;
    }
    case 'recording.started':
      return 'Registrazione avviata';
    case 'recording.stopped':
      return 'Registrazione fermata';
    case 'timer.started': {
      const min = Math.round(Number(data.durationSec ?? 0) / 60);
      return min > 0 ? `Timer di ${min} minuti avviato` : 'Timer avviato';
    }
    case 'timer.stopped':
      return 'Timer fermato';
    case 'event.ended':
      return 'Evento terminato dal moderatore';
    default:
      // chat.hidden, chat.question.status, hand.*: non entrano una per una
      // (le mani alzate si contano per finestra).
      return null;
  }
}

interface Fatto {
  at: Date;
  kind: string;
  text: string;
  /** Si sacrifica per prima quando le voci sono troppe. */
  minore?: boolean;
}

interface Conteggio {
  /** Finestra: quante di cinque minuti dall'inizio della registrazione. */
  b: number;
  n: number;
}

/** Dove si contano chat, reazioni e mani alzate: tabella, colonna dell'ora,
 *  condizioni in piu'. Costanti, mai input. */
const FONTI_CONTEGGI = {
  chat: { tabella: 'chat_messages', colonna: 'created_at', filtro: Prisma.sql`AND "hidden_at" IS NULL` },
  reactions: { tabella: 'reactions', colonna: 'created_at', filtro: Prisma.empty },
  hands: { tabella: 'live_actions', colonna: 'at', filtro: Prisma.sql`AND "kind" = 'hand.raised'` },
} as const;

/**
 * Chat, reazioni e mani alzate contate in SQL per finestre di cinque minuti
 * allineate allo zero della registrazione: la cronologia riceve poche righe
 * anche quando i messaggi sono migliaia. Le colonne sono `timestamp` in UTC:
 * il filtro confronta la colonna con estremi convertiti in UTC (cosi' usa
 * l'indice su evento e ora), e `extract(epoch ...)` da' i secondi giusti per
 * la finestra.
 */
async function contaPerFinestra(
  fonte: keyof typeof FONTI_CONTEGGI,
  eventId: string,
  t0: Date,
  da: Date,
  a: Date,
): Promise<Conteggio[]> {
  const { tabella, colonna, filtro } = FONTI_CONTEGGI[fonte];
  const col = Prisma.raw(`"${colonna}"`);
  return prisma.$queryRaw<Conteggio[]>`
    SELECT floor((extract(epoch from ${col}) - ${t0.getTime() / 1000}) / ${BUCKET_MS / 1000})::int AS b,
           count(*)::int AS n
    FROM ${Prisma.raw(`"${tabella}"`)}
    WHERE "event_id" = ${eventId}::uuid
      AND ${col} BETWEEN (${da.toISOString()}::timestamptz AT TIME ZONE 'UTC')
                     AND (${a.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      ${filtro}
    GROUP BY 1`;
}

export async function buildLiveTimeline(opts: {
  eventId: string;
  t0: Date;
  exact: boolean;
  /**
   * La fine della registrazione (lo zero piu' la durata) quando se ne sa la
   * durata; altrimenti la fine della sessione, o adesso. Un argomento avviato
   * da qui in poi non e' un capitolo.
   */
  until: Date;
}): Promise<LiveTimeline> {
  const { eventId, t0 } = opts;
  const da = new Date(t0.getTime() - BEFORE_MS);
  const a = new Date(opts.until.getTime() + AFTER_MS);
  const nellaFinestra = { gte: da, lte: a };

  const [azioni, agenda, domande, domandeChat, materiali, chat, reazioni, mani] = await Promise.all([
    prisma.liveAction.findMany({
      where: { eventId, at: nellaFinestra, kind: { notIn: ['hand.raised', 'hand.lowered'] } },
      orderBy: { at: 'asc' },
      select: { at: true, kind: true, data: true },
    }),
    // Per i capitoli l'agenda si legge dall'inizio dell'evento, non dalla
    // finestra: l'argomento in corso quando parte la registrazione puo' essere
    // stato avviato ben prima dei trenta minuti di contesto.
    prisma.liveAction.findMany({
      where: { eventId, kind: 'agenda.topic', at: { lte: opts.until } },
      orderBy: { at: 'desc' },
      take: MAX_AGENDA_ACTIONS,
      select: { at: true, kind: true, data: true },
    }),
    prisma.question.findMany({
      where: { eventId },
      select: { id: true, text: true, answerText: true, status: true, createdAt: true },
    }),
    prisma.chatMessage.findMany({
      where: { eventId, isQuestion: true, hiddenAt: null, dismissedAt: null, createdAt: nellaFinestra },
      select: { text: true, createdAt: true },
    }),
    prisma.eventMaterial.findMany({
      where: { eventId, createdAt: nellaFinestra },
      select: { title: true, createdAt: true },
    }),
    contaPerFinestra('chat', eventId, t0, da, a),
    contaPerFinestra('reactions', eventId, t0, da, a),
    contaPerFinestra('hands', eventId, t0, da, a),
  ]);

  // Le parole tolte dal moderatore dopo la chiusura di una domanda non
  // devono arrivare alla sintesi: la fotografia della chiusura le contiene
  // ancora, si filtrano qui sulle righe nascoste di quei giri.
  const giri = azioni
    .filter((az) => az.kind === 'wordcloud.closed')
    .map((az) => str((az.data as Record<string, unknown> | null)?.roundId))
    .filter((id) => id.length > 0);
  const tolte = new Map<string, Set<string>>();
  if (giri.length > 0) {
    const nascoste = await prisma.wordCloudSubmission.findMany({
      where: { roundId: { in: giri }, hiddenAt: { not: null } },
      select: { roundId: true, word: true },
    });
    for (const n of nascoste) {
      const insieme = tolte.get(n.roundId) ?? new Set<string>();
      insieme.add(normalizeWord(n.word));
      tolte.set(n.roundId, insieme);
    }
  }

  const perId = new Map(domande.map((q) => [q.id, { text: q.text, answerText: q.answerText }]));
  const fatti: Fatto[] = [];

  for (const az of azioni) {
    let data = (az.data && typeof az.data === 'object' ? az.data : {}) as Record<string, unknown>;
    const via = tolte.get(str(data.roundId));
    if (az.kind === 'wordcloud.closed' && via && Array.isArray(data.words)) {
      data = {
        ...data,
        words: data.words.filter(
          (w) => !(w && typeof w === 'object' && via.has(normalizeWord(str((w as { word?: unknown }).word)))),
        ),
      };
    }
    const testo = describeAction(az.kind, data, perId);
    if (testo) fatti.push({ at: az.at, kind: az.kind, text: testo });
  }

  for (const q of domande) {
    if (q.status === 'DISMISSED') continue;
    if (q.createdAt < da || q.createdAt > a) continue;
    fatti.push({ at: q.createdAt, kind: 'question.asked', text: `Domanda dal pubblico (Q&A): «${cita(q.text)}»` });
  }
  for (const m of domandeChat) {
    // Il testo della chat e' cifrato a riposo.
    const testo = tryDecryptPII(m.text);
    if (!testo) continue;
    fatti.push({
      at: m.createdAt,
      kind: 'chat.question',
      text: `Domanda in chat: «${cita(testo)}»`,
      minore: true,
    });
  }
  for (const m of materiali) {
    fatti.push({ at: m.createdAt, kind: 'material.added', text: `Materiale condiviso: «${cita(m.title)}»` });
  }

  const inizioFinestra = (b: number) => new Date(t0.getTime() + b * BUCKET_MS);
  for (const c of chat) {
    fatti.push({
      at: inizioFinestra(c.b),
      kind: 'chat.activity',
      text: `Chat: ${c.n} ${c.n === 1 ? 'messaggio' : 'messaggi'} in cinque minuti`,
      minore: true,
    });
  }
  for (const r of reazioni) {
    fatti.push({
      at: inizioFinestra(r.b),
      kind: 'reactions.activity',
      text: `Reazioni: ${r.n} in cinque minuti`,
      minore: true,
    });
  }
  for (const h of mani) {
    fatti.push({
      at: inizioFinestra(h.b),
      kind: 'hand.raised',
      text: h.n === 1 ? 'Una mano alzata' : `${h.n} mani alzate in cinque minuti`,
    });
  }

  fatti.sort((x, y) => x.at.getTime() - y.at.getTime());

  // Troppe voci: via per prime quelle minori (attivita' e domande in chat),
  // dalle piu' vecchie; poi, se serve ancora, le piu' vecchie in assoluto.
  let scelti = fatti;
  if (scelti.length > MAX_ENTRIES) {
    let daTogliere = scelti.length - MAX_ENTRIES;
    scelti = scelti.filter((f) => {
      if (daTogliere > 0 && f.minore) {
        daTogliere--;
        return false;
      }
      return true;
    });
    if (scelti.length > MAX_ENTRIES) scelti = scelti.slice(scelti.length - MAX_ENTRIES);
  }

  return {
    t0: t0.toISOString(),
    exact: opts.exact,
    chapters: chaptersFromActions(agenda, t0, opts.until),
    entries: scelti.map((f) => ({
      offsetSec: Math.round((f.at.getTime() - t0.getTime()) / 1000),
      kind: f.kind,
      text: f.text,
    })),
  };
}

/**
 * Lo zero dei tempi di una registrazione, e se e' esatto.
 *  - Inizio del media mandato dal registratore multitraccia: esatto.
 *  - Registrazione composita (Jibri) con l'avvio riferito dalla sala
 *    (`recording.started` nella cronologia): esatto a pochi secondi.
 *  - Registrazione multitraccia senza quell'ora: la creazione della
 *    registrazione, che avviene quando la sala va in diretta; il primo
 *    fotogramma puo' arrivare anche minuti dopo. Approssimato.
 *  - Registrazione composita senza avvio riferito: la riga nasce a file
 *    caricato, quindi la creazione meno la durata; approssimato (il
 *    caricamento sposta la creazione in avanti).
 */
export function recordingTimeZero(r: {
  mediaStartedAt: Date | null;
  createdAt: Date;
  durationSec: number | null;
  multitrack: boolean;
  /** L'ultimo `recording.started` della cronologia prima della creazione. */
  journaledStart?: Date | null;
}): { t0: Date; exact: boolean } {
  if (r.mediaStartedAt) return { t0: r.mediaStartedAt, exact: true };
  if (!r.multitrack && r.journaledStart) return { t0: r.journaledStart, exact: true };
  if (!r.multitrack && r.durationSec && r.durationSec > 0) {
    return { t0: new Date(r.createdAt.getTime() - r.durationSec * 1000), exact: false };
  }
  return { t0: r.createdAt, exact: false };
}

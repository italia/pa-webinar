/**
 * I momenti della diretta sul tempo del video pubblicato: gli argomenti
 * dell'agenda, le presentazioni, i sondaggi con i risultati, le domande
 * trattate e le risposte di «In una parola». La pagina dell'evento li mostra
 * accanto alla registrazione, e un clic porta al punto del video.
 *
 * L'ora viene dal registro delle azioni dal vivo (lib/live/actions.ts) e
 * dall'ora in cui una domanda e' stata trattata. Lo zero e lo scarto sono
 * quelli delle slide sincronizzate (lib/presentation/recording-slides-data),
 * cosi' momenti e slide cadono negli stessi secondi.
 *
 * Il contenuto no: domande, sondaggi e materiali sono quelli che la pagina ha
 * gia' letto con le sue regole (`ReplaySources`), cosi' una sezione nascosta,
 * una domanda non pubblica o un materiale «solo durante l'evento» non
 * rientrano da qui, e i voti e i titoli sono quelli delle schede. In memoria
 * resta solo il registro, come per le slide: le scelte dello staff (scarto,
 * slide accese, parole nascoste) si rileggono a ogni richiesta.
 */
import { registrazioneConVideo } from '@/lib/captions/transcript';
import { getCached, setCache } from '@/lib/cache';
import { prisma } from '@/lib/db';
import { chaptersFromActions, paroleTolteDaiGiri } from '@/lib/postprod/live-timeline';
import {
  recordingOfEventVideo,
  tempiDelVideo,
} from '@/lib/presentation/recording-slides-data';
import { normalizeWord } from '@/lib/wordcloud/normalize';

export type ReplayMoment =
  | { kind: 'topic'; offsetSec: number; title: string }
  | { kind: 'presentation'; offsetSec: number; title: string }
  | {
      kind: 'poll';
      offsetSec: number;
      question: string;
      results: Array<{ option: string; count: number }>;
      totalVotes: number;
    }
  | { kind: 'question'; offsetSec: number; question: string; answer: string | null }
  | {
      kind: 'wordcloud';
      offsetSec: number;
      prompt: string;
      words: Array<{ word: string; count: number }>;
    };

/** Cio' che la pagina pubblica mostra gia', con le sue regole. */
export interface ReplaySources {
  /** Le domande della scheda delle domande. */
  questions: ReadonlyArray<{
    id: string;
    text: string;
    answerText: string | null;
    answeredAt: Date | null;
    highlightedAt: Date | null;
  }>;
  /** I sondaggi della scheda dei sondaggi, con i voti di adesso. */
  polls: ReadonlyArray<{
    id: string;
    question: string;
    options: string[];
    voteCounts: number[];
    totalVotes: number;
  }>;
  /** I materiali visibili dopo l'evento, con il titolo di adesso. */
  materials: ReadonlyArray<{ id: string; title: string }>;
  /** Le risposte di «In una parola» sono mostrate dopo l'evento. */
  showWordCloud: boolean;
}

type Azione = { at: Date; kind: string; data: unknown };
/** Il registro di una registrazione, in memoria qualche secondo. */
interface Registro {
  t0Ms: number;
  fineMs: number;
  agenda: Azione[];
  azioni: Azione[];
}

/** Quanto resta in memoria il registro di una registrazione, come per le slide. */
const TTL_MS = 30_000;
/** Il registro si legge un po' oltre il video: lo scarto lo puo' spostare. */
const MARGINE_MS = 10 * 60_000;
/** Momenti al massimo: una lista che si legge, non un registro. */
const MAX_MOMENTI = 200;
/** Parole di «In una parola» mostrate per giro. */
const MAX_PAROLE = 12;
/** Lunghezza massima di un testo citato. */
const MAX_TESTO = 400;
/** Argomenti dell'agenda letti al massimo: ben oltre ogni agenda vera. */
const MAX_AGENDA = 1_000;

const testo = (v: unknown): string => {
  const t = String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > MAX_TESTO ? `${t.slice(0, MAX_TESTO - 1)}…` : t;
};
const oggetto = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/**
 * I momenti del video dell'evento, in ordine di tempo; null se il video non
 * e' una registrazione composita della sala (un file caricato a mano non ha
 * cronologia; tracce e trascrizione dai sottotitoli non hanno quello zero).
 */
export async function replayMoments(
  event: { id: string; recordingUrl: string | null },
  fonti: ReplaySources
): Promise<ReplayMoment[] | null> {
  if (!event.recordingUrl) return null;
  const recording = await recordingOfEventVideo(event.id, event.recordingUrl);
  if (!recording || !registrazioneConVideo(recording)) return null;

  const { t0Ms, fineMs, agenda, azioni } = await registroInMemoria(event.id, recording);

  const durata = Math.round((fineMs - t0Ms) / 1000);
  const scarto = recording.slidesOffsetSec ?? 0;
  const secondi = (at: Date) => Math.round((at.getTime() - t0Ms) / 1000) + scarto;
  const nelVideo = (offsetSec: number) => offsetSec >= 0 && offsetSec <= durata;

  const momenti: ReplayMoment[] = [];

  // Argomenti: quello in corso allo zero del video lo apre (a zero); uno
  // avviato prima dello zero per effetto dello scarto prende il suo posto,
  // come per le slide; oltre la fine non c'e'.
  let apertura: { title: string } | null = null;
  for (const c of chaptersFromActions(agenda, new Date(t0Ms), new Date(fineMs))) {
    const offsetSec = c.offsetSec === 0 ? 0 : c.offsetSec + scarto;
    if (offsetSec <= 0) apertura = { title: c.title };
    else if (offsetSec <= durata)
      momenti.push({ kind: 'topic', offsetSec, title: c.title });
  }
  if (apertura) momenti.push({ kind: 'topic', offsetSec: 0, title: apertura.title });

  // Presentazioni: solo materiali che la pagina mostra, con il loro titolo di
  // adesso, e solo se lo staff ha lasciato accese le slide della registrazione.
  const materiali = new Map(fonti.materials.map((m) => [m.id, m.title]));
  // Sondaggi: quelli della scheda, all'ora dell'ultima pubblicazione.
  const sondaggi = new Map(fonti.polls.map((p) => [p.id, p]));
  const ultimaPubblicazione = new Map<string, Date>();
  // Domande: dal momento in cui chi conduce le ha messe in evidenza (la
  // discussione comincia li'), altrimenti da quando sono state segnate come risposte.
  const inEvidenza = new Map<string, Date>();
  for (const a of azioni) {
    const data = oggetto(a.data);
    if (a.kind === 'poll.published' && sondaggi.has(String(data.pollId ?? ''))) {
      ultimaPubblicazione.set(String(data.pollId), a.at);
    }
    if (a.kind === 'question.status' && data.status === 'HIGHLIGHTED') {
      const id = String(data.questionId ?? '');
      if (id && !inEvidenza.has(id)) inEvidenza.set(id, a.at);
    }
  }
  // «In una parola»: le parole tolte dal moderatore dopo la chiusura restano
  // fuori anche se la fotografia della chiusura le contiene.
  const tolte = fonti.showWordCloud
    ? await paroleTolteDaiGiri(
        azioni
          .filter((a) => a.kind === 'wordcloud.closed')
          .map((a) => String(oggetto(a.data).roundId ?? ''))
      )
    : new Map<string, Set<string>>();

  for (const a of azioni) {
    const data = oggetto(a.data);
    const offsetSec = secondi(a.at);
    if (!nelVideo(offsetSec)) continue;
    if (a.kind === 'presentation.started') {
      const title = materiali.get(String(data.materialId ?? ''));
      if (title && data.handover !== true && recording.slidesEnabled) {
        momenti.push({ kind: 'presentation', offsetSec, title: testo(title) });
      }
    } else if (a.kind === 'poll.published') {
      const id = String(data.pollId ?? '');
      const poll = sondaggi.get(id);
      if (!poll || ultimaPubblicazione.get(id) !== a.at) continue;
      momenti.push({
        kind: 'poll',
        offsetSec,
        question: testo(poll.question),
        results: poll.options.map((o, i) => ({
          option: testo(o),
          count: poll.voteCounts[i] ?? 0,
        })),
        totalVotes: poll.totalVotes,
      });
    } else if (a.kind === 'wordcloud.closed' && fonti.showWordCloud) {
      const via = tolte.get(String(data.roundId ?? '')) ?? new Set<string>();
      const words = (Array.isArray(data.words) ? data.words : [])
        .map(oggetto)
        .map((w) => ({ word: testo(w.word), count: Number(w.count ?? 0) || 0 }))
        .filter((w) => w.word.length > 0 && !via.has(normalizeWord(w.word)))
        .slice(0, MAX_PAROLE);
      if (words.length > 0)
        momenti.push({ kind: 'wordcloud', offsetSec, prompt: testo(data.prompt), words });
    }
  }

  // Una domanda rimessa in attesa non ha piu' un'ora: resta solo nella scheda.
  for (const d of fonti.questions) {
    const quando = inEvidenza.get(d.id) ?? d.highlightedAt ?? d.answeredAt;
    if (!quando) continue;
    const offsetSec = secondi(quando);
    if (!nelVideo(offsetSec)) continue;
    momenti.push({
      kind: 'question',
      offsetSec,
      question: testo(d.text),
      answer: d.answerText ? testo(d.answerText) : null,
    });
  }

  return momenti.sort((x, y) => x.offsetSec - y.offsetSec).slice(0, MAX_MOMENTI);
}

/** Zero, fine del video e azioni del registro che servono ai momenti. */
async function leggiRegistro(
  eventId: string,
  recording: NonNullable<Awaited<ReturnType<typeof recordingOfEventVideo>>>
): Promise<Registro> {
  const tempi = await tempiDelVideo(recording);
  const t0Ms = tempi.t0.getTime();
  // La fine del video: la sua durata o, se non si sa, l'arrivo del file.
  const fineMs = tempi.durationSec
    ? t0Ms + tempi.durationSec * 1000
    : (recording.callSession?.endedAt ?? recording.createdAt).getTime();
  const [agenda, azioni] = await Promise.all([
    // L'argomento in corso all'avvio della registrazione puo' essere stato
    // avviato molto prima: l'agenda si legge dall'inizio (come la sintesi).
    prisma.liveAction.findMany({
      where: {
        eventId,
        kind: 'agenda.topic',
        at: { lte: new Date(fineMs + MARGINE_MS) },
      },
      orderBy: { at: 'asc' },
      take: MAX_AGENDA,
      select: { at: true, kind: true, data: true },
    }),
    prisma.liveAction.findMany({
      where: {
        eventId,
        kind: {
          in: [
            'presentation.started',
            'poll.published',
            'wordcloud.closed',
            'question.status',
          ],
        },
        at: { gte: new Date(t0Ms - MARGINE_MS), lte: new Date(fineMs + MARGINE_MS) },
      },
      orderBy: { at: 'asc' },
      take: 5_000,
      select: { at: true, kind: true, data: true },
    }),
  ]);
  return { t0Ms, fineMs, agenda, azioni };
}

type RegistrazioneDelVideo = NonNullable<
  Awaited<ReturnType<typeof recordingOfEventVideo>>
>;

/** Letture del registro in corso, per registrazione: chi arriva insieme
 *  aspetta la stessa invece di rifarla (momenti e programma della stessa pagina). */
const inLettura = new Map<string, Promise<Registro>>();

/** Il registro della registrazione, riletto al piu' ogni qualche secondo. */
async function registroInMemoria(
  eventId: string,
  recording: RegistrazioneDelVideo
): Promise<Registro> {
  const chiave = `replay-journal:${recording.id}`;
  const salvato = getCached<Registro>(chiave);
  if (salvato) return salvato;
  let lettura = inLettura.get(chiave);
  if (!lettura) {
    lettura = leggiRegistro(eventId, recording)
      .then((registro) => {
        setCache(chiave, registro, TTL_MS);
        return registro;
      })
      .finally(() => inLettura.delete(chiave));
    inLettura.set(chiave, lettura);
  }
  return lettura;
}

/** Il punto del video di un argomento del programma, e quanto e' durato. */
export interface ProgrammeVideoTime {
  /** Quando l'argomento e' cominciato per la prima volta nel video. */
  offsetSec: number;
  /** Il tempo passato sull'argomento nel video, sommando le riprese. */
  durationSec: number;
}

/**
 * Per ogni argomento del programma discusso durante il video, il minuto in
 * cui e' cominciato e quanto e' durato: il programma della pagina diventa un
 * indice della registrazione. Dal registro delle azioni, come i momenti: un
 * argomento corre dal suo avvio al successivo, alla sua chiusura o alla fine
 * del video, e un argomento ripreso somma i tratti. Quello in corso allo zero
 * apre il video a 0:00 (come nei momenti); gli altri prendono lo scarto delle
 * slide. Null se il video non e' una registrazione composita della sala.
 */
export async function programmeVideoTimes(event: {
  id: string;
  recordingUrl: string | null;
}): Promise<Record<string, ProgrammeVideoTime> | null> {
  if (!event.recordingUrl) return null;
  const recording = await recordingOfEventVideo(event.id, event.recordingUrl);
  if (!recording || !registrazioneConVideo(recording)) return null;
  const { t0Ms, fineMs, agenda } = await registroInMemoria(event.id, recording);
  const durata = Math.round((fineMs - t0Ms) / 1000);
  const scarto = recording.slidesOffsetSec ?? 0;
  // Secondi nel video: prima dello zero si resta a zero, come l'apertura.
  // Anche con lo scarto non si esce dal video: uno scarto negativo porta a
  // zero gli argomenti dei primi secondi, e li' apre quello in corso, come
  // nei momenti.
  const secondi = (ms: number) => {
    const grezzi = Math.round((ms - t0Ms) / 1000);
    return grezzi <= 0 ? 0 : Math.max(0, Math.min(durata, grezzi + scarto));
  };

  // I tratti di ogni argomento, dal registro in ordine di tempo.
  const tratti: Array<{ id: string; da: number; a: number }> = [];
  let corrente = null as { id: string; da: number } | null;
  // Il registro e' gia' in ordine di tempo. Qui servono gli id e la fine di
  // ogni tratto, che i capitoli dei momenti (chaptersFromActions) non danno.
  for (const az of agenda) {
    const data = oggetto(az.data);
    const id = String(data.itemId ?? '');
    const ms = az.at.getTime();
    if (!id || ms > fineMs) continue;
    if (data.status === 'CURRENT') {
      if (corrente?.id === id) continue;
      if (corrente) tratti.push({ id: corrente.id, da: corrente.da, a: ms });
      corrente = { id, da: ms };
    } else if (corrente?.id === id) {
      tratti.push({ id, da: corrente.da, a: ms });
      corrente = null;
    }
  }
  // L'ultimo argomento mai chiuso corre fino alla fine del video.
  if (corrente)
    tratti.push({ id: corrente.id, da: corrente.da, a: Number.POSITIVE_INFINITY });

  const out: Record<string, ProgrammeVideoTime> = {};
  for (const t of tratti) {
    if (t.a <= t0Ms) continue;
    const da = secondi(t.da);
    const a = Number.isFinite(t.a) ? secondi(t.a) : durata;
    // Un tratto che nel video non dura niente non e' nel video.
    if (a <= da) continue;
    const prima = out[t.id];
    out[t.id] = prima
      ? {
          offsetSec: Math.min(prima.offsetSec, da),
          durationSec: prima.durationSec + Math.max(0, a - da),
        }
      : { offsetSec: da, durationSec: Math.max(0, a - da) };
  }
  // Senza argomenti nel video non c'e' un indice da mostrare.
  return Object.keys(out).length > 0 ? out : null;
}

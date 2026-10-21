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

  const chiave = `replay-journal:${recording.id}`;
  let registro = getCached<Registro>(chiave);
  if (!registro) {
    registro = await leggiRegistro(event.id, recording);
    setCache(chiave, registro, TTL_MS);
  }
  const { t0Ms, fineMs, agenda, azioni } = registro;

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

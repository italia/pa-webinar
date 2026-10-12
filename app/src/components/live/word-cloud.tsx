'use client';

import { useState, useEffect, useCallback } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import useSWR from 'swr';
import { Button } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { useLivePush } from '@/hooks/use-live-state';
import { normalizeWord, WORD_ROUND_NO_LIMIT } from '@/lib/wordcloud/normalize';

import { roomReadHeaders, wordSubmitErrorKey, wordSubmitInit } from './word-cloud-request';

interface WordCloudProps {
  eventSlug: string;
  /** Token di sala: prova di presenza di chi conduce, non un'identità. */
  token: string;
  isModerator: boolean;
  /** Identità con cui si scrive una parola: l'`accessToken` di una
   *  registrazione… */
  voterAccessToken?: string;
  /** …oppure l'identificativo stabile del browser, per chi una registrazione
   *  non ce l'ha (ospiti, relatori, moderatori). Esattamente uno dei due. */
  voterGuestId?: string;
  /** La funzione e' accesa per la sala. Spenta, chi conduce vede comunque la
   *  scheda con la spiegazione: l'accende avviando la prima domanda. */
  enabled?: boolean;
  /** Accende la funzione per tutti; dice se il server l'ha accettato. */
  onEnable?: () => Promise<boolean>;
}

interface WordEntry {
  word: string;
  count: number;
}

interface RoundData {
  active: boolean;
  id?: string;
  prompt?: string;
  status?: string;
  duration?: number;
  createdAt?: string;
  totalSubmissions?: number;
  words?: WordEntry[];
}

/** Tre livelli per frequenza, tutti nel blu del design system: la parola piu'
 *  scritta in blu pieno e in grassetto, quelle di mezzo in blu scuro, le altre
 *  in grigio ardesia. La grandezza dice gia' la frequenza; il colore la
 *  rinforza senza inventare categorie che non ci sono. */
function wordTier(ratio: number): 'top' | 'mid' | 'low' {
  if (ratio >= 0.66) return 'top';
  if (ratio >= 0.33) return 'mid';
  return 'low';
}

/** La nuvola, uguale da aperta e da chiusa. */
function Cloud({ words, emptyText }: { words: WordEntry[]; emptyText?: string }) {
  const maxCount = words.reduce((max, w) => Math.max(max, w.count), 1);
  return (
    <div className="word-cloud__cloud">
      {words.length === 0 && emptyText && (
        <span className="word-cloud__waiting">{emptyText}</span>
      )}
      {words.map((w) => {
        const ratio = w.count / maxCount;
        return (
          <span
            key={w.word}
            className={`word-cloud__word word-cloud__word--${wordTier(ratio)}`}
            style={{ fontSize: `${15 + ratio * 25}px` }}
            title={`${w.word}: ${w.count}`}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
}

/** Le parole piu' scritte in elenco: la nuvola letta in ordine, con i numeri.
 *  Chi conduce le vede tutte, ciascuna con «Togli»: una parola offensiva puo'
 *  essere anche una sola, e non stare fra le prime cinque. */
function TopWords({
  words,
  title,
  onRemove,
  removeLabel,
  confirmLabel,
}: {
  words: WordEntry[];
  title: string;
  onRemove?: (word: string) => void;
  removeLabel?: string;
  confirmLabel?: string;
}) {
  const [armata, setArmata] = useState<string | null>(null);
  useEffect(() => {
    if (!armata) return;
    const timer = setTimeout(() => setArmata(null), 4000);
    return () => clearTimeout(timer);
  }, [armata]);

  const ordinate = [...words].sort((a, b) => b.count - a.count);
  const elenco = onRemove ? ordinate : ordinate.slice(0, 5);
  if (elenco.length === 0) return null;
  const max = elenco[0]?.count ?? 1;
  return (
    <div className="word-cloud__top">
      <p className="word-cloud__top-title">{title}</p>
      <ol className={`word-cloud__top-list${onRemove ? ' word-cloud__top-list--all' : ''}`}>
        {elenco.map((w) => (
          <li key={w.word} className={`word-cloud__top-row${onRemove ? ' has-action' : ''}`}>
            <span className="word-cloud__top-word">{w.word}</span>
            <span className="word-cloud__top-track" aria-hidden="true">
              <span style={{ width: `${Math.round((w.count / max) * 100)}%` }} />
            </span>
            <span className="word-cloud__top-count">{w.count}</span>
            {onRemove && (
              <button
                type="button"
                className={`word-cloud__remove${armata === w.word ? ' is-armed' : ''}`}
                aria-label={
                  armata === w.word ? `${removeLabel}: ${w.word} — ${confirmLabel}` : `${removeLabel}: ${w.word}`
                }
                title={removeLabel}
                onClick={() => {
                  if (armata !== w.word) {
                    setArmata(w.word);
                    return;
                  }
                  setArmata(null);
                  onRemove(w.word);
                }}
              >
                <Icon icon="it-close" size="xs" />
                {armata === w.word && confirmLabel}
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function WordCloud({
  eventSlug,
  token,
  isModerator,
  voterAccessToken,
  voterGuestId,
  enabled = true,
  onEnable,
}: WordCloudProps) {
  const t = useTranslations('wordcloud');
  const tc = useTranslations('common');
  const format = useFormatter();
  const pushLive = useLivePush();
  // Su SWR e non su un `fetch` a mano perché è la cache che il canale sa
  // toccare: l'avviso di cambiamento invalida per chiave, e uno stato locale
  // sarebbe invisibile.
  //
  // Il giro di lettura NON si spegne del tutto nemmeno con il canale attivo: è
  // la lettura stessa a chiudere un giro scaduto, e nessun lavoro periodico lo
  // fa al posto suo. Trenta secondi bastano perché la chiusura avvenga senza
  // tenere il server occupato.
  //
  // La lettura segue la regola degli altri pannelli: il token di sala va
  // mostrato, e l'ospite — che non ne ha uno — non manda un `Bearer ` vuoto.
  const { data: round = null, mutate: mutateRound } = useSWR<RoundData>(
    `/api/events/${eventSlug}/wordcloud`,
    (url: string) =>
      fetch(url, { headers: roomReadHeaders(token) }).then((r) => (r.ok ? r.json() : null)),
    { refreshInterval: pushLive ? 30_000 : 3000 },
  );
  const [inputWord, setInputWord] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // Una nuvola alla volta: un secondo Invio, o un tasto tenuto premuto, non
  // deve avviarne un'altra mentre la prima sta partendo.
  const [creating, setCreating] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(120);
  const [timeLeft, setTimeLeft] = useState(0);
  // Un invio respinto si dice: prima la parola spariva dal campo come se
  // fosse entrata, e chi scriveva non aveva modo di sapere che non era vero.
  const [error, setError] = useState<string | null>(null);
  // Le parole inviate da qui nel giro in corso: si vedono, per non mandare due
  // volte la stessa e per sapere che sono arrivate.
  const [mine, setMine] = useState<{ roundId: string; words: string[] }>({ roundId: '', words: [] });

  const fetchRound = useCallback(async () => {
    await mutateRound();
  }, [mutateRound]);

  // Il tempo residuo si ricava dal giro corrente, non si tiene per conto suo.
  useEffect(() => {
    if (round?.active && round.createdAt && round.duration) {
      const trascorso = (Date.now() - new Date(round.createdAt).getTime()) / 1000;
      setTimeLeft(Math.max(0, Math.round(round.duration - trascorso)));
    } else {
      setTimeLeft(0);
    }
  }, [round]);

  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  // Allo scadere del giro si rilegge: è la lettura a chiuderlo sul server, e
  // con il canale attivo la prossima arriverebbe fino a trenta secondi dopo,
  // con il campo ancora aperto a parole che verrebbero respinte. Uno scarto
  // casuale evita che la sala intera arrivi nello stesso istante. A decidere
  // resta il server: con l'orologio del client avanti la rilettura trova il
  // giro ancora aperto e non cambia nulla.
  const roundActive = round?.active ?? false;
  const roundCreatedAt = round?.createdAt;
  const roundDuration = round?.duration;
  const roundId = round?.id;

  // Un avviso vale per il giro in cui è nato: quando il giro si chiude o ne
  // parte un altro, lo dice già il pannello stesso.
  useEffect(() => {
    setError(null);
  }, [roundId, roundActive]);

  useEffect(() => {
    if (!roundActive || !roundCreatedAt || !roundDuration) return;
    const fine = new Date(roundCreatedAt).getTime() + roundDuration * 1000;
    const attesa = Math.max(0, fine - Date.now()) + 250 + Math.floor(Math.random() * 1500);
    const timer = setTimeout(() => void mutateRound(), attesa);
    return () => clearTimeout(timer);
  }, [roundActive, roundCreatedAt, roundDuration, mutateRound]);

  const handleCreateRound = useCallback(async () => {
    if (!prompt.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      // Funzione spenta: la prima domanda la accende per tutti, senza un
      // secondo passaggio dalla barra delle funzioni.
      if (!enabled && onEnable && !(await onEnable())) {
        setError(tc('errorGeneric'));
        return;
      }
      const res = await fetch(`/api/events/${eventSlug}/wordcloud`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt: prompt.trim(), duration }),
      });
      if (!res.ok) {
        setError(tc('errorGeneric'));
        return;
      }
      setShowCreate(false);
      setPrompt('');
    } catch {
      setError(tc('errorGeneric'));
    } finally {
      setCreating(false);
    }
    void fetchRound();
  }, [eventSlug, token, prompt, duration, creating, fetchRound, tc, enabled, onEnable]);

  const handleCloseRound = useCallback(async () => {
    if (!round?.id) return;
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventSlug}/wordcloud/${round.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) setError(tc('errorGeneric'));
    } catch {
      setError(tc('errorGeneric'));
    }
    void fetchRound();
  }, [eventSlug, token, round, fetchRound, tc]);

  // Il moderatore toglie una parola: sparisce per tutti e non si puo' rimandare.
  const handleRemoveWord = useCallback(async (word: string) => {
    if (!round?.id) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${eventSlug}/wordcloud/${round.id}/words?word=${encodeURIComponent(word)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) setError(tc('errorGeneric'));
    } catch {
      setError(tc('errorGeneric'));
    }
    void fetchRound();
  }, [eventSlug, token, round, fetchRound, tc]);

  const handleSubmitWord = useCallback(async () => {
    if (!inputWord.trim() || !round?.id || submitting) return;
    // Gia' mandata da qui: lo si dice subito, senza chiedere al server.
    const forma = normalizeWord(inputWord);
    if (mine.roundId === round.id && mine.words.some((w) => normalizeWord(w) === forma)) {
      setError(t('errors.duplicate'));
      return;
    }
    // Identità e prova di presenza: vedi word-cloud-request.
    const init = wordSubmitInit(inputWord.trim(), token, { voterAccessToken, voterGuestId });
    if (!init) {
      setError(t('errors.send'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventSlug}/wordcloud/${round.id}/submit`, init);
      if (res.ok) {
        const parola = normalizeWord(inputWord);
        const giro = round.id;
        setMine((cur) => ({
          roundId: giro,
          words: cur.roundId === giro ? [...cur.words, parola] : [parola],
        }));
        setInputWord('');
      } else {
        setError(t(await wordSubmitErrorKey(res)));
      }
    } catch {
      setError(t('errors.send'));
    }
    setSubmitting(false);
    // Si rilegge comunque: dopo un rifiuto la verità sul server (giro chiuso)
    // è già diversa da quella a schermo.
    void fetchRound();
  }, [inputWord, round, eventSlug, token, voterAccessToken, voterGuestId, submitting, fetchRound, t, mine]);

  // Vicino a dove si agisce: a giro aperto sopra il campo, perché con una
  // nuvola piena la cima del pannello è già fuori vista mentre si scrive.
  const avviso = error ? (
    <p className="qa-error" role="alert">
      {error}
    </p>
  ) : null;

  const mmss = `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`;
  const hasLastRound = !!round && !round.active && !!round.words && round.words.length > 0;
  const mieParole = round?.id && mine.roundId === round.id ? mine.words : [];

  // La spiegazione, per chi conduce: cosa fa e (se spenta) che la scheda
  // comparira' a tutti con la prima domanda.
  const introModeratore = (
    <div className="word-cloud__intro">
      <span className="word-cloud__intro-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
      </span>
      <div>
        <p className="word-cloud__intro-text">{t('emptyHintModerator')}</p>
        {!enabled && <p className="word-cloud__intro-note">{t('enableHint')}</p>}
      </div>
    </div>
  );

  return (
    <div className="word-cloud">
      <div className="live-panel-header">
        <h6 className="live-panel-header__title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0066CC" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
          </svg>
          {t('title')}
        </h6>
        {round?.active && round.duration === WORD_ROUND_NO_LIMIT && (
          <span className="word-cloud__timer">{t('durationUnlimited')}</span>
        )}
        {round?.active && timeLeft > 0 && (
          <span className="word-cloud__timer" role="timer" aria-label={t('timeLeft', { time: mmss })}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {mmss}
          </span>
        )}
      </div>

      {!round?.active && avviso}

      {isModerator && !round?.active && (
        <div className="mb-3">
          {showCreate ? (
            <div className="word-cloud__create">
              <label className="word-cloud__label" htmlFor="word-cloud-prompt">
                {t('prompt')}
              </label>
              <input
                id="word-cloud-prompt"
                type="text"
                className="word-cloud__field"
                placeholder={t('promptPlaceholder')}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && prompt.trim()) {
                    e.preventDefault();
                    void handleCreateRound();
                  }
                }}
                maxLength={200}
                autoFocus
              />
              <div className="word-cloud__label" id="word-cloud-duration">{t('duration')}</div>
              <div className="word-cloud__durations" role="group" aria-labelledby="word-cloud-duration">
                {[60, 120, 180, WORD_ROUND_NO_LIMIT].map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`word-cloud__duration${duration === d ? ' is-active' : ''}`}
                    aria-pressed={duration === d}
                    onClick={() => setDuration(d)}
                  >
                    {d === WORD_ROUND_NO_LIMIT
                      ? t('durationUnlimited')
                      : format.number(d / 60, { style: 'unit', unit: 'minute' })}
                  </button>
                ))}
              </div>
              <div className="word-cloud__create-actions">
                <Button color="secondary" outline size="sm" onClick={() => setShowCreate(false)}>
                  {t('cancel')}
                </Button>
                <Button color="primary" size="sm" onClick={handleCreateRound} disabled={!prompt.trim() || creating}>
                  {t('startRound')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {!hasLastRound && introModeratore}
              <button type="button" className="poll-new" onClick={() => setShowCreate(true)}>
                <Icon icon="it-plus-circle" size="sm" color="primary" />
                {t('startNew')}
              </button>
            </>
          )}
        </div>
      )}

      {round?.active && (
        <div className="word-cloud__round">
          <div className="word-cloud__question">
            <p className="word-cloud__prompt">{round.prompt}</p>
            <p className="word-cloud__how">{t('howItWorks')}</p>

            {/* Scrive chiunque sia in sala, chi conduce compreso: come nei
                sondaggi, anche il moderatore partecipa. Nascondergli il campo
                lasciava una sala di soli ospiti e moderatore senza nessuno che
                potesse scrivere. */}
            {avviso}
            <div className="word-cloud__compose">
              <input
                type="text"
                className="word-cloud__input"
                placeholder={t('submitPlaceholder')}
                aria-label={t('submitPlaceholder')}
                value={inputWord}
                onChange={(e) => setInputWord(e.target.value)}
                maxLength={30}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void handleSubmitWord();
                }}
              />
              <button
                type="button"
                className="word-cloud__send"
                onClick={handleSubmitWord}
                disabled={!inputWord.trim() || submitting}
                aria-label={t('submit')}
                title={t('submit')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
            {mieParole.length > 0 && (
              <div className="word-cloud__mine">
                <span className="word-cloud__mine-label">{t('yourWords')}</span>
                {mieParole.map((w, i) => (
                  <span key={`${w}-${i}`} className="word-cloud__mine-chip">{w}</span>
                ))}
              </div>
            )}
          </div>

          <Cloud words={round.words ?? []} emptyText={t('noWords')} />
          <TopWords
            words={round.words ?? []}
            title={isModerator ? t('allWords') : t('topWords')}
            onRemove={isModerator ? (w) => void handleRemoveWord(w) : undefined}
            removeLabel={t('removeWord')}
            confirmLabel={tc('confirm')}
          />

          <div className="word-cloud__footer">
            <span>{t('wordsSubmitted', { count: round.totalSubmissions ?? 0 })}</span>
            {isModerator && (
              <button type="button" className="poll-action" onClick={handleCloseRound}>
                <Icon icon="it-locked" size="xs" />
                {t('close')}
              </button>
            )}
          </div>
        </div>
      )}

      {hasLastRound && (
        <div className="word-cloud__round">
          <div className="word-cloud__question word-cloud__question--closed">
            <span className="poll-status poll-status--closed">{t('closedBadge')}</span>
            <p className="word-cloud__prompt word-cloud__prompt--closed">{round!.prompt}</p>
          </div>
          <Cloud words={round!.words ?? []} />
          <TopWords
            words={round!.words ?? []}
            title={isModerator ? t('allWords') : t('topWords')}
            onRemove={isModerator ? (w) => void handleRemoveWord(w) : undefined}
            removeLabel={t('removeWord')}
            confirmLabel={tc('confirm')}
          />
        </div>
      )}

      {!round?.active && !hasLastRound && !isModerator && (
        <div className="live-panel-empty">
          <span className="live-panel-empty__icon" aria-hidden="true">
            <Icon icon="it-comment" size="lg" />
          </span>
          <p className="live-panel-empty__title">{t('noActiveRound')}</p>
          <p className="live-panel-empty__hint">{t('howItWorks')}</p>
        </div>
      )}
    </div>
  );
}

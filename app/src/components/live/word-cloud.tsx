'use client';

import { useState, useEffect, useCallback } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import useSWR from 'swr';
import { Alert, Button } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { useLivePush } from '@/hooks/use-live-state';

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

const BI_COLORS = [
  '#0066CC', '#17324D', '#5C6F82', '#0073E6',
  '#004D99', '#00264D', '#0059B3', '#003366',
];

/** Il colore segue la parola, non la sua posizione: quando la classifica
 *  cambia, ogni parola resta del suo colore invece di scambiarlo. */
function wordColor(word: string): string {
  let h = 0;
  for (let i = 0; i < word.length; i += 1) h = (h * 31 + word.charCodeAt(i)) | 0;
  return BI_COLORS[Math.abs(h) % BI_COLORS.length] ?? '#0066CC';
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
            className="word-cloud__word"
            style={{
              fontSize: `${14 + ratio * 30}px`,
              color: wordColor(w.word),
              opacity: 0.72 + ratio * 0.28,
            }}
            title={`${w.word}: ${w.count}`}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
}

export default function WordCloud({
  eventSlug,
  token,
  isModerator,
  voterAccessToken,
  voterGuestId,
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
  }, [eventSlug, token, prompt, duration, creating, fetchRound, tc]);

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

  const handleSubmitWord = useCallback(async () => {
    if (!inputWord.trim() || !round?.id || submitting) return;
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
  }, [inputWord, round, eventSlug, token, voterAccessToken, voterGuestId, submitting, fetchRound, t]);

  // Vicino a dove si agisce: a giro aperto sopra il campo, perché con una
  // nuvola piena la cima del pannello è già fuori vista mentre si scrive.
  const avviso = error ? (
    <Alert color="danger" className="py-2 mb-2" role="alert">
      {error}
    </Alert>
  ) : null;

  const mmss = `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`;
  const hasLastRound = !!round && !round.active && !!round.words && round.words.length > 0;

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
                className="form-control form-control-sm mb-2"
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
                {[60, 120, 180].map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`word-cloud__duration${duration === d ? ' is-active' : ''}`}
                    aria-pressed={duration === d}
                    onClick={() => setDuration(d)}
                  >
                    {format.number(d / 60, { style: 'unit', unit: 'minute' })}
                  </button>
                ))}
              </div>
              <div className="d-flex gap-2">
                <Button color="primary" size="xs" className="px-3" onClick={handleCreateRound} disabled={!prompt.trim() || creating}>
                  {t('startRound')}
                </Button>
                <Button color="secondary" outline size="xs" className="px-3" onClick={() => setShowCreate(false)}>
                  {t('cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {!hasLastRound && (
                <div className="live-panel-empty pt-2">
                  <span className="live-panel-empty__icon" aria-hidden="true">
                    <Icon icon="it-comment" size="lg" />
                  </span>
                  <p className="live-panel-empty__hint">{t('emptyHintModerator')}</p>
                </div>
              )}
              <Button color="primary" size="sm" className="w-100" onClick={() => setShowCreate(true)}>
                {t('startNew')}
              </Button>
            </>
          )}
        </div>
      )}

      {round?.active && (
        <div>
          <p className="word-cloud__prompt">{round.prompt}</p>
          <Cloud words={round.words ?? []} emptyText={t('noWords')} />

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

          <div className="word-cloud__footer">
            <span>{t('wordsSubmitted', { count: round.totalSubmissions ?? 0 })}</span>
            {isModerator && (
              <Button color="danger" outline size="xs" className="px-2" onClick={handleCloseRound}>
                {t('close')}
              </Button>
            )}
          </div>
        </div>
      )}

      {hasLastRound && (
        <div>
          <p className="word-cloud__prompt word-cloud__prompt--closed">{round!.prompt}</p>
          <Cloud words={round!.words ?? []} />
        </div>
      )}

      {!round?.active && !hasLastRound && !isModerator && (
        <div className="live-panel-empty">
          <span className="live-panel-empty__icon" aria-hidden="true">
            <Icon icon="it-comment" size="lg" />
          </span>
          <p className="live-panel-empty__title">{t('noActiveRound')}</p>
        </div>
      )}
    </div>
  );
}

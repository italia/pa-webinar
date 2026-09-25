'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import { Alert, Button, Badge, Input } from 'design-react-kit';

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

export default function WordCloud({
  eventSlug,
  token,
  isModerator,
  voterAccessToken,
  voterGuestId,
}: WordCloudProps) {
  const t = useTranslations('wordcloud');
  const tc = useTranslations('common');
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
    if (!prompt.trim()) return;
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
    }
    void fetchRound();
  }, [eventSlug, token, prompt, duration, fetchRound, tc]);

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

  const maxCount = round?.words?.reduce((max, w) => Math.max(max, w.count), 1) ?? 1;

  // Vicino a dove si agisce: a giro aperto sopra il campo, perché con una
  // nuvola piena la cima del pannello è già fuori vista mentre si scrive.
  const avviso = error ? (
    <Alert color="danger" className="py-2 mb-2" role="alert">
      {error}
    </Alert>
  ) : null;

  return (
    <div className="p-3">
      {!round?.active && avviso}

      {isModerator && !round?.active && (
        <div className="mb-3">
          {showCreate ? (
            <div>
              <Input
                type="text"
                label={t('promptPlaceholder')}
                value={prompt}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrompt(e.target.value)}
                maxLength={200}
                className="mb-2"
              />
              <div className="d-flex gap-2 mb-2">
                {[60, 120, 180].map((d) => (
                  <Button
                    key={d}
                    color={duration === d ? 'primary' : 'outline-primary'}
                    size="xs"
                    onClick={() => setDuration(d)}
                  >
                    {d}s
                  </Button>
                ))}
              </div>
              <div className="d-flex gap-2">
                <Button color="primary" size="sm" onClick={handleCreateRound} disabled={!prompt.trim()}>
                  {t('startRound')}
                </Button>
                <Button color="outline-secondary" size="sm" onClick={() => setShowCreate(false)}>
                  {t('cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Button color="primary" size="sm" className="w-100" onClick={() => setShowCreate(true)}>
              <Icon icon="it-comment" size="xs" className="me-1" />
              {t('title')}
            </Button>
          )}
        </div>
      )}

      {round?.active && (
        <div>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h6 className="mb-0 small fw-semibold">{round.prompt}</h6>
            {timeLeft > 0 && (
              <Badge color="primary" pill className="px-2 py-1">
                {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
              </Badge>
            )}
          </div>

          {/* Word cloud visualization */}
          <div
            className="d-flex flex-wrap align-items-center justify-content-center gap-2 p-3 rounded-3 mb-3"
            style={{ backgroundColor: '#F5F6F7', minHeight: '120px' }}
          >
            {(round.words ?? []).length === 0 && (
              <span className="text-muted small">{t('noWords')}</span>
            )}
            {(round.words ?? []).map((w, idx) => {
              const ratio = w.count / maxCount;
              const fontSize = 14 + ratio * 34;
              const color = BI_COLORS[idx % BI_COLORS.length];
              return (
                <span
                  key={w.word}
                  className="d-inline-block px-1 fw-semibold"
                  style={{
                    fontSize: `${fontSize}px`,
                    color,
                    opacity: 0.7 + ratio * 0.3,
                    transition: 'all 0.3s ease',
                  }}
                  title={`${w.word}: ${w.count}`}
                >
                  {w.word}
                </span>
              );
            })}
          </div>

          {/* Scrive chiunque sia in sala, chi conduce compreso: come nei
              sondaggi, anche il moderatore partecipa. Nascondergli il campo
              lasciava una sala di soli ospiti e moderatore senza nessuno che
              potesse scrivere. */}
          {avviso}
          <div className="d-flex gap-2">
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder={t('submitPlaceholder')}
              aria-label={t('submitPlaceholder')}
              value={inputWord}
              onChange={(e) => setInputWord(e.target.value)}
              maxLength={30}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitWord()}
            />
            <Button color="primary" size="sm" onClick={handleSubmitWord} disabled={!inputWord.trim() || submitting}>
              {t('submit')}
            </Button>
          </div>

          {isModerator && round.active && (
            <Button color="outline-danger" size="sm" className="w-100 mt-2" onClick={handleCloseRound}>
              {t('close')}
            </Button>
          )}

          <small className="text-muted d-block mt-2">
            {t('wordsSubmitted', { count: round.totalSubmissions ?? 0 })}
          </small>
        </div>
      )}

      {round && !round.active && round.words && round.words.length > 0 && (
        <div>
          <h6 className="small fw-semibold text-muted mb-2">{round.prompt}</h6>
          <div
            className="d-flex flex-wrap align-items-center justify-content-center gap-2 p-3 rounded-3"
            style={{ backgroundColor: '#F5F6F7', minHeight: '80px' }}
          >
            {round.words.map((w, idx) => {
              const ratio = w.count / maxCount;
              const fontSize = 14 + ratio * 34;
              return (
                <span
                  key={w.word}
                  className="d-inline-block px-1 fw-semibold"
                  style={{ fontSize: `${fontSize}px`, color: BI_COLORS[idx % BI_COLORS.length], opacity: 0.7 + ratio * 0.3 }}
                >
                  {w.word}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {!round?.active && (!round?.words || round.words.length === 0) && !isModerator && (
        <p className="text-muted small text-center mb-0">{t('noActiveRound')}</p>
      )}
    </div>
  );
}

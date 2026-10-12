'use client';

import { useState, useCallback, useRef, useEffect, useMemo, useId } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import useSWR from 'swr';
import { Button } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { useLivePush } from '@/hooks/use-live-state';
import { avatarColor, avatarInitials } from '@/lib/chat/avatar';
import { QUESTION_ANSWER_MAX } from '@/lib/validation/schemas';

import { questionsReadUrl, upvoteInit, type QaVoter } from './question-request';

interface PublicQuestion {
  id: string;
  authorName: string;
  text: string;
  /** Risposta scritta da chi conduce, se c'e'. */
  answerText: string | null;
  status: string;
  upvoteCount: number;
  hasUpvoted: boolean;
  createdAt: string;
  highlightedAt: string | null;
  answeredAt: string | null;
}

interface QuestionsResponse {
  questions: PublicQuestion[];
  totalCount: number;
  /** Lo dice il server: il pollice in su richiede un'identità di voto, la
   *  registrazione o l'identificativo del browser mandato con la lettura. */
  canUpvote?: boolean;
}

interface QuestionListProps extends QaVoter {
  eventSlug: string;
  token: string;
  isModerator: boolean;
  /** Le domande fatte da questo browser (lib/qa/alerts): portano il segno «La tua domanda». */
  myQuestionIds?: ReadonlySet<string>;
}

type FilterTab = 'ALL' | 'PENDING' | 'HIGHLIGHTED' | 'ANSWERED' | 'DISMISSED';

export default function QuestionList({
  eventSlug,
  token,
  isModerator,
  voterAccessToken,
  voterGuestId,
  myQuestionIds,
}: QuestionListProps) {
  const t = useTranslations('qa');
  const apiUrl = questionsReadUrl(`/api/events/${eventSlug}/questions`, { voterGuestId });

  // Send token via header instead of query param to avoid leaking in logs
  const fetcherWithAuth = useCallback(
    async (url: string) => {
      const r = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    [token],
  );

  const pushLive = useLivePush();

  const { data, mutate } = useSWR<QuestionsResponse>(apiUrl, fetcherWithAuth, {
    // Spento quando il canale consegna: il pannello viene avvisato.
    refreshInterval: pushLive ? 0 : 3000,
  });

  const [filter, setFilter] = useState<FilterTab>('ALL');
  const [upvoteFailed, setUpvoteFailed] = useState(false);
  // Un cambio di stato o una risposta respinti dal server: senza un messaggio
  // il pulsante sembrerebbe non fare niente.
  const [actionFailed, setActionFailed] = useState(false);
  const prevHighlightedRef = useRef<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const questions = useMemo(() => data?.questions ?? [], [data]);
  const canUpvote = data?.canUpvote ?? false;

  // Si scorre alla domanda messa in evidenza mentre si e' nel pannello, non
  // all'apertura: alla prima lettura lo scorrimento portava via dalla vista il
  // riquadro per scrivere una domanda.
  const primaLetturaRef = useRef(true);
  useEffect(() => {
    if (!data) return;
    const firstHighlighted = questions.find((q) => q.status === 'HIGHLIGHTED');
    if (primaLetturaRef.current) {
      primaLetturaRef.current = false;
      prevHighlightedRef.current = firstHighlighted?.id ?? null;
      return;
    }
    if (firstHighlighted && firstHighlighted.id !== prevHighlightedRef.current) {
      prevHighlightedRef.current = firstHighlighted.id;
      topRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [data, questions]);

  const filteredQuestions =
    filter === 'ALL'
      ? questions
      : questions.filter((q) => q.status === filter);

  const pendingCount = questions.filter((q) => q.status === 'PENDING').length;

  const handleUpvote = useCallback(
    async (questionId: string) => {
      const init = upvoteInit(token, { voterAccessToken, voterGuestId });
      if (!init) return;
      setUpvoteFailed(false);
      try {
        const res = await fetch(
          `/api/events/${eventSlug}/questions/${questionId}/upvote`,
          init,
        );
        // Un voto respinto (limite, stanza chiusa) non cambia niente sullo
        // schermo: senza un messaggio sembrerebbe un pulsante rotto.
        if (!res.ok) setUpvoteFailed(true);
      } catch {
        setUpvoteFailed(true);
      }
      mutate();
    },
    [eventSlug, token, voterAccessToken, voterGuestId, mutate],
  );

  // Stato e risposta passano dalla stessa rotta: { status }, { answer } o
  // tutti e due. Dice se il server ha accettato.
  const patchQuestion = useCallback(
    async (questionId: string, body: { status?: string; answer?: string | null }) => {
      setActionFailed(false);
      let ok = false;
      try {
        const res = await fetch(`/api/events/${eventSlug}/questions/${questionId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      if (!ok) setActionFailed(true);
      mutate();
      return ok;
    },
    [eventSlug, token, mutate],
  );

  const handleStatusChange = useCallback(
    (questionId: string, status: string) => {
      void patchQuestion(questionId, { status });
    },
    [patchQuestion],
  );

  const handleAnswer = useCallback(
    (questionId: string, answer: string | null) => patchQuestion(questionId, { answer }),
    [patchQuestion],
  );

  // Quante domande per stato: le schede dei filtri le mostrano tutte, cosi'
  // chi conduce vede a colpo d'occhio cosa resta da fare.
  const counts = useMemo(() => {
    const c: Record<FilterTab, number> = { ALL: questions.length, PENDING: 0, HIGHLIGHTED: 0, ANSWERED: 0, DISMISSED: 0 };
    for (const q of questions) {
      if (q.status in c) c[q.status as FilterTab] += 1;
    }
    return c;
  }, [questions]);

  return (
    <div ref={topRef}>
      {isModerator && (
        <div className="qa-filters" role="group" aria-label={t('title')}>
          {(['ALL', 'PENDING', 'HIGHLIGHTED', 'ANSWERED', 'DISMISSED'] as FilterTab[]).map(
            (tab) => (
              <button
                key={tab}
                type="button"
                className={`qa-filter${filter === tab ? ' is-active' : ''}${
                  tab === 'PENDING' && pendingCount > 0 ? ' has-pending' : ''
                }`}
                aria-pressed={filter === tab}
                onClick={() => setFilter(tab)}
              >
                {tab === 'ALL' ? t('filterAll') : t(`status.${tab}`)}
                <span className="qa-filter__count">{counts[tab]}</span>
              </button>
            ),
          )}
        </div>
      )}

      {upvoteFailed && (
        <p className="qa-error" role="alert">
          {t('errors.upvoteFailed')}
        </p>
      )}
      {actionFailed && (
        <p className="qa-error" role="alert">
          {t('errors.actionFailed')}
        </p>
      )}

      {filteredQuestions.length === 0 && (
        <div className="qa-empty">
          <span className="qa-empty__icon" aria-hidden="true">
            <Icon icon="it-help-circle" color="primary" />
          </span>
          <p className="mb-0">{t('noQuestions')}</p>
        </div>
      )}

      <div className="qa-list">
        {filteredQuestions.map((q) => (
          <QuestionCard
            key={q.id}
            question={q}
            isModerator={isModerator}
            isMine={myQuestionIds?.has(q.id) ?? false}
            canUpvote={canUpvote}
            onUpvote={handleUpvote}
            onStatusChange={handleStatusChange}
            onAnswer={handleAnswer}
          />
        ))}
      </div>
    </div>
  );
}

// ── Single question card ──

interface QuestionCardProps {
  question: PublicQuestion;
  isModerator: boolean;
  isMine: boolean;
  canUpvote: boolean;
  onUpvote: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onAnswer: (id: string, answer: string | null) => Promise<boolean>;
}

function QuestionCard({
  question,
  isModerator,
  isMine,
  canUpvote,
  onUpvote,
  onStatusChange,
  onAnswer,
}: QuestionCardProps) {
  const t = useTranslations('qa');
  const format = useFormatter();
  // «2 minuti fa» resta vero anche quando non arrivano letture nuove.
  const now = useNow({ updateInterval: 30_000 });
  const answerId = useId();
  // Il modulo della risposta, aperto da «Rispondi» o «Modifica risposta».
  const [answering, setAnswering] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const apriRisposta = () => {
    setDraft(question.answerText ?? '');
    setAnswering(true);
  };
  const salvaRisposta = async (testo: string | null) => {
    setSaving(true);
    const ok = await onAnswer(question.id, testo);
    setSaving(false);
    if (ok) setAnswering(false);
  };

  const isHighlighted = question.status === 'HIGHLIGHTED';
  const isAnswered = question.status === 'ANSWERED';
  const isDismissed = question.status === 'DISMISSED';

  const stato = isHighlighted
    ? ' qa-card--highlighted'
    : isAnswered
      ? ' qa-card--answered'
      : isDismissed
        ? ' qa-card--dismissed'
        : '';

  const quando = format.relativeTime(new Date(question.createdAt), now);

  // Il conteggio dei voti: un pulsante per chi puo' votare, un numero per
  // tutti gli altri (chi conduce, o chi non ha un'identita' di voto). Un
  // pulsante che non funziona e' peggio di un numero.
  const voti =
    !isModerator && !isDismissed && canUpvote ? (
      <button
        type="button"
        className={`qa-vote${question.hasUpvoted ? ' is-on' : ''}`}
        onClick={() => onUpvote(question.id)}
        aria-label={question.hasUpvoted ? t('upvoted') : t('upvote')}
        aria-pressed={question.hasUpvoted}
      >
        <Icon icon="it-arrow-up" size="xs" />
        <span>{question.upvoteCount}</span>
      </button>
    ) : (
      <span className="qa-vote is-static">
        <Icon icon="it-arrow-up" size="xs" />
        <span>{question.upvoteCount}</span>
      </span>
    );

  return (
    <article className={`qa-card${stato}`}>
      <header className="qa-card__head">
        <span
          className="qa-card__avatar"
          style={{ backgroundColor: avatarColor(question.authorName) }}
          aria-hidden="true"
        >
          {avatarInitials(question.authorName)}
        </span>
        <div className="qa-card__who">
          <span className="qa-card__name">{question.authorName}</span>
          <span className="qa-card__time">{quando}</span>
        </div>
        <div className="qa-card__chips">
          {isMine && <span className="qa-mine-badge">{t('yourQuestionLabel')}</span>}
          {isHighlighted && (
            <span className="qa-chip qa-chip--highlighted">
              <Icon icon="it-star-full" size="xs" />
              {t('status.HIGHLIGHTED')}
            </span>
          )}
          {isAnswered && (
            <span className="qa-chip qa-chip--answered">
              <Icon icon="it-check" size="xs" />
              {t('status.ANSWERED')}
            </span>
          )}
          {isDismissed && <span className="qa-chip">{t('status.DISMISSED')}</span>}
        </div>
      </header>

      <p className="qa-card__text">{question.text}</p>

      {question.answerText && !answering && (
        <div className="qa-answer">
          <span className="qa-answer__label">{t('answerLabel')}</span>
          <p className="qa-answer__text">{question.answerText}</p>
        </div>
      )}

      {isModerator && answering && (
        <form
          className="qa-answer-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) void salvaRisposta(draft.trim());
          }}
        >
          <label htmlFor={answerId} className="visually-hidden">
            {t('moderator.answerFieldLabel', { name: question.authorName })}
          </label>
          <textarea
            id={answerId}
            className="form-control"
            rows={3}
            maxLength={QUESTION_ANSWER_MAX}
            value={draft}
            placeholder={t('moderator.answerPlaceholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              // Solo il modulo: sotto i 992px la sala chiude il cassetto con Esc.
              e.stopPropagation();
              setAnswering(false);
            }}
            autoFocus
          />
          <div className="qa-answer-form__actions">
            {question.answerText && (
              <button
                type="button"
                className="qa-link qa-link--danger me-auto"
                disabled={saving}
                onClick={() => void salvaRisposta(null)}
              >
                {t('moderator.removeAnswer')}
              </button>
            )}
            <Button
              type="button"
              color="secondary"
              outline
              size="sm"
              disabled={saving}
              onClick={() => setAnswering(false)}
            >
              {t('moderator.cancel')}
            </Button>
            <Button type="submit" color="primary" size="sm" disabled={saving || !draft.trim()}>
              {t('moderator.sendAnswer')}
            </Button>
          </div>
        </form>
      )}

      <footer className="qa-card__foot">
        {voti}
        {isModerator && !answering && (
          <div className="qa-actions">
            {/* Una domanda scartata non si risponde: la si ripristina prima. */}
            {!isDismissed && (
              <button type="button" className="qa-action qa-action--text" onClick={apriRisposta}>
                <Icon icon="it-pencil" size="xs" />
                {question.answerText ? t('moderator.editAnswer') : t('moderator.answer')}
              </button>
            )}
            {question.status !== 'HIGHLIGHTED' && !isDismissed && (
              <button
                type="button"
                className="qa-action qa-action--highlight"
                onClick={() => onStatusChange(question.id, 'HIGHLIGHTED')}
                aria-label={t('moderator.highlight')}
                title={t('moderator.highlight')}
              >
                <Icon icon="it-star-outline" size="sm" />
              </button>
            )}
            {question.status !== 'ANSWERED' && !isDismissed && (
              <button
                type="button"
                className="qa-action qa-action--answered"
                onClick={() => onStatusChange(question.id, 'ANSWERED')}
                aria-label={t('moderator.markAnswered')}
                title={t('moderator.markAnswered')}
              >
                <Icon icon="it-check-circle" size="sm" />
              </button>
            )}
            {question.status !== 'PENDING' && (
              <button
                type="button"
                className="qa-action"
                onClick={() => onStatusChange(question.id, 'PENDING')}
                aria-label={t('moderator.resetToPending')}
                title={t('moderator.resetToPending')}
              >
                <Icon icon="it-restore" size="sm" />
              </button>
            )}
            {!isDismissed && (
              <button
                type="button"
                className="qa-action qa-action--dismiss"
                onClick={() => onStatusChange(question.id, 'DISMISSED')}
                aria-label={t('moderator.dismiss')}
                title={t('moderator.dismiss')}
              >
                <Icon icon="it-close-circle" size="sm" />
              </button>
            )}
          </div>
        )}
      </footer>
    </article>
  );
}


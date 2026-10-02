'use client';

import { useState, useCallback, useRef, useEffect, useMemo, useId } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import {
  Badge,
  Button,
} from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { useLivePush } from '@/hooks/use-live-state';
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

  useEffect(() => {
    const firstHighlighted = questions.find((q) => q.status === 'HIGHLIGHTED');
    if (firstHighlighted && firstHighlighted.id !== prevHighlightedRef.current) {
      prevHighlightedRef.current = firstHighlighted.id;
      topRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [questions]);

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

  return (
    <div ref={topRef}>
      {isModerator && (
        <div className="d-flex flex-wrap gap-1 mb-3">
          {(['ALL', 'PENDING', 'HIGHLIGHTED', 'ANSWERED', 'DISMISSED'] as FilterTab[]).map(
            (tab) => (
              <Button
                key={tab}
                color={filter === tab ? 'primary' : 'light'}
                size="xs"
                className="px-2 py-1"
                onClick={() => setFilter(tab)}
              >
                {tab === 'ALL' ? t('filterAll') : t(`status.${tab}`)}
                {tab === 'PENDING' && pendingCount > 0 && (
                  <Badge color="danger" pill className="ms-1 px-1">
                    {pendingCount}
                  </Badge>
                )}
              </Button>
            ),
          )}
        </div>
      )}

      {upvoteFailed && (
        <p className="text-danger small mb-2" role="alert">
          {t('errors.upvoteFailed')}
        </p>
      )}
      {actionFailed && (
        <p className="text-danger small mb-2" role="alert">
          {t('errors.actionFailed')}
        </p>
      )}

      {filteredQuestions.length === 0 && (
        <p className="text-muted small text-center py-3">{t('noQuestions')}</p>
      )}

      <div className="d-flex flex-column gap-2">
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

  const bgClass = isHighlighted
    ? 'bg-warning bg-opacity-10 border-warning'
    : isAnswered
      ? 'bg-light'
      : isDismissed
        ? 'bg-light text-muted'
        : '';

  const timeAgo = getTimeAgo(question.createdAt);

  return (
    <div className={`border rounded p-2 ${bgClass}`}>
      <div className="d-flex justify-content-between align-items-start">
        <div className="flex-grow-1">
          <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
            <strong className="small">{question.authorName}</strong>
            {isMine && (
              <span className="qa-mine-badge">{t('yourQuestionLabel')}</span>
            )}
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>
              {timeAgo}
            </span>
            {isHighlighted && (
              <Badge color="warning" pill className="px-2 py-0" style={{ fontSize: '0.7rem' }}>
                <Icon icon="it-star-full" size="xs" className="me-1" />
                {t('status.HIGHLIGHTED')}
              </Badge>
            )}
            {isAnswered && (
              <Badge color="success" pill className="px-2 py-0" style={{ fontSize: '0.7rem' }}>
                {t('status.ANSWERED')}
              </Badge>
            )}
          </div>
          <p className="mb-1 small" style={{ opacity: isDismissed ? 0.5 : 1 }}>
            {question.text}
          </p>
          {question.answerText && !answering && (
            <div className="qa-answer">
              <span className="qa-answer__label">{t('answerLabel')}</span>
              <p className="qa-answer__text">{question.answerText}</p>
            </div>
          )}
        </div>

        {!isModerator && !isDismissed && canUpvote && (
          <button
            type="button"
            className={`btn btn-sm border-0 d-flex flex-column align-items-center ${
              question.hasUpvoted ? 'text-primary' : 'text-muted'
            }`}
            onClick={() => onUpvote(question.id)}
            aria-label={question.hasUpvoted ? t('upvoted') : t('upvote')}
            style={{ minWidth: '36px' }}
          >
            <Icon
              icon={question.hasUpvoted ? 'it-arrow-up-circle' : 'it-arrow-up'}
              size="sm"
            />
            <span style={{ fontSize: '0.75rem' }}>{question.upvoteCount}</span>
          </button>
        )}

        {/* Chi non può votare vede comunque quanto una domanda è sentita: un
            pulsante che non funziona è peggio di un numero. */}
        {!isModerator && !isDismissed && !canUpvote && (
          <span
            className="text-muted d-flex flex-column align-items-center"
            style={{ minWidth: '36px', fontSize: '0.75rem' }}
          >
            <Icon icon="it-arrow-up" size="sm" />
            {question.upvoteCount}
          </span>
        )}

        {isModerator && (
          <div className="d-flex gap-1 ms-2">
            <span className="badge bg-light text-dark border">{question.upvoteCount}</span>
          </div>
        )}
      </div>

      {isModerator && answering && (
        <form
          className="qa-answer-form mt-2"
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
            className="form-control form-control-sm"
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
          <div className="d-flex flex-wrap gap-1 mt-1">
            <Button
              type="submit"
              color="primary"
              size="xs"
              className="px-2 py-0"
              disabled={saving || !draft.trim()}
            >
              {t('moderator.sendAnswer')}
            </Button>
            <Button
              type="button"
              color="secondary"
              outline
              size="xs"
              className="px-2 py-0"
              disabled={saving}
              onClick={() => setAnswering(false)}
            >
              {t('moderator.cancel')}
            </Button>
            {question.answerText && (
              <Button
                type="button"
                color="danger"
                outline
                size="xs"
                className="px-2 py-0 ms-auto"
                disabled={saving}
                onClick={() => void salvaRisposta(null)}
              >
                {t('moderator.removeAnswer')}
              </Button>
            )}
          </div>
        </form>
      )}

      {isModerator && !answering && (
        <div className="d-flex flex-wrap gap-1 mt-1">
          {/* Una domanda scartata non si risponde: la si ripristina prima. */}
          {!isDismissed && (
            <Button
              color="primary"
              outline
              size="xs"
              className="px-2 py-0"
              onClick={apriRisposta}
            >
              <Icon icon="it-pencil" size="xs" className="me-1" />
              {question.answerText ? t('moderator.editAnswer') : t('moderator.answer')}
            </Button>
          )}
          {question.status !== 'HIGHLIGHTED' && (
            <Button
              color="warning"
              outline
              size="xs"
              className="px-2 py-0"
              onClick={() => onStatusChange(question.id, 'HIGHLIGHTED')}
              aria-label={t('moderator.highlight')}
            >
              <Icon icon="it-star-full" size="xs" className="me-1" />
              {t('moderator.highlight')}
            </Button>
          )}
          {question.status !== 'ANSWERED' && (
            <Button
              color="success"
              outline
              size="xs"
              className="px-2 py-0"
              onClick={() => onStatusChange(question.id, 'ANSWERED')}
              aria-label={t('moderator.markAnswered')}
            >
              <Icon icon="it-check" size="xs" className="me-1" />
              {t('moderator.markAnswered')}
            </Button>
          )}
          {question.status !== 'DISMISSED' && (
            <Button
              color="danger"
              outline
              size="xs"
              className="px-2 py-0"
              onClick={() => onStatusChange(question.id, 'DISMISSED')}
              aria-label={t('moderator.dismiss')}
            >
              <Icon icon="it-close" size="xs" className="me-1" />
              {t('moderator.dismiss')}
            </Button>
          )}
          {(question.status === 'HIGHLIGHTED' || question.status === 'ANSWERED' || question.status === 'DISMISSED') && (
            <Button
              color="secondary"
              outline
              size="xs"
              className="px-2 py-0"
              onClick={() => onStatusChange(question.id, 'PENDING')}
            >
              {t('moderator.resetToPending')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function getTimeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '<1m';
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  return `${diffH}h`;
}

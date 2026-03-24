'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import {
  Badge,
  Button,
  Icon,
} from 'design-react-kit';

interface PublicQuestion {
  id: string;
  authorName: string;
  text: string;
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
}

interface QuestionListProps {
  eventSlug: string;
  token: string;
  isModerator: boolean;
}

type FilterTab = 'ALL' | 'PENDING' | 'HIGHLIGHTED' | 'ANSWERED' | 'DISMISSED';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function QuestionList({
  eventSlug,
  token,
  isModerator,
}: QuestionListProps) {
  const t = useTranslations('qa');
  const apiUrl = `/api/events/${eventSlug}/questions?token=${token}`;

  const { data, mutate } = useSWR<QuestionsResponse>(apiUrl, fetcher, {
    refreshInterval: 3000,
  });

  const [filter, setFilter] = useState<FilterTab>('ALL');
  const prevHighlightedRef = useRef<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const questions = useMemo(() => data?.questions ?? [], [data]);

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
      await fetch(
        `/api/events/${eventSlug}/questions/${questionId}/upvote`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: token }),
        },
      );
      mutate();
    },
    [eventSlug, token, mutate],
  );

  const handleStatusChange = useCallback(
    async (questionId: string, status: string) => {
      await fetch(
        `/api/events/${eventSlug}/questions/${questionId}?token=${token}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      );
      mutate();
    },
    [eventSlug, token, mutate],
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

      {filteredQuestions.length === 0 && (
        <p className="text-muted small text-center py-3">{t('noQuestions')}</p>
      )}

      <div className="d-flex flex-column gap-2">
        {filteredQuestions.map((q) => (
          <QuestionCard
            key={q.id}
            question={q}
            isModerator={isModerator}
            onUpvote={handleUpvote}
            onStatusChange={handleStatusChange}
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
  onUpvote: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
}

function QuestionCard({
  question,
  isModerator,
  onUpvote,
  onStatusChange,
}: QuestionCardProps) {
  const t = useTranslations('qa');

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
          <div className="d-flex align-items-center gap-2 mb-1">
            <strong className="small">{question.authorName}</strong>
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
        </div>

        {!isModerator && !isDismissed && (
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

        {isModerator && (
          <div className="d-flex gap-1 ms-2">
            <span className="badge bg-light text-dark border">{question.upvoteCount}</span>
          </div>
        )}
      </div>

      {isModerator && (
        <div className="d-flex gap-1 mt-1">
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

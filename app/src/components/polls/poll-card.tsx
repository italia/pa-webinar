'use client';

import { useTranslations } from 'next-intl';
import { Button, Badge, Icon } from 'design-react-kit';

interface PollData {
  id: string;
  question: string;
  options: string[];
  status: string;
  totalVotes: number;
  optionCounts: number[] | null;
  hasVoted: boolean;
  votedOptionIndex: number | null;
  createdAt: string;
  closedAt: string | null;
}

interface PollCardProps {
  poll: PollData;
  isModerator: boolean;
  onVote: (pollId: string, optionIndex: number) => void;
  onStatusChange: (pollId: string, status: string) => void;
  onDelete: (pollId: string) => void;
}

export default function PollCard({
  poll,
  isModerator,
  onVote,
  onStatusChange,
  onDelete,
}: PollCardProps) {
  const t = useTranslations('polls');

  const isOpen = poll.status === 'OPEN';
  const isClosed = poll.status === 'CLOSED';
  const isPublished = poll.status === 'PUBLISHED';
  const canVote = isOpen && !poll.hasVoted && !isModerator;
  const showResults = poll.optionCounts !== null;

  return (
    <div className={`border rounded p-2 ${isPublished ? 'border-primary bg-primary bg-opacity-10' : ''}`}>
      <div className="d-flex justify-content-between align-items-start mb-2">
        <div className="fw-semibold small">{poll.question}</div>
        <Badge
          color={isOpen ? 'success' : isClosed ? 'warning' : 'primary'}
          pill
          className="ms-2 flex-shrink-0"
          style={{ fontSize: '0.68rem' }}
        >
          {t(`status.${poll.status}`)}
        </Badge>
      </div>

      <div className="d-flex flex-column gap-1">
        {poll.options.map((option, idx) => {
          const count = showResults ? (poll.optionCounts?.[idx] ?? 0) : 0;
          const pct = showResults && poll.totalVotes > 0
            ? Math.round((count / poll.totalVotes) * 100)
            : 0;
          const isVoted = poll.votedOptionIndex === idx;

          return (
            <div key={idx}>
              {canVote ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary w-100 text-start py-1 px-2"
                  onClick={() => onVote(poll.id, idx)}
                  style={{ fontSize: '0.82rem' }}
                >
                  {option}
                </button>
              ) : (
                <div
                  className="position-relative rounded overflow-hidden"
                  style={{
                    backgroundColor: '#f0f0f0',
                    fontSize: '0.82rem',
                    minHeight: 28,
                  }}
                >
                  {showResults && (
                    <div
                      className="position-absolute top-0 start-0 h-100"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: isVoted ? '#0066CC' : '#B0C4DE',
                        opacity: 0.3,
                        transition: 'width 0.3s',
                      }}
                    />
                  )}
                  <div className="position-relative d-flex justify-content-between align-items-center px-2 py-1">
                    <span className={isVoted ? 'fw-semibold' : ''}>
                      {isVoted && <Icon icon="it-check" size="xs" className="me-1" />}
                      {option}
                    </span>
                    {showResults && (
                      <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {pct}% ({count})
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showResults && (
        <div className="text-muted mt-1" style={{ fontSize: '0.72rem' }}>
          {t('totalVotes', { count: poll.totalVotes })}
        </div>
      )}

      {poll.hasVoted && isOpen && (
        <div className="text-success mt-1" style={{ fontSize: '0.72rem' }}>
          <Icon icon="it-check" size="xs" className="me-1" />
          {t('voted')}
        </div>
      )}

      {isModerator && (
        <div className="d-flex gap-1 mt-2">
          {isOpen && (
            <Button
              color="warning"
              outline
              size="xs"
              className="px-2 py-0"
              onClick={() => onStatusChange(poll.id, 'CLOSED')}
            >
              {t('closePoll')}
            </Button>
          )}
          {isClosed && (
            <Button
              color="primary"
              outline
              size="xs"
              className="px-2 py-0"
              onClick={() => onStatusChange(poll.id, 'PUBLISHED')}
            >
              {t('publishResults')}
            </Button>
          )}
          {(isClosed || isPublished) && (
            <Button
              color="success"
              outline
              size="xs"
              className="px-2 py-0"
              onClick={() => onStatusChange(poll.id, 'OPEN')}
            >
              {t('reopenPoll')}
            </Button>
          )}
          <Button
            color="danger"
            outline
            size="xs"
            className="px-2 py-0"
            onClick={() => onDelete(poll.id)}
          >
            <Icon icon="it-close" size="xs" />
          </Button>
        </div>
      )}
    </div>
  );
}

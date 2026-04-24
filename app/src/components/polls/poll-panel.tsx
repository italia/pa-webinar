'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Icon } from 'design-react-kit';
import useSWR from 'swr';

import PollCard from './poll-card';
import PollCreateForm from './poll-create-form';

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

interface PollsResponse {
  polls: PollData[];
}

interface PollPanelProps {
  eventSlug: string;
  token: string;
  isModerator: boolean;
}

export default function PollPanel({
  eventSlug,
  token,
  isModerator,
}: PollPanelProps) {
  const t = useTranslations('polls');
  const [showCreate, setShowCreate] = useState(false);

  const apiUrl = `/api/events/${eventSlug}/polls`;

  const fetcher = useCallback(
    async (url: string) => {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    [token],
  );

  const { data, mutate } = useSWR<PollsResponse>(apiUrl, fetcher, {
    refreshInterval: 3000,
  });

  const polls = data?.polls ?? [];

  const handleVote = useCallback(
    async (pollId: string, optionIndex: number) => {
      await fetch(`/api/events/${eventSlug}/polls/${pollId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIndex, accessToken: token }),
      });
      mutate();
    },
    [eventSlug, token, mutate],
  );

  const handleStatusChange = useCallback(
    async (pollId: string, status: string) => {
      await fetch(`/api/events/${eventSlug}/polls/${pollId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      mutate();
    },
    [eventSlug, token, mutate],
  );

  const handleDelete = useCallback(
    async (pollId: string) => {
      await fetch(`/api/events/${eventSlug}/polls/${pollId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      mutate();
    },
    [eventSlug, token, mutate],
  );

  const handleCreated = useCallback(() => {
    setShowCreate(false);
    mutate();
  }, [mutate]);

  return (
    <div
      className="d-flex flex-column flex-grow-1"
      style={{ width: '100%', minHeight: 0 }}
    >
        <div className="p-3 border-bottom">
          <h3 className="h5 mb-0 d-flex align-items-center">
            <Icon icon="it-chart-line" className="me-2" />
            {t('title')}
          </h3>
        </div>

        <div className="p-3 flex-grow-1" style={{ overflowY: 'auto' }}>
          {isModerator && (
            <div className="mb-3">
              {showCreate ? (
                <PollCreateForm
                  eventSlug={eventSlug}
                  token={token}
                  onCreated={handleCreated}
                  onCancel={() => setShowCreate(false)}
                />
              ) : (
                <Button
                  color="primary"
                  size="sm"
                  className="w-100"
                  onClick={() => setShowCreate(true)}
                >
                  {t('createPoll')}
                </Button>
              )}
            </div>
          )}

          {polls.length === 0 && (
            <p className="text-muted small text-center py-3">{t('noPolls')}</p>
          )}

          <div className="d-flex flex-column gap-2">
            {polls.map((poll) => (
              <PollCard
                key={poll.id}
                poll={poll}
                isModerator={isModerator}
                onVote={handleVote}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
    </div>
  );
}

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Icon } from 'design-react-kit';
import useSWR from 'swr';
import { useLivePush } from '@/hooks/use-live-state';

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
  /** Token di sala: moderatore, relatore o partecipante registrato. Vuoto per
   *  gli ospiti, che entrano dal link e non ne hanno uno. Serve alla lettura e
   *  alle azioni di moderazione, NON al voto. */
  token: string;
  isModerator: boolean;
  /** L'`accessToken` della registrazione, e solo quello: è l'identità con cui
   *  il server registra il voto di un partecipante iscritto. Un token
   *  moderatore qui dentro vale un 403 — non è una registrazione. */
  voterAccessToken?: string;
  /** Identificativo stabile del browser per chi una registrazione non ce l'ha
   *  (ospiti, relatori, moderatori): è così che votano, ed è la chiave con cui
   *  il server evita il doppio voto. */
  voterGuestId?: string;
  /** La scheda dei sondaggi è quella aperta: senza push si interroga più
   *  spesso, e i sondaggi da votare smettono di essere «da notificare». */
  active?: boolean;
  /** Quanti sondaggi aperti la persona non ha ancora votato: la barra delle
   *  schede ci accende il pallino. */
  onUnvotedCountChange?: (count: number) => void;
}

export default function PollPanel({
  eventSlug,
  token,
  isModerator,
  voterAccessToken,
  voterGuestId,
  active = true,
  onUnvotedCountChange,
}: PollPanelProps) {
  const t = useTranslations('polls');
  const [showCreate, setShowCreate] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  const apiUrl = `/api/events/${eventSlug}/polls`;
  // L'identificativo del browser entra nella chiave perché la risposta ne
  // dipende: è quello che dice «questo l'hai già votato tu».
  const swrKey = voterGuestId
    ? `${apiUrl}?guestId=${encodeURIComponent(voterGuestId)}`
    : apiUrl;

  const fetcher = useCallback(
    async (url: string) => {
      const r = await fetch(url, {
        // Un ospite non ha token: mandare `Bearer ` vuoto è ciò che faceva
        // rispondere 401 a tutta la sala di una chiamata istantanea.
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    [token],
  );

  const pushLive = useLivePush();

  const { data, mutate } = useSWR<PollsResponse>(swrKey, fetcher, {
    // Spento quando il canale consegna: il pannello viene avvisato. Senza
    // canale il pannello resta montato anche su un'altra scheda, per poter
    // accendere il pallino: lì basta un giro molto più lento.
    refreshInterval: pushLive ? 0 : active ? 3000 : 15000,
  });

  const polls = data?.polls ?? [];

  const unvotedCount = polls.filter((p) => p.status === 'OPEN' && !p.hasVoted).length;
  useEffect(() => {
    onUnvotedCountChange?.(unvotedCount);
  }, [unvotedCount, onUnvotedCountChange]);

  const handleVote = useCallback(
    async (pollId: string, optionIndex: number) => {
      // Un'identità serve: senza, il server rifiuta e il voto sparirebbe in
      // silenzio (è esattamente il difetto che questo pannello aveva).
      const identity = voterAccessToken
        ? { accessToken: voterAccessToken }
        : voterGuestId
          ? { guestId: voterGuestId }
          : null;
      if (!identity) {
        setVoteError(t('errors.vote'));
        return;
      }

      setVoteError(null);
      try {
        const res = await fetch(`/api/events/${eventSlug}/polls/${pollId}/vote`, {
          method: 'POST',
          // Il token di sala non è l'identità con cui si vota, ma è ciò con
          // cui moderatori e relatori dimostrano di essere in sala anche
          // quando l'evento non è ancora "in diretta" (pre-riscaldamento,
          // pausa senza traffico). Senza, il loro voto verrebbe respinto.
          headers: token
            ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
            : { 'Content-Type': 'application/json' },
          body: JSON.stringify({ optionIndex, ...identity }),
        });
        if (!res.ok) {
          setVoteError(res.status === 409 ? t('errors.alreadyVoted') : t('errors.vote'));
        }
      } catch {
        setVoteError(t('errors.vote'));
      }
      // Si rilegge comunque: dopo un 409 la verità sul server è già diversa
      // da quella a schermo, ed è quella che va mostrata.
      void mutate();
    },
    [eventSlug, token, voterAccessToken, voterGuestId, mutate, t],
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

          {voteError && (
            <p className="text-danger small mb-2" role="alert">
              {voteError}
            </p>
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

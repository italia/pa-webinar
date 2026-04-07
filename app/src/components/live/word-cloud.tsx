'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Icon, Badge, Input } from 'design-react-kit';

interface WordCloudProps {
  eventSlug: string;
  token: string;
  isModerator: boolean;
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

export default function WordCloud({ eventSlug, token, isModerator }: WordCloudProps) {
  const t = useTranslations('wordcloud');
  const [round, setRound] = useState<RoundData | null>(null);
  const [inputWord, setInputWord] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(120);
  const [timeLeft, setTimeLeft] = useState(0);

  const fetchRound = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventSlug}/wordcloud`);
      if (res.ok) {
        const data: RoundData = await res.json();
        setRound(data);

        if (data.active && data.createdAt && data.duration) {
          const elapsed = (Date.now() - new Date(data.createdAt).getTime()) / 1000;
          setTimeLeft(Math.max(0, Math.round(data.duration - elapsed)));
        } else {
          setTimeLeft(0);
        }
      }
    } catch { /* retry next poll */ }
  }, [eventSlug]);

  useEffect(() => {
    fetchRound();
    const interval = setInterval(fetchRound, 3000);
    return () => clearInterval(interval);
  }, [fetchRound]);

  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  const handleCreateRound = useCallback(async () => {
    if (!prompt.trim()) return;
    try {
      await fetch(`/api/events/${eventSlug}/wordcloud`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt: prompt.trim(), duration }),
      });
      setShowCreate(false);
      setPrompt('');
      fetchRound();
    } catch { /* ignore */ }
  }, [eventSlug, token, prompt, duration, fetchRound]);

  const handleCloseRound = useCallback(async () => {
    if (!round?.id) return;
    await fetch(`/api/events/${eventSlug}/wordcloud/${round.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
    fetchRound();
  }, [eventSlug, token, round, fetchRound]);

  const handleSubmitWord = useCallback(async () => {
    if (!inputWord.trim() || !round?.id || submitting) return;
    setSubmitting(true);
    try {
      const body: Record<string, string> = { word: inputWord.trim() };
      if (token) body.accessToken = token;
      await fetch(`/api/events/${eventSlug}/wordcloud/${round.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setInputWord('');
      fetchRound();
    } catch { /* ignore */ }
    setSubmitting(false);
  }, [inputWord, round, eventSlug, token, submitting, fetchRound]);

  const maxCount = round?.words?.reduce((max, w) => Math.max(max, w.count), 1) ?? 1;

  return (
    <div className="p-3">
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

          {/* Submit input */}
          {!isModerator && (
            <div className="d-flex gap-2">
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder={t('submitPlaceholder')}
                value={inputWord}
                onChange={(e) => setInputWord(e.target.value)}
                maxLength={30}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitWord()}
              />
              <Button color="primary" size="sm" onClick={handleSubmitWord} disabled={!inputWord.trim() || submitting}>
                {t('submit')}
              </Button>
            </div>
          )}

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

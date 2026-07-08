'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';

interface ReactionBarProps {
  eventSlug: string;
}

interface FloatingEmoji {
  id: number;
  emoji: string;
  offsetX: number;
}

const EMOJIS = ['👏', '❤️', '😂', '🎉', '👍', '😮'] as const;

export default function ReactionBar({ eventSlug }: ReactionBarProps) {
  const t = useTranslations('reactions');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [cooldown, setCooldown] = useState(false);
  const [floating, setFloating] = useState<FloatingEmoji[]>([]);
  const idRef = useRef(0);
  const prevCountsRef = useRef<Record<string, number>>({});

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventSlug}/reactions`);
      if (res.ok) {
        const data = await res.json();
        const newCounts: Record<string, number> = data.counts ?? {};

        for (const emoji of EMOJIS) {
          const prev = prevCountsRef.current[emoji] || 0;
          const curr = newCounts[emoji] || 0;
          if (curr > prev && prev > 0) {
            for (let i = 0; i < Math.min(curr - prev, 3); i++) {
              const fId = ++idRef.current;
              setFloating((f) => [...f, { id: fId, emoji, offsetX: -20 + Math.random() * 40 }]);
              setTimeout(() => {
                setFloating((f) => f.filter((e) => e.id !== fId));
              }, 2000);
            }
          }
        }

        prevCountsRef.current = newCounts;
        setCounts(newCounts);
      }
    } catch { /* retry */ }
  }, [eventSlug]);

  useEffect(() => {
    fetchCounts();
    const interval = setInterval(fetchCounts, 5000);
    return () => clearInterval(interval);
  }, [fetchCounts]);

  const sendReaction = useCallback(async (emoji: string) => {
    if (cooldown) return;
    setCooldown(true);
    setTimeout(() => setCooldown(false), 2000);

    const fId = ++idRef.current;
    setFloating((f) => [...f, { id: fId, emoji, offsetX: -20 + Math.random() * 40 }]);
    setTimeout(() => {
      setFloating((f) => f.filter((e) => e.id !== fId));
    }, 2000);

    setCounts((prev) => ({ ...prev, [emoji]: (prev[emoji] || 0) + 1 }));

    try {
      await fetch(`/api/events/${eventSlug}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
    } catch { /* ignore */ }
  }, [eventSlug, cooldown]);

  return (
    <div className="reaction-overlay">
      {/* Floating emojis rising from the bar */}
      <div className="reaction-overlay__floats">
        {floating.map((f) => (
          <span
            key={f.id}
            className="reaction-overlay__float-emoji"
            style={{ left: `calc(50% + ${f.offsetX}px)` }}
          >
            {f.emoji}
          </span>
        ))}
      </div>

      {/* Always-visible reaction bar (F6) — no collapse, so it's findable at a
          glance instead of hidden behind a 😊 trigger. */}
      <div className="reaction-overlay__bar" role="group" aria-label={t('title')}>
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="reaction-overlay__emoji-btn"
            onClick={() => sendReaction(emoji)}
            disabled={cooldown}
            title={t('sendReaction')}
            aria-label={emoji}
          >
            <span className="reaction-overlay__emoji">{emoji}</span>
            {(counts[emoji] || 0) > 0 && (
              <span className="reaction-overlay__count">{counts[emoji]}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

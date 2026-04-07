'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';

interface ReactionBarProps {
  eventSlug: string;
}

interface FloatingEmoji {
  id: number;
  emoji: string;
  left: number;
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
              setFloating((f) => [...f, { id: fId, emoji, left: 10 + Math.random() * 80 }]);
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
    setFloating((f) => [...f, { id: fId, emoji, left: 10 + Math.random() * 80 }]);
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

  const total = Object.values(counts).reduce((sum, c) => sum + c, 0);

  return (
    <>
      {/* Floating emojis */}
      <div className="position-relative" style={{ height: 0, overflow: 'visible', pointerEvents: 'none' }}>
        {floating.map((f) => (
          <span
            key={f.id}
            className="position-absolute"
            style={{
              left: `${f.left}%`,
              bottom: '10px',
              fontSize: '1.8rem',
              animation: 'floatUp 2s ease-out forwards',
              pointerEvents: 'none',
            }}
          >
            {f.emoji}
          </span>
        ))}
      </div>

      {/* Reaction buttons */}
      <div
        className="d-flex align-items-center justify-content-center gap-1 px-2 py-1"
        style={{ backgroundColor: '#F5F6F7' }}
      >
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="btn btn-sm border-0 position-relative"
            style={{
              fontSize: '1.2rem',
              padding: '2px 6px',
              opacity: cooldown ? 0.6 : 1,
              transition: 'transform 0.1s',
            }}
            onClick={() => sendReaction(emoji)}
            disabled={cooldown}
            title={t('sendReaction')}
            onMouseDown={(e) => { (e.target as HTMLElement).style.transform = 'scale(1.3)'; }}
            onMouseUp={(e) => { (e.target as HTMLElement).style.transform = 'scale(1)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.transform = 'scale(1)'; }}
          >
            {emoji}
            {(counts[emoji] || 0) > 0 && (
              <span
                className="position-absolute badge rounded-pill"
                style={{
                  top: '-2px',
                  right: '-4px',
                  fontSize: '0.55rem',
                  backgroundColor: '#0066CC',
                  color: '#fff',
                  padding: '1px 4px',
                }}
              >
                {counts[emoji]}
              </span>
            )}
          </button>
        ))}
        {total > 0 && (
          <span className="text-muted small ms-2">{total}</span>
        )}
      </div>

      <style>{`
        @keyframes floatUp {
          0% { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-120px) scale(0.5); opacity: 0; }
        }
      `}</style>
    </>
  );
}

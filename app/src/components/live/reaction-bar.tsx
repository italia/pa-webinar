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
  const [open, setOpen] = useState(false);
  const idRef = useRef(0);
  const prevCountsRef = useRef<Record<string, number>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Auto-close after 4s idle
  useEffect(() => {
    if (!open) return;
    if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    autoCloseRef.current = setTimeout(() => setOpen(false), 4000);
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

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

    // Reset auto-close timer on interaction
    if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    autoCloseRef.current = setTimeout(() => setOpen(false), 4000);

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
    <div ref={panelRef} className="reaction-overlay">
      {/* Floating emojis rising from the button */}
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

      {/* Emoji picker popover */}
      {open && (
        <div className="reaction-overlay__picker">
          <div className="reaction-overlay__grid">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="reaction-overlay__emoji-btn"
                onClick={() => sendReaction(emoji)}
                disabled={cooldown}
                title={t('sendReaction')}
              >
                <span className="reaction-overlay__emoji">{emoji}</span>
                {(counts[emoji] || 0) > 0 && (
                  <span className="reaction-overlay__count">{counts[emoji]}</span>
                )}
              </button>
            ))}
          </div>
          {total > 0 && (
            <div className="reaction-overlay__total">
              {total} {t('title').toLowerCase()}
            </div>
          )}
        </div>
      )}

      {/* Trigger button */}
      <button
        type="button"
        className={`reaction-overlay__trigger${open ? ' reaction-overlay__trigger--active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={t('title')}
        aria-expanded={open}
      >
        <span className="reaction-overlay__trigger-icon">😊</span>
        {total > 0 && (
          <span className="reaction-overlay__trigger-badge">{total > 99 ? '99+' : total}</span>
        )}
      </button>
    </div>
  );
}

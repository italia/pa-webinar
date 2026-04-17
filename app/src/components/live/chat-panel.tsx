'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from 'design-react-kit';

/**
 * In-app chat panel for a live event.
 *
 * Transport is our own backend (Postgres + Redis pub/sub), not Jitsi's
 * XMPP channel: this way messages persist across reconnects, feed the
 * post-event archive, and are available to AI summary pipelines.
 *
 * Ingress flow:
 *   1. On mount, fetch history once via GET /chat → seed state.
 *   2. Open an EventSource on /chat/stream → append new messages as
 *      they arrive. EventSource auto-reconnects on network blips.
 *   3. On reconnect, fetch GET /chat?since=<lastReceivedTs> to
 *      backfill anything we missed between the disconnect and the
 *      new subscription starting.
 *
 * Egress: POST /chat with either the participant/moderator token
 * (via ?token=) or a guest display-name in the body.
 */

interface ChatPanelProps {
  eventSlug: string;
  token: string;
  displayName: string;
  isGuest?: boolean;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  isModerator: boolean;
  text: string;
  createdAt: string; // ISO
}

const AVATAR_COLORS = [
  '#0066CC', '#008758', '#A66300', '#D9364F',
  '#6A50D3', '#00A8B3', '#B23683', '#73348C',
];

function getAvatarColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? '#0066CC';
}

function formatTime(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatPanel({
  eventSlug,
  token,
  displayName,
  isGuest = false,
}: ChatPanelProps) {
  const t = useTranslations('live.chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const lastSeenAtRef = useRef<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const scrollToBottom = useCallback(() => {
    if (listRef.current && isAtBottomRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 40;
  }, []);

  const upsertMessage = useCallback((msg: ChatMessage) => {
    if (seenIdsRef.current.has(msg.id)) return;
    seenIdsRef.current.add(msg.id);
    lastSeenAtRef.current = msg.createdAt;
    setMessages((prev) => [...prev, msg]);
  }, []);

  // 1. Initial history load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventSlug}/chat?limit=200`, {
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { messages: ChatMessage[] };
        data.messages.forEach((m) => {
          seenIdsRef.current.add(m.id);
          lastSeenAtRef.current = m.createdAt;
        });
        setMessages(data.messages);
      } catch { /* soft fail; SSE will still open */ }
    })();
    return () => { cancelled = true; };
  }, [eventSlug]);

  // 2. SSE stream for live updates. EventSource auto-reconnects on
  //    network errors; we rewire a since-query backfill inside the
  //    onopen handler so gap messages come back in-order.
  useEffect(() => {
    const es = new EventSource(`/api/events/${eventSlug}/chat/stream`);

    const onMessage = (e: MessageEvent) => {
      try {
        const env = JSON.parse(e.data) as ChatMessage;
        upsertMessage(env);
      } catch { /* drop malformed */ }
    };
    const onOpen = async () => {
      if (!lastSeenAtRef.current) return;
      try {
        const res = await fetch(
          `/api/events/${eventSlug}/chat?since=${encodeURIComponent(lastSeenAtRef.current)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { messages: ChatMessage[] };
        data.messages.forEach(upsertMessage);
      } catch { /* fine, we'll try again on next reconnect */ }
    };

    es.addEventListener('message', onMessage);
    es.addEventListener('open', onOpen);
    return () => {
      es.removeEventListener('message', onMessage);
      es.removeEventListener('open', onOpen);
      es.close();
    };
  }, [eventSlug, upsertMessage]);

  // Autoscroll on every append, but only while the user is pinned to
  // the bottom — if they scrolled up to read history, don't yank them
  // back on every new incoming message.
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      const body: Record<string, string> = { text };
      if (isGuest) body.guestName = displayName;
      const res = await fetch(`/api/events/${eventSlug}/chat${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      // Don't append optimistically — Redis will fan the message back
      // to us through SSE within milliseconds, and upsertMessage's
      // id-dedup means no double bubble. Keeps the ordering consistent
      // across every client in the room.
      setInput('');
    } finally {
      setSending(false);
    }
  }, [input, sending, eventSlug, token, isGuest, displayName]);

  return (
    <div className="chat-panel flex-grow-1 d-flex flex-column" style={{ minHeight: 0 }}>
      <div
        ref={listRef}
        className="chat-panel__messages flex-grow-1"
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <div className="chat-panel__empty">
            <Icon icon="it-comment" size="lg" className="mb-2 text-muted" />
            <p>{t('empty')}</p>
          </div>
        ) : (
          messages.map((m) => {
            const isOwn = m.senderName === displayName;
            const color = getAvatarColor(m.senderId || m.senderName);
            const initials = m.senderName
              .split(/\s+/)
              .map((s) => s[0])
              .filter(Boolean)
              .slice(0, 2)
              .join('')
              .toUpperCase();
            return (
              <div
                key={m.id}
                className={`chat-panel__msg ${isOwn ? 'chat-panel__msg--own' : ''}`}
              >
                {!isOwn && (
                  <div
                    className="chat-panel__avatar"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  >
                    {initials}
                  </div>
                )}
                <div>
                  <div className="chat-panel__bubble">
                    {!isOwn && (
                      <div className="chat-panel__sender">
                        {m.senderName}
                        {m.isModerator && (
                          <span
                            className="ms-1"
                            style={{ fontSize: '0.55rem', color: '#0066CC' }}
                            aria-label={t('moderatorBadge')}
                            title={t('moderatorBadge')}
                          >
                            ★
                          </span>
                        )}
                      </div>
                    )}
                    <div className="chat-panel__text">{m.text}</div>
                  </div>
                  <div className="chat-panel__time">{formatTime(m.createdAt)}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="chat-panel__input-row">
        <input
          type="text"
          className="chat-panel__input"
          value={input}
          placeholder={t('placeholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={sending}
          maxLength={2000}
          aria-label={t('inputLabel')}
        />
        <button
          type="button"
          className="chat-panel__send-btn"
          onClick={handleSend}
          disabled={sending || input.trim().length === 0}
          aria-label={t('send')}
          title={t('send')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

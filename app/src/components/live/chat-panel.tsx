'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from 'design-react-kit';

import { renderChatBody, mentionsUser } from '@/lib/chat/linkify';
import { CHAT_REACTION_EMOJIS } from '@/lib/chat/emoji';
import {
  CHAT_ATTACHMENT_MIME,
  CHAT_ATTACHMENT_MAX_BYTES,
} from '@/lib/chat/attachments';

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
 *      they arrive (op:'delete' removes a moderated message live).
 *   3. On reconnect, fetch GET /chat?since=<lastReceivedTs> to backfill.
 *
 * Egress: POST /chat with either the participant/moderator token
 * (via Authorization) or a guest display-name in the body. Authenticated
 * members can also attach one image/PDF and reply to a message.
 */

interface ChatAttachment {
  url: string;
  name: string;
  mime: string;
  size: number;
}

/**
 * The upload route's response: a rendered `ChatAttachment` (for the local
 * preview) plus the signed capability `token`. Only the token is sent to POST
 * /chat — the server re-derives url/mime/size/name from it, so a client cannot
 * reference another blob or spoof metadata.
 */
interface PendingAttachment extends ChatAttachment {
  token: string;
}

interface ChatReply {
  id: string;
  senderName: string;
  text: string;
}

interface ChatPanelProps {
  eventSlug: string;
  token: string;
  displayName: string;
  isGuest?: boolean;
  /** Enables the moderator "hide" action on each message. */
  isModerator?: boolean;
  active?: boolean;
  onUnreadCountChange?: (count: number) => void;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  isModerator: boolean;
  text: string;
  createdAt: string; // ISO
  attachment?: ChatAttachment;
  replyTo?: ChatReply;
  /** Impostato quando l'autore ha corretto il messaggio (A6). */
  editedAt?: string | null;
  /** emoji → quante reazioni (A3). Mai gli id: la tally va a tutta la sala. */
  reactions?: Record<string, number>;
}

// Small static emoji set for the compose-box picker (feedback #9). Plain string
// literals — no npm dep, server/client render identically (no hydration risk).
// 16 emojis → 2 rows of 8 in the popover grid.
const CHAT_EMOJIS = [
  '👍', '🙏', '👏', '😀', '😂', '😍', '🤔', '😮',
  '😢', '🎉', '❤️', '🔥', '✅', '👀', '💡', '🚀',
] as const;

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

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** First name-token used as the @handle for mentions. */
function mentionHandle(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? '').replace(/[^\p{L}\p{N}._-]/gu, '');
}

export default function ChatPanel({
  eventSlug,
  token,
  displayName,
  isGuest = false,
  isModerator = false,
  active = true,
  onUnreadCountChange,
}: ChatPanelProps) {
  const t = useTranslations('live.chat');
  const tc = useTranslations('common');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // Live-chat transport health, surfaced as an unobtrusive pill (feedback #8c).
  //   'live'         → SSE stream is delivering frames.
  //   'reconnecting' → EventSource fired 'error'; the browser is retrying.
  //   'degraded'     → SSE went silent yet the poll fallback (feedback #8) had to
  //                    recover messages the stream should have pushed (a silently
  //                    buffering proxy). Chat still works, just via polling.
  const [connStatus, setConnStatus] =
    useState<'live' | 'reconnecting' | 'degraded'>('live');
  // Letto dentro il backfill, che non deve ricrearsi a ogni cambio di stato.
  const connStatusRef = useRef(connStatus);
  useEffect(() => { connStatusRef.current = connStatus; }, [connStatus]);

  // Compose extras (authenticated members only).
  const canAttach = !isGuest && !!token;
  const [replyTo, setReplyTo] = useState<ChatReply | null>(null);
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const lastSeenAtRef = useRef<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  // Last time an SSE 'message'/'open' fired; the poll watchdog (feedback #8)
  // backfills when this goes stale — a silently-buffered stream is otherwise
  // indistinguishable from a quiet one (keepalives are invisible to EventSource).
  const lastRecvRef = useRef(Date.now());

  const lastReadIdRef = useRef<string | null>(null);
  const unreadCountRef = useRef(0);
  const activeRef = useRef(active);
  const onUnreadCountChangeRef = useRef(onUnreadCountChange);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { onUnreadCountChangeRef.current = onUnreadCountChange; }, [onUnreadCountChange]);

  const setUnread = useCallback((n: number) => {
    if (unreadCountRef.current === n) return;
    unreadCountRef.current = n;
    onUnreadCountChangeRef.current?.(n);
  }, []);

  // Ids of messages that name me. A ref holds the set (it is read during render
  // of every row) and a counter forces the re-render when it grows.
  const mentionedIdsRef = useRef<Set<string>>(new Set());
  const [, setMentionTick] = useState(0);

  const notifyMention = useCallback((from: string, text: string) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    // Only when the chat is not what the user is looking at — a notification for
    // a message already on screen is pure noise.
    if (activeRef.current && document.visibilityState === 'visible') return;
    try {
      if (Notification.permission !== 'granted') return;
      const n = new Notification(t('mentionNotificationTitle', { name: from }), {
        body: text.slice(0, 140),
        // Same tag: a burst of mentions collapses into one notification instead
        // of stacking up.
        tag: 'pa-webinar-chat-mention',
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch {
      // Some browsers throw in insecure contexts or when the user has blocked
      // notifications at OS level. Never let that break message rendering.
    }
  }, [t]);

  // ── Reazioni e modifica (A3, A6) ──────────────────────────────────────────
  // Le mie reazioni, per messaggio: la tally dal server è solo un conteggio
  // (non porta id, e non deve), quindi lo stato "ho già reagito" vive qui.
  const [myReactions, setMyReactions] = useState<Record<string, Set<string>>>({});
  // Il mio senderId lato server, imparato dal primo messaggio che invio. È
  // l'unico modo per sapere quali messaggi sono davvero miei: confrontare i nomi
  // sbaglia ogni volta che due persone condividono un nome (due moderatori sul
  // link condiviso si chiamano entrambi "Moderatore").
  const [mySenderId, setMySenderId] = useState<string | null>(null);
  // Il server rifiuta la modifica a chi arriva da un link condiviso (un posto
  // non è una persona): finché non lo sappiamo non offriamo la matita.
  const [canEditOwn, setCanEditOwn] = useState(false);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    setReactingId(null);
    const had = myReactions[messageId]?.has(emoji) ?? false;
    const delta = had ? -1 : 1;

    // Ottimistico sul CONTEGGIO, con rollback: un fallimento silenzioso
    // lascerebbe un numero fantasma che vede solo chi ha cliccato.
    const applyDelta = (d: number, mine: boolean) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const next = { ...(m.reactions ?? {}) };
          const value = (next[emoji] ?? 0) + d;
          if (value <= 0) delete next[emoji];
          else next[emoji] = value;
          return { ...m, reactions: next };
        }),
      );
      setMyReactions((prev) => {
        const set = new Set(prev[messageId] ?? []);
        if (mine) set.add(emoji);
        else set.delete(emoji);
        return { ...prev, [messageId]: set };
      });
    };

    applyDelta(delta, !had);
    try {
      const res = await fetch(
        `/api/events/${eventSlug}/chat/${messageId}/reactions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ emoji }),
        },
      );
      if (!res.ok) {
        applyDelta(-delta, had); // rollback
        if (res.status === 403) setComposeError(t('reactNotAllowed'));
        return;
      }
      // Il server è autoritativo su entrambi: conosce anche le reazioni altrui.
      const body = (await res.json()) as {
        reactions?: Record<string, number>;
        mine?: string[];
      };
      if (body.reactions) {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, reactions: body.reactions } : m)),
        );
      }
      if (body.mine) {
        setMyReactions((prev) => ({ ...prev, [messageId]: new Set(body.mine) }));
      }
    } catch {
      applyDelta(-delta, had); // rollback
    }
  }, [eventSlug, token, myReactions, t]);

  const saveEdit = useCallback(async (messageId: string) => {
    const text = editText.trim();
    if (!text) return;
    // L'editor resta aperto finché il server non conferma: chiuderlo prima
    // butterebbe via il testo appena riscritto a ogni rifiuto (finestra di 15
    // minuti scaduta, link condiviso, rete).
    try {
      const res = await fetch(`/api/events/${eventSlug}/chat/${messageId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text, ...(isGuest ? { guestName: displayName } : {}) }),
      });
      if (!res.ok) {
        setComposeError(res.status === 403 ? t('editNotAllowed') : t('editFailed'));
        return;
      }
      const body = (await res.json()) as { editedAt?: string };
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, text, editedAt: body.editedAt } : m)),
      );
      setEditingId(null);
    } catch {
      setComposeError(t('editFailed'));
    }
  }, [editText, eventSlug, token, isGuest, displayName, t]);

  const notificationAskedRef = useRef(false);
  const maybeRequestNotificationPermission = useCallback(() => {
    if (notificationAskedRef.current) return;
    notificationAskedRef.current = true;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      if (Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => { /* denied */ });
      }
    } catch { /* some browsers throw in insecure contexts */ }
  }, []);

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

  // Remove a moderated message (op:'delete') everywhere.
  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const upsertMessage = useCallback((msg: ChatMessage, opts?: { advanceWatermark?: boolean }) => {
    if (seenIdsRef.current.has(msg.id)) return;
    seenIdsRef.current.add(msg.id);
    // The optimistic echo of our OWN send (advanceWatermark:false) must NOT move
    // the backfill watermark: its createdAt is the newest timestamp, so advancing
    // lastSeenAtRef to it would make the poll's `?since=` skip other people's
    // messages the server already has but our (buffered) SSE hasn't delivered yet
    // — the exact messages the watchdog exists to recover. Only messages actually
    // received from the stream/backfill advance the watermark.
    if (opts?.advanceWatermark !== false) {
      lastSeenAtRef.current = msg.createdAt;
    }
    setMessages((prev) => [...prev, msg]);

    const isOwn = msg.senderName === displayName;
    // Being named in a busy chat used to look like any other message: no sound,
    // no badge, nothing — you found out by scrolling back. Mentions now get
    // their own emphasis in the list and, when the panel is not in front of you,
    // a browser notification.
    if (!isOwn && mentionsUser(msg.text, displayName)) {
      mentionedIdsRef.current.add(msg.id);
      setMentionTick((n) => n + 1);
      notifyMention(msg.senderName, msg.text);
    }
    if (!activeRef.current && !isOwn) {
      setUnread(unreadCountRef.current + 1);
      maybeRequestNotificationPermission();
    } else if (activeRef.current) {
      lastReadIdRef.current = msg.id;
    }
  }, [displayName, setUnread, maybeRequestNotificationPermission, notifyMention]);

  useEffect(() => {
    if (active) {
      setUnread(0);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last) lastReadIdRef.current = last.id;
        return prev;
      });
    }
  }, [active, setUnread]);

  // Read auth. History and the SSE stream carry other attendees' names and
  // messages, so both are token-gated server-side now (lib/chat/read-access);
  // guests send nothing and are served only while the room is open to guests.
  // EventSource cannot set headers, so the stream takes the token in the query.
  const readHeaders = useMemo<Record<string, string> | undefined>(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  );

  // Set when the server refuses read access (stale token, or a reader outside
  // the window in which the room is open without one). EventSource retries a
  // failed connection forever and cannot report the status code, so the history
  // request — which can — is the probe, and while it says 403 the stream stays
  // shut and the watchdog poll stops. Otherwise a refused reader would hammer a
  // refused endpoint for the whole event.
  const [readDenied, setReadDenied] = useState(false);

  // Denial is not necessarily permanent: a guest waiting for a scheduled event
  // is refused until the room goes LIVE, and then must be let back in. Clear the
  // flag on a timer so the effects below re-probe once a minute instead of
  // latching the panel shut for the rest of the session.
  useEffect(() => {
    if (!readDenied) return;
    const retry = setTimeout(() => setReadDenied(false), 60_000);
    return () => clearTimeout(retry);
  }, [readDenied]);

  // 1. Initial history load.
  useEffect(() => {
    // Guard, not just a dependency: without it, setting the flag inside this
    // effect would immediately re-trigger it and spin.
    if (readDenied) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventSlug}/chat?limit=200`, {
          cache: 'no-store',
          ...(readHeaders ? { headers: readHeaders } : {}),
        });
        if (res.status === 403 && !cancelled) setReadDenied(true);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { messages: ChatMessage[] };
        data.messages.forEach((m) => {
          seenIdsRef.current.add(m.id);
          lastSeenAtRef.current = m.createdAt;
        });
        const last = data.messages[data.messages.length - 1];
        if (last) lastReadIdRef.current = last.id;
        setMessages(data.messages);
      } catch { /* soft fail; SSE will still open */ }
    })();
    return () => { cancelled = true; };
  }, [eventSlug, readHeaders, readDenied]);

  // 2. SSE stream for live updates + polling fallback (live feedback #8).
  //
  // EventSource fires 'open' on the stream's first byte and the 25s keepalive is
  // a ':' comment it never surfaces as an event — so a stream that a proxy has
  // silently buffered looks identical to a healthy-but-quiet one: no 'error', no
  // 'message'. A time-since-last-message watchdog therefore backfills via GET
  // when nothing has arrived for a while, rescuing users behind buffering
  // proxies (some Edge/corporate setups) who would otherwise see no incoming
  // messages at all.
  useEffect(() => {
    if (readDenied) return;
    const es = new EventSource(
      token
        ? `/api/events/${eventSlug}/chat/stream?token=${encodeURIComponent(token)}`
        : `/api/events/${eventSlug}/chat/stream`,
    );

    const backfill = async (): Promise<number> => {
      try {
        // No watermark yet (joined an empty room, or the history load soft-failed):
        // pull the recent window so a buffered-SSE user still receives messages
        // posted after they joined. Otherwise fetch only what is newer than the
        // last message we actually received from the stream/backfill. Dedup by id
        // (seenIdsRef) keeps either path idempotent.
        // Dopo un'interruzione dello stream serve una rilettura COMPLETA, non
        // incrementale: una modifica o una reazione su un messaggio VECCHIO non
        // ha un createdAt nuovo, quindi `?since=` non la restituirebbe mai e il
        // testo corretto resterebbe sbagliato sullo schermo per tutto l'evento.
        const since = lastSeenAtRef.current;
        const full = !since || connStatusRef.current !== 'live';
        const url = full
          ? `/api/events/${eventSlug}/chat?limit=200`
          : `/api/events/${eventSlug}/chat?since=${encodeURIComponent(since)}`;
        const res = await fetch(url, {
          cache: 'no-store',
          ...(readHeaders ? { headers: readHeaders } : {}),
        });
        // Access can be withdrawn mid-session (the event is archived, a
        // registration is deleted by the retention cron, a grant is revoked).
        // Without this branch the 15s watchdog would keep polling a refused
        // endpoint — and the stream keep reconnecting — until the tab closes.
        if (res.status === 403) {
          setReadDenied(true);
          return 0;
        }
        if (!res.ok) return 0;
        const data = (await res.json()) as { messages: ChatMessage[] };
        // Count messages the stream never delivered (still unseen) BEFORE upsert
        // marks them seen. A non-zero count on the POLL path means the SSE is
        // buffered, not merely quiet (feedback #8c).
        let recovered = 0;
        data.messages.forEach((m) => {
          if (!seenIdsRef.current.has(m.id)) recovered += 1;
          upsertMessage(m);
        });
        if (full) {
          // upsertMessage ignora per progetto gli id già visti (evita i doppioni
          // dell'eco SSE), quindi la rilettura completa riconcilia a parte il
          // testo, il segno di modifica e i conteggi delle reazioni.
          setMessages((prev) =>
            prev.map((m) => {
              const fresh = data.messages.find((x) => x.id === m.id);
              return fresh
                ? { ...m, text: fresh.text, editedAt: fresh.editedAt, reactions: fresh.reactions }
                : m;
            }),
          );
        }
        return recovered;
      } catch {
        /* fine, we'll try again on the next tick/reconnect */
        return 0;
      }
    };

    const onMessage = (e: MessageEvent) => {
      lastRecvRef.current = Date.now();
      setConnStatus('live'); // a real SSE frame proves the stream is flowing
      try {
        const env = JSON.parse(e.data) as ChatMessage & {
          op?: 'delete' | 'edit' | 'reaction';
        };
        if (env.op === 'delete') {
          removeMessage(env.id);
          return;
        }
        // Edits and reactions patch a message already on screen; they must NOT
        // go through upsertMessage, whose dedup-by-id would drop them as
        // "already seen" and whose watermark would jump to the edit time.
        if (env.op === 'edit') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === env.id ? { ...m, text: env.text, editedAt: env.editedAt } : m,
            ),
          );
          // Una correzione può AGGIUNGERE una menzione ("scusa @Alex, intendevo
          // le 16"): senza questo, essere nominati in una modifica non avvisa
          // nessuno, a differenza di qualsiasi altro messaggio.
          if (env.senderId !== mySenderId && mentionsUser(env.text, displayName)) {
            mentionedIdsRef.current.add(env.id);
            setMentionTick((n) => n + 1);
            notifyMention(env.senderName, env.text);
          }
          return;
        }
        if (env.op === 'reaction') {
          setMessages((prev) =>
            prev.map((m) => (m.id === env.id ? { ...m, reactions: env.reactions } : m)),
          );
          return;
        }
        upsertMessage(env);
      } catch { /* drop malformed */ }
    };
    const onOpen = () => {
      lastRecvRef.current = Date.now();
      setConnStatus('live');
      // Join-time catch-up; recovering messages here is expected on a healthy
      // stream, so (unlike the poll) it must NOT flag 'degraded'.
      void backfill();
    };
    const onError = () => {
      // EventSource auto-reconnects (readyState → CONNECTING); the next 'open'
      // flips us back to 'live'. If it stays down, the poll keeps chat working,
      // still surfaced as a non-live state.
      setConnStatus('reconnecting');
    };

    // Watchdog: while the tab is VISIBLE, if no SSE message has arrived for 15s,
    // backfill via GET (works with or without a watermark — see backfill).
    // Gating on visibility means backgrounded tabs never poll — that steady-state
    // load (a quiet room × every attendee) was the concern; an active user behind
    // a silently-buffered proxy is still rescued. Self-throttled to ~15s (we bump
    // lastRecvRef after firing). We also backfill once immediately on refocus so a
    // returning user catches up without waiting for the interval.
    const maybeBackfill = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRecvRef.current < 15_000) return;
      lastRecvRef.current = Date.now();
      void backfill().then((recovered) => {
        // SSE silent ≥15s yet the poll recovered messages that existed
        // server-side → the stream is buffered/dropped even though EventSource
        // reported no 'error'. A later real SSE frame resets this to 'live'.
        if (recovered > 0) setConnStatus('degraded');
      });
    };
    const poll = setInterval(maybeBackfill, 5_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        lastRecvRef.current = Date.now();
        void backfill();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    es.addEventListener('message', onMessage);
    es.addEventListener('open', onOpen);
    es.addEventListener('error', onError);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      es.removeEventListener('message', onMessage);
      es.removeEventListener('open', onOpen);
      es.removeEventListener('error', onError);
      es.close();
    };
  }, [eventSlug, token, readHeaders, readDenied, upsertMessage, removeMessage]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ── Mention autocomplete ────────────────────────────────
  // Candidates are the distinct handles of people who have chatted (minus
  // the current user). Cheap, self-contained, no roster prop needed.
  const mentionCandidates = useMemo(() => {
    const selfHandle = mentionHandle(displayName).toLowerCase();
    const seen = new Map<string, string>(); // lower → display handle
    for (const m of messages) {
      const h = mentionHandle(m.senderName);
      if (h && h.toLowerCase() !== selfHandle) seen.set(h.toLowerCase(), h);
    }
    return Array.from(seen.values());
  }, [messages, displayName]);

  // Active mention query = an "@word" run at the caret (end of input here).
  const mentionQuery = useMemo(() => {
    const m = input.match(/(?:^|\s)@(\p{L}[\p{L}\p{N}._-]*)?$/u);
    return m ? (m[1] ?? '') : null;
  }, [input]);

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionCandidates
      .filter((h) => h.toLowerCase().startsWith(q))
      .slice(0, 5);
  }, [mentionQuery, mentionCandidates]);

  const applyMention = useCallback((handle: string) => {
    setInput((prev) => prev.replace(/@(\p{L}[\p{L}\p{N}._-]*)?$/u, `@${handle} `));
    inputRef.current?.focus();
  }, []);

  // ── Emoji picker (feedback #9) ──────────────────────────
  // Insert at the input's caret, update `input`, then restore focus + caret. The
  // emoji buttons preventDefault on mousedown so a mouse click never blurs the
  // input; the rAF focus() covers the keyboard-activation path.
  const insertEmoji = useCallback((emoji: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    const next = input.slice(0, start) + emoji + input.slice(end);
    if (next.length > 2000) return; // mirror the input maxLength / server cap
    setInput(next);
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      try { node.setSelectionRange(caret, caret); } catch { /* noop */ }
    });
  }, [input]);

  useEffect(() => {
    if (!emojiOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setEmojiOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEmojiOpen(false);
        inputRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [emojiOpen]);

  // ── Attachment upload ───────────────────────────────────
  const uploadFile = useCallback(async (file: File) => {
    setComposeError(null);
    if (!CHAT_ATTACHMENT_MIME.has(file.type)) {
      setComposeError(t('attachBadType'));
      return;
    }
    if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
      setComposeError(t('attachTooLarge'));
      return;
    }
    setAttaching(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`/api/events/${eventSlug}/chat/attachment`, {
        method: 'POST',
        headers,
        body: form,
      });
      if (!res.ok) {
        setComposeError(res.status === 413 ? t('attachTooLarge') : t('attachFailed'));
        return;
      }
      const data = (await res.json()) as PendingAttachment;
      setAttachment(data);
    } catch {
      setComposeError(t('attachFailed'));
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [eventSlug, token, t]);

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    if (!canAttach || attachment || attaching) return;
    const file = Array.from(e.clipboardData.files)[0];
    if (file) {
      e.preventDefault();
      void uploadFile(file);
    }
  }, [canAttach, attachment, attaching, uploadFile]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && !attachment) || sending || attaching) return;
    setSending(true);
    try {
      const body: Record<string, unknown> = {};
      if (text) body.text = text;
      if (isGuest) body.guestName = displayName;
      else if (displayName) body.displayNameOverride = displayName;
      if (replyTo) body.replyToId = replyTo.id;
      if (attachment) body.attachmentToken = attachment.token;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`/api/events/${eventSlug}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Only blame the attachment when there actually was one; a text-only
        // send that fails (rate limit, event ended, …) gets the generic error.
        setComposeError(attachment ? t('attachFailed') : t('sendFailed'));
        return;
      }
      // Optimistic echo (live feedback #8): render our OWN message immediately
      // using the REAL server id, instead of relying solely on the Redis→SSE
      // fan-out. A user behind a proxy that silently buffers the SSE stream
      // (e.g. some Edge/corporate setups) otherwise never sees anything they
      // send — not even their own line. Inserting with the canonical id means
      // the later SSE echo is dropped by seenIdsRef dedup (no double bubble),
      // and since we only echo on a confirmed 201 no rollback is ever needed.
      const created = (await res.json().catch(() => null)) as
        | { id?: string; createdAt?: string; senderId?: string; canEdit?: boolean }
        | null;
      if (created?.senderId) setMySenderId(created.senderId);
      if (typeof created?.canEdit === 'boolean') setCanEditOwn(created.canEdit);
      if (created?.id && created.createdAt) {
        upsertMessage({
          id: created.id,
          senderId: created.senderId ?? '',
          senderName: displayName,
          isModerator: !!isModerator,
          text,
          createdAt: created.createdAt,
          ...(attachment
            ? {
                attachment: {
                  url: attachment.url,
                  name: attachment.name,
                  mime: attachment.mime,
                  size: attachment.size,
                },
              }
            : {}),
          ...(replyTo
            ? {
                replyTo: {
                  id: replyTo.id,
                  senderName: replyTo.senderName,
                  text: replyTo.text.slice(0, 140),
                },
              }
            : {}),
        }, { advanceWatermark: false });
      }
      setInput('');
      setReplyTo(null);
      setAttachment(null);
      setComposeError(null);
    } finally {
      setSending(false);
    }
  }, [input, attachment, sending, attaching, eventSlug, token, isGuest, displayName, isModerator, replyTo, upsertMessage, t]);

  const hideMessage = useCallback(async (id: string) => {
    if (!isModerator || !token) return;
    // NOT optimistic: a swallowed failure would leave the message live for
    // everyone while the moderator thinks it's gone. Only remove on a confirmed
    // hide (the op:'delete' fan-out is idempotent); surface any failure.
    try {
      const res = await fetch(`/api/events/${eventSlug}/chat/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setComposeError(t('hideFailed'));
        return;
      }
      removeMessage(id);
    } catch {
      setComposeError(t('hideFailed'));
    }
  }, [isModerator, token, eventSlug, removeMessage, t]);

  return (
    <div className="chat-panel flex-grow-1 d-flex flex-column" style={{ minHeight: 0 }}>
      {/* Export (A5). The messages were always persisted, but with no way to
          take them away they were, from a participant's side, lost at the end of
          the event. Shown to whoever can read the chat — the download contains
          exactly what they can already fetch, so it adds no exposure. */}
      {messages.length > 0 && !readDenied && (
        <div className="chat-panel__toolbar">
          <a
            className="chat-panel__export"
            href={`/api/events/${eventSlug}/chat/export?format=txt${
              token ? `&token=${encodeURIComponent(token)}` : ''
            }`}
            download
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {' '}{t('exportChat')}
          </a>
        </div>
      )}
      <div
        ref={listRef}
        className="chat-panel__messages flex-grow-1"
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <div className="chat-panel__empty">
            <Icon icon={readDenied ? 'it-lock' : 'it-comment'} size="lg" className="mb-2 text-muted" />
            {/* A refused reader must not be shown the same "no messages yet" as
                a genuinely quiet room: the panel looks like it works, people
                keep writing into it, and nobody understands why nothing arrives. */}
            <p>{readDenied ? t('readDenied') : t('empty')}</p>
          </div>
        ) : (
          messages.map((m) => {
            // Il senderId quando lo conosco: due persone possono condividere il
            // nome (due moderatori sul link condiviso sono entrambi
            // "Moderatore"), e la matita di modifica non deve comparire sul
            // messaggio di un altro.
            const isOwn = mySenderId
              ? m.senderId === mySenderId
              : m.senderName === displayName;
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
                className={`chat-panel__msg ${isOwn ? 'chat-panel__msg--own' : ''}${
                  mentionedIdsRef.current.has(m.id) ? ' chat-panel__msg--mention' : ''
                }`}
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
                            style={{ fontSize: '0.55rem', color: 'var(--app-primary)' }}
                            aria-label={t('moderatorBadge')}
                            title={t('moderatorBadge')}
                          >
                            ★
                          </span>
                        )}
                      </div>
                    )}
                    {m.replyTo && (
                      <div
                        className="chat-panel__reply-quote"
                        style={{
                          borderLeft: '3px solid var(--app-primary, #06c)',
                          padding: '2px 6px',
                          margin: '0 0 4px',
                          fontSize: '0.78rem',
                          opacity: 0.85,
                          background: 'rgba(0,0,0,0.04)',
                          borderRadius: 3,
                        }}
                      >
                        <strong>{m.replyTo.senderName}</strong>
                        <div className="text-truncate" style={{ maxWidth: 220 }}>
                          {m.replyTo.text}
                        </div>
                      </div>
                    )}
                    {editingId === m.id ? (
                      <div className="d-flex gap-1 align-items-center">
                        <input
                          className="form-control form-control-sm"
                          value={editText}
                          autoFocus
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); void saveEdit(m.id); }
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          aria-label={t('editLabel')}
                        />
                        <button type="button" className="btn btn-sm btn-primary"
                                onClick={() => void saveEdit(m.id)}>
                          {t('editSave')}
                        </button>
                        <button type="button" className="btn btn-sm btn-link"
                                onClick={() => setEditingId(null)}>
                          {tc('cancel')}
                        </button>
                      </div>
                    ) : (
                      m.text && (
                        <div className="chat-panel__text">
                          {renderChatBody(m.text, displayName)}
                          {m.editedAt && (
                            <span className="chat-panel__edited" title={formatTime(m.editedAt)}>
                              {' '}({t('edited')})
                            </span>
                          )}
                        </div>
                      )
                    )}
                    {m.attachment && <Attachment att={m.attachment} openLabel={t('openAttachment')} />}
                    {m.reactions && Object.keys(m.reactions).length > 0 && (
                      <div className="chat-panel__reactions">
                        {Object.entries(m.reactions).map(([emoji, count]) => {
                          const mine = myReactions[m.id]?.has(emoji) ?? false;
                          return (
                            <button
                              key={emoji}
                              type="button"
                              className={`chat-panel__reaction-chip${
                                mine ? ' chat-panel__reaction-chip--mine' : ''
                              }`}
                              aria-pressed={mine}
                              onClick={() => void toggleReaction(m.id, emoji)}
                              aria-label={`${emoji} ${count}`}
                            >
                              <span aria-hidden="true">{emoji}</span> {count}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="chat-panel__time">
                    {formatTime(m.createdAt)}
                    {!isGuest && token && (
                      <button
                        type="button"
                        className="chat-panel__reply-btn btn btn-link p-0 ms-2"
                        aria-label={t('reply')}
                        title={t('reply')}
                        onClick={() => {
                          setReplyTo({ id: m.id, senderName: m.senderName, text: m.text || '📎' });
                          inputRef.current?.focus();
                        }}
                      >
                        {/* Inline SVG, not <Icon>: this renders once per message,
                            and design-react-kit's dynamic icon loader is the
                            known hydration-mismatch trigger on hot paths. */}
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                             strokeLinejoin="round" aria-hidden="true">
                          <polyline points="9 17 4 12 9 7" />
                          <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                        </svg>
                      </button>
                    )}
                    <span className="chat-panel__react-wrap">
                      <button
                        type="button"
                        className="chat-panel__reply-btn btn btn-link p-0 ms-2"
                        aria-label={t('react')}
                        title={t('react')}
                        aria-expanded={reactingId === m.id}
                        onClick={() => setReactingId(reactingId === m.id ? null : m.id)}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                             strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                          <line x1="9" y1="9" x2="9.01" y2="9" />
                          <line x1="15" y1="9" x2="15.01" y2="9" />
                        </svg>
                      </button>
                      {reactingId === m.id && (
                        <span className="chat-panel__react-pop" role="group" aria-label={t('react')}>
                          {CHAT_REACTION_EMOJIS.map((e) => (
                            <button key={e} type="button" onClick={() => void toggleReaction(m.id, e)}>
                              {e}
                            </button>
                          ))}
                        </span>
                      )}
                    </span>
                    {isOwn && canEditOwn && !isGuest && token && (
                      <button
                        type="button"
                        className="chat-panel__reply-btn btn btn-link p-0 ms-2"
                        aria-label={t('editLabel')}
                        title={t('editLabel')}
                        onClick={() => { setEditingId(m.id); setEditText(m.text); }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                             strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                        </svg>
                      </button>
                    )}
                    {isModerator && token && (
                      <button
                        type="button"
                        className="chat-panel__hide-btn btn btn-link p-0 ms-2 text-danger"
                        style={{ fontSize: '0.7rem' }}
                        onClick={() => hideMessage(m.id)}
                      >
                        {t('hide')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Reply context bar */}
      {replyTo && (
        <div
          className="chat-panel__reply-bar d-flex align-items-center justify-content-between"
          style={{ padding: '4px 10px', fontSize: '0.8rem', background: 'rgba(0,0,0,0.05)' }}
        >
          <span className="text-truncate">
            {t('replyingTo', { name: replyTo.senderName })}
          </span>
          <button
            type="button"
            className="btn btn-link p-0 ms-2"
            onClick={() => setReplyTo(null)}
            aria-label={t('cancelReply')}
            title={t('cancelReply')}
          >
            ✕
          </button>
        </div>
      )}

      {/* Attachment preview */}
      {attachment && (
        <div
          className="chat-panel__attach-preview d-flex align-items-center justify-content-between"
          style={{ padding: '4px 10px', fontSize: '0.8rem', background: 'rgba(0,0,0,0.05)' }}
        >
          <span className="text-truncate">
            📎 {attachment.name} <span className="text-muted">({humanSize(attachment.size)})</span>
          </span>
          <button
            type="button"
            className="btn btn-link p-0 ms-2"
            onClick={() => setAttachment(null)}
            aria-label={t('removeAttachment')}
            title={t('removeAttachment')}
          >
            ✕
          </button>
        </div>
      )}

      {composeError && (
        <div className="chat-panel__compose-error text-danger" style={{ padding: '2px 10px', fontSize: '0.78rem' }}>
          {composeError}
        </div>
      )}

      {/* Mention suggestions */}
      {mentionSuggestions.length > 0 && (
        <div className="chat-panel__mentions" style={{ padding: '2px 10px' }}>
          {mentionSuggestions.map((h) => (
            <button
              key={h}
              type="button"
              className="btn btn-sm btn-outline-primary me-1 mb-1"
              style={{ fontSize: '0.75rem', padding: '1px 8px' }}
              onClick={() => applyMention(h)}
            >
              @{h}
            </button>
          ))}
        </div>
      )}

      {connStatus !== 'live' && (
        <div
          className={`chat-panel__conn-status chat-panel__conn-status--${connStatus} d-flex align-items-center`}
          role="status"
          aria-live="polite"
          style={{
            gap: 6,
            padding: '3px 12px',
            fontSize: '0.72rem',
            fontWeight: 500,
            color: '#A66300',
            background: '#FFF6E6',
            borderTop: '1px solid #E8E8E8',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'currentColor',
              flexShrink: 0,
              opacity: connStatus === 'reconnecting' ? 0.55 : 1,
            }}
          />
          {connStatus === 'reconnecting' ? t('connReconnecting') : t('connDegraded')}
        </div>
      )}

      <div className="chat-panel__input-row">
        {canAttach && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={Array.from(CHAT_ATTACHMENT_MIME).join(',')}
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f);
              }}
            />
            <button
              type="button"
              className="chat-panel__attach-btn btn btn-link p-1"
              onClick={() => fileInputRef.current?.click()}
              disabled={attaching || !!attachment || sending}
              aria-label={t('attach')}
              title={t('attach')}
            >
              {attaching ? (
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              )}
            </button>
          </>
        )}
        <div className="chat-panel__emoji" ref={emojiRef}>
          <button
            type="button"
            className="chat-panel__emoji-btn btn btn-link p-1"
            onClick={() => setEmojiOpen((v) => !v)}
            disabled={sending}
            aria-label={t('emojiPicker')}
            title={t('emojiPicker')}
            aria-haspopup="true"
            aria-expanded={emojiOpen}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </button>
          {emojiOpen && (
            <div className="chat-panel__emoji-pop" role="group" aria-label={t('emojiPicker')}>
              {CHAT_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="chat-panel__emoji-pick"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertEmoji(emoji)}
                  aria-label={emoji}
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          className="chat-panel__input"
          value={input}
          placeholder={t('placeholder')}
          onChange={(e) => setInput(e.target.value)}
          onPaste={onPaste}
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
          disabled={sending || attaching || (input.trim().length === 0 && !attachment)}
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

/** Render a message attachment: an inline image thumbnail, or a file chip. */
function Attachment({ att, openLabel }: { att: ChatAttachment; openLabel: string }) {
  const isImage = att.mime.startsWith('image/');
  if (isImage) {
    return (
      <a href={att.url} target="_blank" rel="noopener noreferrer" title={att.name} aria-label={openLabel}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={att.url}
          alt={att.name}
          style={{ maxWidth: 220, maxHeight: 220, borderRadius: 6, marginTop: 4, display: 'block' }}
        />
      </a>
    );
  }
  return (
    <a
      href={att.url}
      target="_blank"
      rel="noopener noreferrer"
      className="chat-panel__file-chip d-inline-flex align-items-center gap-1 mt-1"
      style={{ fontSize: '0.8rem', textDecoration: 'none' }}
      title={att.name}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span className="text-truncate" style={{ maxWidth: 180 }}>{att.name}</span>
    </a>
  );
}

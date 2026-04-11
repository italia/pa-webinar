'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from 'design-react-kit';

import type { JitsiMeetExternalAPI, JitsiChatMessage } from '@/types/jitsi';

interface ChatPanelProps {
  api: JitsiMeetExternalAPI | null;
  displayName: string;
}

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: Date;
  isOwn: boolean;
}

const AVATAR_COLORS = [
  '#0066CC', '#008758', '#A66300', '#D9364F',
  '#6A50D3', '#00A8B3', '#B23683', '#73348C',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? '#0066CC';
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatPanel({ api, displayName }: ChatPanelProps) {
  const t = useTranslations('live.chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);
  const isAtBottomRef = useRef(true);

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

  useEffect(() => {
    if (!api) return;

    const handleIncoming = (evt: JitsiChatMessage) => {
      if (evt.privateMessage) return;
      const msg: ChatMessage = {
        id: `in-${++idCounter.current}`,
        sender: evt.nick || evt.from,
        text: evt.message,
        timestamp: new Date(evt.stamp || Date.now()),
        isOwn: false,
      };
      setMessages((prev) => [...prev, msg]);
    };

    const handleOutgoing = (evt: JitsiChatMessage) => {
      const msg: ChatMessage = {
        id: `out-${++idCounter.current}`,
        sender: displayName,
        text: evt.message,
        timestamp: new Date(),
        isOwn: true,
      };
      setMessages((prev) => [...prev, msg]);
    };

    api.addListener('incomingMessage', handleIncoming);
    api.addListener('outgoingMessage', handleOutgoing);

    return () => {
      api.removeListener('incomingMessage', handleIncoming);
      api.removeListener('outgoingMessage', handleOutgoing);
    };
  }, [api, displayName]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !api) return;
    api.executeCommand('sendChatMessage', text);
    setInput('');
  }, [api, input]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="chat-panel d-flex flex-column h-100">
      {/* Message list */}
      <div
        ref={listRef}
        className="chat-panel__messages flex-grow-1"
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <div className="chat-panel__empty">
            <Icon icon="it-comment" size="lg" className="mb-2" style={{ opacity: 0.3 }} />
            <p>{t('noMessages')}</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat-panel__msg${msg.isOwn ? ' chat-panel__msg--own' : ''}`}
            >
              {!msg.isOwn && (
                <div
                  className="chat-panel__avatar"
                  style={{ backgroundColor: getAvatarColor(msg.sender) }}
                >
                  {msg.sender.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="chat-panel__bubble">
                {!msg.isOwn && (
                  <div className="chat-panel__sender">{msg.sender}</div>
                )}
                <div className="chat-panel__text">{msg.text}</div>
                <div className="chat-panel__time">{formatTime(msg.timestamp)}</div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="chat-panel__input-row">
        <input
          type="text"
          className="chat-panel__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('placeholder')}
          disabled={!api}
          maxLength={500}
        />
        <button
          type="button"
          className="chat-panel__send-btn"
          onClick={handleSend}
          disabled={!api || !input.trim()}
          aria-label={t('send')}
        >
          <Icon icon="it-mail" size="sm" color="white" />
        </button>
      </div>
    </div>
  );
}

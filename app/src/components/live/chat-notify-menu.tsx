'use client';

/**
 * La campanella della chat: quando avvisare (tutti i messaggi, solo menzioni e
 * risposte, mai), con il suono e con la notifica del browser. Le scelte restano
 * nel browser (lib/chat/notify-prefs).
 *
 * Il permesso per le notifiche si chiede solo qui, quando la persona le
 * accende: un permesso chiesto senza un gesto viene ignorato o bloccato dai
 * browser, e comunque non si capisce a cosa serva.
 *
 * Icone SVG inline: il pannello della chat resta sempre montato, e l'icona del
 * kit lì produce un errore di hydration.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { playChatChime } from '@/lib/chat/chime';
import type { ChatAlertMode, ChatNotifyPrefs } from '@/lib/chat/notify-prefs';

type Permesso = NotificationPermission | 'unsupported';

function permessoAttuale(): Permesso {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

export default function ChatNotifyMenu({
  prefs,
  onChange,
}: {
  prefs: ChatNotifyPrefs;
  onChange: (patch: Partial<ChatNotifyPrefs>) => void;
}) {
  const t = useTranslations('live.chat');
  const [open, setOpen] = useState(false);
  const [permesso, setPermesso] = useState<Permesso>('default');
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const radioName = useId();

  useEffect(() => {
    setPermesso(permessoAttuale());
  }, [open]);

  const chiudi = useCallback((rimettiFuoco: boolean) => {
    setOpen(false);
    if (rimettiFuoco) buttonRef.current?.focus();
  }, []);

  // Chiusura con Esc e con un clic fuori.
  useEffect(() => {
    if (!open) return;
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') chiudi(true);
    };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) chiudi(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, chiudi]);

  /** Chiede il permesso (con un gesto, qui) e dice se le notifiche possono partire. */
  const chiediPermesso = useCallback(async (): Promise<boolean> => {
    const attuale = permessoAttuale();
    if (attuale !== 'default') return attuale === 'granted';
    try {
      const esito = await Notification.requestPermission();
      setPermesso(esito);
      return esito === 'granted';
    } catch {
      setPermesso(permessoAttuale());
      return false;
    }
  }, []);

  const scegliModo = (mode: ChatAlertMode) => {
    onChange({ mode });
    if (mode !== 'off' && prefs.desktop) void chiediPermesso();
  };

  const silenziosa = prefs.mode === 'off';
  const etichetta = silenziosa ? t('notifyButtonOff') : t('notifyButton');

  return (
    <div className="chat-notify" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`chat-notify__btn${silenziosa ? ' is-off' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={etichetta}
        title={etichetta}
        onClick={() => setOpen((o) => !o)}
      >
        {silenziosa ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
            <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
            <path d="M18 8a6 6 0 0 0-9.33-5" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        )}
        <span className="chat-notify__state">
          {silenziosa ? t('notifyOff') : prefs.mode === 'all' ? t('notifyAll') : t('notifyMentions')}
        </span>
      </button>

      {open && (
        <div className="chat-notify__pop" role="dialog" aria-labelledby={titleId}>
          <fieldset className="chat-notify__group">
            <legend id={titleId} className="chat-notify__title">
              {t('notifyTitle')}
            </legend>
            {(['all', 'mentions', 'off'] as const).map((m, i) => (
              <label key={m} className="chat-notify__option">
                <input
                  ref={i === 0 ? firstRef : undefined}
                  type="radio"
                  name={radioName}
                  value={m}
                  checked={prefs.mode === m}
                  onChange={() => scegliModo(m)}
                />
                <span>
                  {m === 'all' ? t('notifyAll') : m === 'mentions' ? t('notifyMentions') : t('notifyOff')}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="chat-notify__sep" />
          <label className="chat-notify__option">
            <input
              type="checkbox"
              checked={prefs.sound}
              disabled={silenziosa}
              onChange={(e) => {
                onChange({ sound: e.target.checked });
                // Si sente subito che suono fa, e il gesto sblocca l'audio.
                if (e.target.checked) playChatChime({ force: true });
              }}
            />
            <span>{t('notifySound')}</span>
          </label>
          <label className="chat-notify__option">
            {/* Spuntata solo se le notifiche possono davvero partire: con il
                permesso ancora da decidere si spunta per chiederlo. */}
            <input
              type="checkbox"
              checked={prefs.desktop && permesso === 'granted'}
              disabled={silenziosa || permesso === 'denied' || permesso === 'unsupported'}
              onChange={(e) => {
                if (!e.target.checked) {
                  onChange({ desktop: false });
                  return;
                }
                void chiediPermesso().then((ok) => {
                  if (ok) onChange({ desktop: true });
                });
              }}
            />
            <span>{t('notifyDesktop')}</span>
          </label>
          {permesso === 'denied' && <p className="chat-notify__hint">{t('notifyDesktopBlocked')}</p>}
          {permesso === 'unsupported' && (
            <p className="chat-notify__hint">{t('notifyDesktopUnsupported')}</p>
          )}
        </div>
      )}
    </div>
  );
}

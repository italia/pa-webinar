'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal, ModalHeader, ModalBody } from 'design-react-kit';
import { localizedPath } from '@/lib/utils/localized-url';

/**
 * In-call "Condividi" control. Opens a small modal with two copy-to-clipboard
 * links:
 *   - the tokenless join/call link  (`/{locale}/events/{slug}/live`)
 *   - the public event page          (`/{locale}/events/{slug}`)
 *
 * Both are derived from slug + locale, NEVER from `window.location.href` — the
 * moderator's current URL carries `?token=<moderatorToken>` (a moderation-
 * granting magic link) and a participant's carries `?token=<accessToken>`;
 * neither may be shared. The tokenless `/events/{slug}/live` link is exactly
 * the public shareLink the instant-call admin already emits, so it grants no
 * extra access (guests walk in when LIVE, otherwise get routed to registration).
 */
export default function LiveShareButton({
  slug,
  locale,
}: {
  slug: string;
  locale: string;
}) {
  const t = useTranslations('live.share');
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState<'call' | 'event' | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const callUrl = origin ? `${origin}${localizedPath(`/events/${slug}/live`, locale)}` : '';
  const eventUrl = origin ? `${origin}${localizedPath(`/events/${slug}`, locale)}` : '';

  const copy = useCallback(async (which: 'call' | 'event', url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for browsers/contexts without the async clipboard API.
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* give up silently — the input stays selectable for manual copy */
      }
      ta.remove();
    }
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
  }, []);

  const rows = [
    ['call', t('callLink'), t('callLinkHint'), callUrl],
    ['event', t('eventLink'), t('eventLinkHint'), eventUrl],
  ] as const;

  return (
    <>
      <Button
        color="light"
        outline
        size="xs"
        className="d-inline-flex align-items-center leave-room-btn"
        onClick={() => setOpen(true)}
        aria-label={t('button')}
      >
        {/* Inline SVG (share icon) — not design-react-kit <Icon>, per the
            project's live-chrome hydration convention. */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        <span className="d-none d-md-inline ms-1">{t('button')}</span>
      </Button>

      <Modal isOpen={open} toggle={() => setOpen(false)} centered>
        <ModalHeader toggle={() => setOpen(false)}>{t('title')}</ModalHeader>
        <ModalBody>
          {rows.map(([k, lbl, hint, url]) => (
            <div key={k} className="mb-3">
              <label className="fw-semibold d-block mb-1" style={{ fontSize: '0.9rem' }}>
                {lbl}
              </label>
              <div className="d-flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={url}
                  className="form-control form-control-sm"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  color={copied === k ? 'success' : 'primary'}
                  outline
                  size="sm"
                  className="flex-shrink-0"
                  onClick={() => void copy(k, url)}
                >
                  {copied === k ? t('copied') : t('copy')}
                </Button>
              </div>
              <small className="text-muted">{hint}</small>
            </div>
          ))}
        </ModalBody>
      </Modal>
    </>
  );
}

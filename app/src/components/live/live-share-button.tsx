'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal, ModalHeader, ModalBody } from 'design-react-kit';
import { localizedPath } from '@/lib/utils/localized-url';

type RowKey = 'call' | 'event' | 'mod';

// Inline SVGs — NOT design-react-kit <Icon>, per the live-chrome hydration rule.
const svgProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function ShareGlyph() {
  return (
    <svg {...svgProps} width={14} height={14}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
function CallGlyph() {
  return (
    <svg {...svgProps}>
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}
function EventGlyph() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function ShieldGlyph() {
  return (
    <svg {...svgProps} width={14} height={14}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/**
 * In-call "Condividi" control. A modal with copy-to-clipboard links:
 *   - the tokenless join/call link  (`/{locale}/events/{slug}/live`)
 *   - the public event page          (`/{locale}/events/{slug}`)
 *   - (moderators only, collapsed) the PRIVILEGED moderator link (`?token=...`)
 *
 * Public links are derived from slug + locale, NEVER from `window.location.href`
 * (the current URL carries the caller's `?token=`). The moderator link is built
 * from `moderatorToken`, which the live client passes ONLY when the current user
 * is a moderator — so the privileged token never enters a non-moderator's tree.
 * It is hidden behind a collapsed panel with an explicit warning so it isn't
 * shared by mistake.
 */
export default function LiveShareButton({
  slug,
  locale,
  moderatorToken,
  modalContainer,
}: {
  slug: string;
  locale: string;
  moderatorToken?: string;
  /** Element to portal the modal into. The live client passes the fullscreen
   *  element while app-owned fullscreen is active (#6) — a modal left in
   *  <body> would be outside the fullscreen subtree, i.e. invisible. Undefined
   *  keeps reactstrap's default (<body>). */
  modalContainer?: HTMLElement;
}) {
  const t = useTranslations('live.share');
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState<RowKey | null>(null);
  const [showMod, setShowMod] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const callUrl = origin ? `${origin}${localizedPath(`/events/${slug}/live`, locale)}` : '';
  const eventUrl = origin ? `${origin}${localizedPath(`/events/${slug}`, locale)}` : '';
  const modUrl =
    origin && moderatorToken
      ? `${origin}${localizedPath(`/events/${slug}/live`, locale)}?token=${moderatorToken}`
      : '';

  const copy = useCallback(async (which: RowKey, url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
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

  const rows: Array<{ key: RowKey; icon: ReactNode; label: string; hint: string; url: string }> = [
    { key: 'call', icon: <CallGlyph />, label: t('callLink'), hint: t('callLinkHint'), url: callUrl },
    { key: 'event', icon: <EventGlyph />, label: t('eventLink'), hint: t('eventLinkHint'), url: eventUrl },
  ];

  return (
    <>
      <Button
        color="light"
        outline
        size="xs"
        className="d-inline-flex align-items-center live-share-btn"
        onClick={() => setOpen(true)}
        aria-label={t('button')}
      >
        <ShareGlyph />
        <span className="d-none d-md-inline ms-1">{t('button')}</span>
      </Button>

      <Modal isOpen={open} toggle={() => setOpen(false)} centered container={modalContainer}>
        <ModalHeader toggle={() => setOpen(false)}>{t('title')}</ModalHeader>
        <ModalBody>
          {rows.map((r) => (
            <div key={r.key} className="mb-3">
              <label
                className="fw-semibold d-flex align-items-center gap-2 mb-1"
                style={{ fontSize: '0.9rem' }}
              >
                <span className="text-primary d-inline-flex">{r.icon}</span>
                {r.label}
              </label>
              <div className="d-flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={r.url}
                  className="form-control form-control-sm"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  color={copied === r.key ? 'success' : 'primary'}
                  outline
                  size="sm"
                  className="flex-shrink-0"
                  onClick={() => void copy(r.key, r.url)}
                >
                  {copied === r.key ? t('copied') : t('copy')}
                </Button>
              </div>
              <small className="text-muted">{r.hint}</small>
            </div>
          ))}

          {modUrl && (
            <div className="mt-2 pt-2 border-top">
              <button
                type="button"
                className="btn btn-link btn-sm p-0 text-decoration-none d-inline-flex align-items-center gap-1"
                onClick={() => setShowMod((s) => !s)}
                aria-expanded={showMod}
              >
                <ShieldGlyph />
                {t('moderatorReveal')}
                <span aria-hidden="true" style={{ fontSize: '0.7rem' }}>
                  {showMod ? '▲' : '▼'}
                </span>
              </button>
              {showMod && (
                <div className="mt-2">
                  {/* Plain styled div, NOT design-react-kit <Alert> (known
                      icon-overlap / padding-left bug). */}
                  <div
                    className="p-2 mb-2 rounded"
                    style={{ background: '#FFF6D6', border: '1px solid #E5C558', fontSize: '0.8rem' }}
                  >
                    {t('moderatorWarning')}
                  </div>
                  <label className="fw-semibold d-block mb-1" style={{ fontSize: '0.9rem' }}>
                    {t('moderatorLink')}
                  </label>
                  <div className="d-flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={modUrl}
                      className="form-control form-control-sm"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Button
                      color={copied === 'mod' ? 'success' : 'danger'}
                      outline
                      size="sm"
                      className="flex-shrink-0"
                      onClick={() => void copy('mod', modUrl)}
                    >
                      {copied === 'mod' ? t('copied') : t('copy')}
                    </Button>
                  </div>
                  <small className="text-muted">{t('moderatorLinkHint')}</small>
                </div>
              )}
            </div>
          )}
        </ModalBody>
      </Modal>
    </>
  );
}

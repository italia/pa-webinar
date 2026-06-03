'use client';

import { useState } from 'react';
import { Badge } from 'design-react-kit';

interface CollapsibleSectionProps {
  id: string;
  title: string;
  /**
   * Thematic icon rendered in the header. Values map to a small
   * hand-written SVG registry below, not to design-react-kit's Icon —
   * design-react-kit loads icons asynchronously into a module-level
   * cache that warms up server-side across requests but starts empty
   * on every fresh client boot, which caused React hydration error
   * #418 when we had 7+ distinct icons on the same page.
   *
   * Unknown keys fall through to no icon (the header still reads
   * fine with just the title).
   */
  icon?: string;
  defaultOpen?: boolean;
  badge?: string | number;
  subtitle?: string;
  bare?: boolean;
  children: React.ReactNode;
}

// ── Inline icon registry ──────────────────────────────────────────────
// Every SVG is byte-identical across SSR and hydration. Keep the stroke
// width and viewBox consistent with the chevrons for a coherent look.

function IconSvg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0066CC"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  'it-info-circle': (
    <IconSvg>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </IconSvg>
  ),
  'it-pa': (
    <IconSvg>
      <path d="M3 21V9l9-6 9 6v12" />
      <path d="M9 21v-7h6v7" />
    </IconSvg>
  ),
  'it-settings': (
    <IconSvg>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </IconSvg>
  ),
  'it-video': (
    <IconSvg>
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </IconSvg>
  ),
  'it-calendar': (
    <IconSvg>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </IconSvg>
  ),
  'it-files': (
    <IconSvg>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </IconSvg>
  ),
  'it-user': (
    <IconSvg>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </IconSvg>
  ),
  'it-lock': (
    <IconSvg>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </IconSvg>
  ),
};

function ChevronDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A768A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function ChevronUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A768A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

export default function CollapsibleSection({
  id,
  title,
  icon,
  defaultOpen = false,
  badge,
  subtitle,
  bare = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  // `wasOpened` is a one-way latch: once the user expands the section,
  // we keep its children mounted and only hide them via CSS. This
  // avoids a pathological loop we saw on "Sessioni e registrazioni
  // video" where a sub-component's mount effect would schedule a
  // parent re-render mid-animation; React then unmounted the content
  // and the `useState(open=false)` reset itself, producing the
  // "expands for a microsecond then collapses" behaviour.
  const [wasOpened, setWasOpened] = useState(defaultOpen);

  const wrapperStyle = bare
    ? undefined
    : {
        borderRadius: 8,
        border: '1px solid #e8e8e8',
        overflow: 'hidden',
        background: '#fff',
      };
  const contentPadding = bare
    ? 'mt-2'
    : 'px-3 px-md-4 pb-3 pb-md-4';

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !wasOpened) setWasOpened(true);
  };

  return (
    <div className="mb-3" style={wrapperStyle}>
      <button
        type="button"
        className={`d-flex align-items-center justify-content-between w-100 border-0 bg-white ${bare ? 'p-2' : 'p-3 p-md-4'}`}
        style={{ cursor: 'pointer' }}
        onClick={handleToggle}
        aria-expanded={open}
        aria-controls={`section-${id}`}
      >
        <div className="d-flex align-items-center gap-2 text-start flex-grow-1" style={{ minWidth: 0 }}>
          {icon && ICONS[icon] && (
            <span className="flex-shrink-0 d-inline-flex" aria-hidden="true">
              {ICONS[icon]}
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <h5
              className="fw-semibold mb-0"
              style={{ color: 'var(--app-text)', fontSize: '1rem' }}
            >
              {title}
              {badge !== undefined && badge !== '' && (
                <Badge color="primary" pill className="ms-2" style={{ fontSize: '0.7rem' }}>
                  {badge}
                </Badge>
              )}
            </h5>
            {subtitle && (
              <div
                className="text-secondary"
                style={{ fontSize: '0.78rem', lineHeight: 1.3, marginTop: 2 }}
              >
                {subtitle}
              </div>
            )}
          </div>
        </div>
        <span className="flex-shrink-0 ms-2 d-inline-flex">
          {open ? <ChevronUp /> : <ChevronDown />}
        </span>
      </button>
      {wasOpened && (
        <div
          id={`section-${id}`}
          className={contentPadding}
          style={{ display: open ? 'block' : 'none' }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

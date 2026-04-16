'use client';

import { useState } from 'react';
import { Badge } from 'design-react-kit';

interface CollapsibleSectionProps {
  id: string;
  title: string;
  /**
   * Icon hint for the header. Kept in the props for backwards compatibility
   * with existing call sites but ignored — design-react-kit's <Icon> loads
   * its SVG asynchronously and populates a module-level cache, which makes
   * the server and client disagree on the rendered markup once any other
   * page has pre-warmed the cache (React hydration error #418). The header
   * is already clear without the thematic icon; the chevron below signals
   * collapsibility.
   */
  icon?: string;
  defaultOpen?: boolean;
  badge?: string | number;
  subtitle?: string;
  bare?: boolean;
  children: React.ReactNode;
}

// Hard-coded inline SVGs for the expand/collapse chevron: rendered
// identically on SSR and hydration, so no iconsCache warm-up path can
// drift between server and client.
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
  defaultOpen = false,
  badge,
  subtitle,
  bare = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

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

  return (
    <div className="mb-3" style={wrapperStyle}>
      <button
        type="button"
        className={`d-flex align-items-center justify-content-between w-100 border-0 bg-white ${bare ? 'p-2' : 'p-3 p-md-4'}`}
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`section-${id}`}
      >
        <div className="d-flex align-items-center gap-2 text-start flex-grow-1" style={{ minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <h5
              className="fw-semibold mb-0"
              style={{ color: '#17324D', fontSize: '1rem' }}
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
      {open && (
        <div id={`section-${id}`} className={contentPadding}>
          {children}
        </div>
      )}
    </div>
  );
}

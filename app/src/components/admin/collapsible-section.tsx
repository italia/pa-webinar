'use client';

import { useState } from 'react';
import { Icon, Badge } from 'design-react-kit';

interface CollapsibleSectionProps {
  id: string;
  title: string;
  icon: string;
  defaultOpen?: boolean;
  badge?: string | number;
  subtitle?: string;
  /**
   * `bare` drops the outer border/background so we can wrap sub-components
   * that already render their own Card, without producing nested frames.
   * The expanded content then flows directly inside the parent container.
   */
  bare?: boolean;
  children: React.ReactNode;
}

/**
 * Accordion row used on admin event screens (create + manage) to keep the
 * surface calm: only the opened section reveals its controls. The header
 * is a full-width button so it's touch-friendly on mobile.
 */
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
          <Icon icon={icon} size="sm" color="primary" />
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
        <Icon
          icon={open ? 'it-collapse' : 'it-expand'}
          size="sm"
          color="secondary"
          className="flex-shrink-0 ms-2"
        />
      </button>
      {open && (
        <div id={`section-${id}`} className={contentPadding}>
          {children}
        </div>
      )}
    </div>
  );
}

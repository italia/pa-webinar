'use client';

import { useState, useCallback, useMemo, useDeferredValue } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale, useFormatter } from 'next-intl';
import {
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from 'design-react-kit';

import { Link } from '@/i18n/navigation';
import { getLocalized } from '@/lib/utils/locale';
import EventTitle from '@/components/events/event-title';
import { resolveKickerEnabled } from '@/lib/utils/title-kicker';

import StatusBadge from './status-badge';

interface TagSummary {
  slug: string;
  name: Record<string, string>;
  color: string | null;
}

interface EventSummary {
  id: string;
  title: Record<string, string>;
  slug: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  status: string;
  eventType?: string;
  registrationCount: number;
  maxParticipants: number;
  peakParticipants: number;
  moderatorToken: string;
  coverImageUrl: string | null;
  imageUrl: string | null;
  organizerName: string | null;
  parseTitleKicker: boolean | null;
  moderatorCount: number;
  organizerCount: number;
  tags: TagSummary[];
}

interface AdminDashboardClientProps {
  events: EventSummary[];
  token?: string;
  availableTags: TagSummary[];
  siteDefaultParseTitleKicker: boolean;
}

const STATUS_BORDER: Record<string, string> = {
  DRAFT: 'var(--app-muted)',
  PUBLISHED: 'var(--app-primary)',
  PROVISIONING: '#A66300',
  LIVE: '#008758',
  IDLE: '#A66300',
  ENDED: '#A66300',
  ARCHIVED: 'var(--app-muted)',
};

const STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'LIVE',
  'ENDED',
  'ARCHIVED',
] as const;

type SortKey = 'startsAsc' | 'startsDesc' | 'createdDesc' | 'titleAsc';
type BulkAction = 'delete' | 'archive' | null;

function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const normalized =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (normalized.length !== 6) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function monogram(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
}

export default function AdminDashboardClient({
  events,
  token,
  availableTags,
  siteDefaultParseTitleKicker,
}: AdminDashboardClientProps) {
  const locale = useLocale();
  const format = useFormatter();
  const t = useTranslations('admin');
  const tList = useTranslations('admin.eventsList');
  const tc = useTranslations('common');
  const te = useTranslations('events');
  const tStatus = useTranslations('events.status');
  const router = useRouter();

  // Bulk state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<BulkAction>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>('startsAsc');

  const toggleTagFilter = useCallback((slug: string) => {
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setSearch('');
    setStatusFilter('ALL');
    setTagFilter(new Set());
    setSort('startsAsc');
  }, []);

  const hasActiveFilters =
    search.trim() !== '' ||
    statusFilter !== 'ALL' ||
    tagFilter.size > 0 ||
    sort !== 'startsAsc';

  const filteredEvents = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    let list = events.filter((event) => {
      if (statusFilter !== 'ALL' && event.status !== statusFilter) return false;
      if (tagFilter.size > 0) {
        const eventSlugs = new Set(event.tags.map((tag) => tag.slug));
        for (const slug of tagFilter) {
          if (!eventSlugs.has(slug)) return false;
        }
      }
      if (needle) {
        const title = getLocalized(event.title, locale).toLowerCase();
        const slug = event.slug.toLowerCase();
        const organizer = (event.organizerName ?? '').toLowerCase();
        if (
          !title.includes(needle) &&
          !slug.includes(needle) &&
          !organizer.includes(needle)
        ) {
          return false;
        }
      }
      return true;
    });

    list = [...list];
    switch (sort) {
      case 'startsAsc':
        list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        break;
      case 'startsDesc':
        list.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
        break;
      case 'createdDesc':
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
      case 'titleAsc':
        list.sort((a, b) =>
          getLocalized(a.title, locale).localeCompare(
            getLocalized(b.title, locale),
          ),
        );
        break;
    }
    return list;
  }, [events, deferredSearch, statusFilter, tagFilter, sort, locale]);

  // Bulk helpers operate on the currently filtered list
  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const visibleIds = filteredEvents.map((e) => e.id);
      const allVisibleSelected =
        visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      if (allVisibleSelected) {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }, [filteredEvents]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const runBulk = useCallback(async () => {
    if (!pendingAction) return;
    setSubmitting(true);
    setError(null);
    try {
      const endpoint =
        pendingAction === 'delete'
          ? '/api/admin/events/bulk-delete'
          : '/api/admin/events/bulk-archive';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error?.message ?? tc('errorGeneric'));
        return;
      }
      setPendingAction(null);
      setSelected(new Set());
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }, [pendingAction, selected, tc, router]);

  const selectedCount = selected.size;
  const allVisibleSelected =
    filteredEvents.length > 0 &&
    filteredEvents.every((e) => selected.has(e.id));
  const hasSelection = selectedCount > 0;

  return (
    <>
      {/* Toolbar */}
      <div
        className="p-3 mb-4 rounded-3"
        style={{
          backgroundColor: '#F5F7FB',
          border: '1px solid #e8e8e8',
        }}
      >
        <div className="row g-3 align-items-end">
          <div className="col-12 col-md-5">
            <label
              htmlFor="events-search"
              className="form-label small fw-semibold mb-1"
              style={{ color: 'var(--app-text)' }}
            >
              {tList('search')}
            </label>
            <div className="position-relative">
              <span
                className="position-absolute d-flex align-items-center"
                style={{ top: 0, bottom: 0, left: 10, pointerEvents: 'none' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A768A" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
              </span>
              <input
                id="events-search"
                type="search"
                className="form-control"
                placeholder={tList('searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: 34 }}
              />
            </div>
          </div>
          <div className="col-6 col-md-3">
            <label
              htmlFor="events-status"
              className="form-label small fw-semibold mb-1"
              style={{ color: 'var(--app-text)' }}
            >
              {tList('status')}
            </label>
            <select
              id="events-status"
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">{tList('statusAll')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tStatus(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-6 col-md-4">
            <label
              htmlFor="events-sort"
              className="form-label small fw-semibold mb-1"
              style={{ color: 'var(--app-text)' }}
            >
              {tList('sort')}
            </label>
            <select
              id="events-sort"
              className="form-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="startsAsc">{tList('sortStartsAsc')}</option>
              <option value="startsDesc">{tList('sortStartsDesc')}</option>
              <option value="createdDesc">{tList('sortCreatedDesc')}</option>
              <option value="titleAsc">{tList('sortTitleAsc')}</option>
            </select>
          </div>
        </div>

        {availableTags.length > 0 && (
          <div className="mt-3">
            <div
              className="small fw-semibold mb-2"
              style={{ color: 'var(--app-text)' }}
            >
              {tList('tags')}
            </div>
            <div className="d-flex flex-wrap gap-2">
              {availableTags.map((tag) => {
                const active = tagFilter.has(tag.slug);
                const displayName =
                  tag.name[locale] ?? tag.name.it ?? tag.name.en ?? tag.slug;
                const color = tag.color ?? '#0066CC';
                return (
                  <button
                    key={tag.slug}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleTagFilter(tag.slug)}
                    className="btn btn-sm"
                    style={{
                      borderRadius: 20,
                      border: `1px solid ${color}`,
                      backgroundColor: active ? color : hexWithAlpha(color, 0.1),
                      color: active ? '#fff' : color,
                      fontWeight: 500,
                      padding: '4px 12px',
                    }}
                  >
                    {displayName}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
          <span className="small text-secondary">
            {tList('resultsCount', { count: filteredEvents.length })}
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn-sm btn-link text-decoration-none p-0"
              onClick={resetFilters}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ marginRight: 4, verticalAlign: '-2px' }}><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>
              {tList('resetFilters')}
            </button>
          )}
        </div>
      </div>

      {/* Bulk bar */}
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <button
          type="button"
          className="btn btn-outline-primary btn-xs d-inline-flex align-items-center gap-1"
          onClick={toggleAll}
          aria-pressed={allVisibleSelected}
          disabled={filteredEvents.length === 0}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {allVisibleSelected ? (
              <path d="M20 6 9 17l-5-5"/>
            ) : (
              <>
                <rect x="3" y="3" width="18" height="18" rx="3"/>
                <path d="M8 12h8"/>
              </>
            )}
          </svg>
          {allVisibleSelected ? t('bulk.deselectAll') : t('bulk.selectAll')}
        </button>
        {hasSelection && (
          <>
            <span className="text-muted small ms-1">
              {selectedCount} {t('bulk.selected')}
            </span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-xs d-inline-flex align-items-center gap-1"
              onClick={() => setPendingAction('archive')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
              {t('bulk.archive')}
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-xs d-inline-flex align-items-center gap-1"
              onClick={() => setPendingAction('delete')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              {t('bulk.delete')}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-xs"
              onClick={clearSelection}
            >
              {tc('cancel')}
            </button>
          </>
        )}
      </div>

      {filteredEvents.length === 0 ? (
        <div
          className="text-center py-5 px-4 rounded-3"
          style={{ backgroundColor: '#F5F7FB' }}
        >
          <p className="text-muted mb-0">{tList('noResults')}</p>
        </div>
      ) : (
        <div className="row g-4">
          {filteredEvents.map((event) => {
            const title = getLocalized(event.title, locale);
            const startsAt = new Date(event.startsAt);
            const endsAt = new Date(event.endsAt);
            const durationMin = Math.max(
              0,
              Math.round((endsAt.getTime() - startsAt.getTime()) / 60000),
            );
            const hours = Math.floor(durationMin / 60);
            const minutes = durationMin % 60;
            const isLive = event.status === 'LIVE';
            const isEnded = event.status === 'ENDED';
            const isInstant = event.eventType === 'INSTANT';
            const isSelected = selected.has(event.id);
            const borderColor =
              STATUS_BORDER[event.status] ?? STATUS_BORDER.DRAFT;
            const manageUrl = `/admin/events/${event.id}?token=${token ?? event.moderatorToken}`;
            const cover = event.coverImageUrl ?? event.imageUrl;
            const kickerEnabled = resolveKickerEnabled(
              event,
              siteDefaultParseTitleKicker,
            );

            const visibleTags = event.tags.slice(0, 3);
            const overflowCount = Math.max(0, event.tags.length - 3);

            return (
              <div key={event.id} className="col-12 col-md-6 col-lg-4">
                <div
                  className="event-card h-100 position-relative d-flex flex-column"
                  style={{
                    borderRadius: 8,
                    border: '1px solid #e8e8e8',
                    borderTop: `4px solid ${borderColor}`,
                    backgroundColor: '#fff',
                    overflow: 'hidden',
                    opacity: isEnded ? 0.85 : 1,
                    outline: isSelected ? '2px solid #0066CC' : 'none',
                    outlineOffset: isSelected ? '2px' : '0',
                  }}
                >
                  {/* Thumbnail */}
                  <div
                    className="position-relative"
                    style={{
                      height: 140,
                      backgroundImage: cover
                        ? `url(${cover})`
                        : 'linear-gradient(135deg, #0066CC 0%, #008758 100%)',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    aria-hidden={cover ? 'true' : undefined}
                  >
                    {!cover && (
                      <span
                        style={{
                          color: '#fff',
                          fontSize: '3rem',
                          fontWeight: 700,
                          textShadow: '0 2px 4px rgba(0,0,0,0.2)',
                          lineHeight: 1,
                        }}
                      >
                        {monogram(title)}
                      </span>
                    )}

                    {/* Status / live / instant overlay — top right */}
                    <div
                      className="position-absolute d-flex flex-wrap gap-1 justify-content-end"
                      style={{ top: 8, right: 40, maxWidth: '65%' }}
                    >
                      <StatusBadge status={event.status} />
                      {isInstant && (
                        <span
                          className="badge px-2 py-1"
                          style={{
                            fontSize: '0.7rem',
                            backgroundColor: 'rgba(255,255,255,0.92)',
                            color: '#008758',
                            borderRadius: 4,
                          }}
                        >
                          Instant
                        </span>
                      )}
                      {isLive && (
                        <span
                          className="badge d-inline-flex align-items-center gap-1 px-2 py-1"
                          style={{
                            fontSize: '0.72rem',
                            backgroundColor: '#008758',
                            color: '#fff',
                            borderRadius: 4,
                          }}
                        >
                          <span
                            className="rounded-circle d-inline-block"
                            style={{
                              width: 7,
                              height: 7,
                              backgroundColor: '#fff',
                              animation:
                                'pulse-dot 1.5s ease-in-out infinite',
                            }}
                          />
                          {te('card.liveNow')}
                        </span>
                      )}
                    </div>

                    {/* Checkbox — top left */}
                    <div
                      className="position-absolute"
                      style={{ top: 8, right: 8, zIndex: 2 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={isSelected}
                        onChange={() => toggleOne(event.id)}
                        aria-label={t('bulk.selectRow')}
                        style={{
                          cursor: 'pointer',
                          backgroundColor: 'rgba(255,255,255,0.9)',
                          borderColor: 'var(--app-text)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Body */}
                  <div className="p-3 d-flex flex-column flex-grow-1">
                    <EventTitle
                      title={title}
                      kickerEnabled={kickerEnabled}
                      as="h5"
                      className="fw-semibold mb-2"
                      style={{ color: 'var(--app-text)', lineHeight: 1.35 }}
                      wrapMain={(main) => (
                        <Link
                          href={manageUrl}
                          className="text-decoration-none"
                          style={{ color: 'inherit' }}
                        >
                          {main}
                        </Link>
                      )}
                    />

                    {/* Tag chips */}
                    {visibleTags.length > 0 && (
                      <div className="d-flex flex-wrap gap-1 mb-2">
                        {visibleTags.map((tag) => {
                          const displayName =
                            tag.name[locale] ??
                            tag.name.it ??
                            tag.name.en ??
                            tag.slug;
                          const color = tag.color ?? '#0066CC';
                          return (
                            <span
                              key={tag.slug}
                              className="badge"
                              style={{
                                backgroundColor: hexWithAlpha(color, 0.15),
                                color,
                                fontWeight: 500,
                                fontSize: '0.72rem',
                                padding: '3px 8px',
                                borderRadius: 12,
                              }}
                            >
                              {displayName}
                            </span>
                          );
                        })}
                        {overflowCount > 0 && (
                          <span
                            className="badge"
                            style={{
                              backgroundColor: '#F5F7FB',
                              color: 'var(--app-muted)',
                              fontSize: '0.72rem',
                              padding: '3px 8px',
                              borderRadius: 12,
                            }}
                          >
                            +{overflowCount}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Info strip */}
                    <ul
                      className="list-unstyled mb-3 small text-secondary"
                      style={{ fontSize: '0.82rem' }}
                    >
                      <li className="d-flex align-items-center gap-2 mb-1">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0 }}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        <span>
                          {format.dateTime(startsAt, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                          {' · '}
                          {format.dateTime(startsAt, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </li>
                      <li className="d-flex align-items-center gap-2 mb-1">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                        <span>
                          {hours > 0
                            ? tList('durationHoursMinutes', {
                                hours,
                                minutes,
                              })
                            : tList('durationMinutes', { minutes })}
                        </span>
                      </li>
                      {event.organizerName && (
                        <li className="d-flex align-items-center gap-2 mb-1">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M3 21v-2a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                          <span className="text-truncate">
                            {event.organizerName}
                          </span>
                        </li>
                      )}
                      <li className="d-flex align-items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        <span>
                          {tList('moderatorsSpeakers', {
                            mods: event.moderatorCount + 1,
                            speakers: event.organizerCount,
                          })}
                        </span>
                      </li>
                    </ul>

                    {/* Footer: registrations count + manage link */}
                    <div className="mt-auto">
                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <span
                          className="text-secondary d-inline-flex align-items-center gap-1"
                          style={{ fontSize: '0.82rem' }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                          {isEnded && event.peakParticipants > 0
                            ? tList('postEventSummary', {
                                connected: event.peakParticipants,
                                registered: event.registrationCount,
                              })
                            : tList('registeredCount', { count: event.registrationCount })}
                        </span>
                      </div>

                      <div
                        style={{
                          borderTop: '1px solid #e8e8e8',
                          paddingTop: 10,
                        }}
                      >
                        <Link
                          href={manageUrl}
                          className="text-decoration-none fw-semibold d-inline-flex align-items-center gap-1"
                          style={{ color: 'var(--app-primary)', fontSize: '0.9rem' }}
                        >
                          {t('manage')}
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={pendingAction !== null}
        toggle={() => !submitting && setPendingAction(null)}
        centered
      >
        <ModalHeader toggle={() => !submitting && setPendingAction(null)}>
          {pendingAction === 'delete' ? t('bulk.delete') : t('bulk.archive')}
        </ModalHeader>
        <ModalBody>
          <p>
            {pendingAction === 'delete'
              ? t('bulk.deleteConfirm', { count: selectedCount })
              : t('bulk.archiveConfirm', { count: selectedCount })}
          </p>
          {error && <div className="text-danger small">{error}</div>}
        </ModalBody>
        <ModalFooter>
          <Button
            color="secondary"
            outline
            onClick={() => setPendingAction(null)}
            disabled={submitting}
          >
            {tc('cancel')}
          </Button>
          <Button
            color={pendingAction === 'delete' ? 'danger' : 'primary'}
            onClick={runBulk}
            disabled={submitting}
          >
            {submitting
              ? tc('loading')
              : pendingAction === 'delete'
                ? tc('delete')
                : t('bulk.archive')}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

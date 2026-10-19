'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations, useFormatter } from 'next-intl';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'design-react-kit';

import { IconaPersone } from '@/components/admin/guided-format';
import { Icon } from '@/components/ui/icon';
import { GlyphIcon } from '@/components/ui/glyph-icon';
import { Link, percorso } from '@/i18n/navigation';
import CopyButton from '@/components/admin/copy-button';
import { useToast } from '@/components/ui/toast';
import { eventAdminPath } from '@/lib/events/admin-links';
import { localizedPath } from '@/lib/utils/localized-url';

interface InstantCallRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  createdAt: string;
  lastActiveAt: string | null;
  endsAt: string;
  moderatorName: string | null;
  moderatorToken: string;
  peakParticipants: number;
  recordingUrl: string | null;
  recordingDuration: number | null;
  recordingFileSize: string | null;
  callSessionsCount: number;
  registrationsCount: number;
}

type StatusFilter = 'all' | 'LIVE' | 'IDLE' | 'ENDED' | 'ARCHIVED';
type HasRecFilter = 'any' | 'yes' | 'no';

interface Filters {
  q: string;
  from: string;
  to: string;
  status: StatusFilter;
  hasRec: HasRecFilter;
}

const DEBOUNCE_MS = 350;
/** Quante chiamate per pagina: le altre con «Mostra altre». */
const PAGINA = 50;

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatSize(bytesStr: string | null): string {
  if (!bytesStr) return '—';
  const n = Number(bytesStr);
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

function StatusBadge({
  status,
  lastActiveAt,
  idleGraceMinutes,
  t,
}: {
  status: string;
  lastActiveAt: string | null;
  idleGraceMinutes: number;
  t: ReturnType<typeof useTranslations>;
}) {
  if (status === 'LIVE') {
    return (
      <span className="chiamata__stato chiamata__stato--live">
        <span className="chiamata__punto pulse-dot" aria-hidden="true" />
        {t('status.live')}
      </span>
    );
  }
  if (status === 'IDLE') {
    const idleSince = lastActiveAt ? new Date(lastActiveAt) : null;
    const idleMin = idleSince
      ? Math.floor((Date.now() - idleSince.getTime()) / 60000)
      : null;
    const title =
      idleMin !== null
        ? t('status.idleTooltip', {
            idle: idleMin,
            grace: idleGraceMinutes,
          })
        : t('status.idle');
    return (
      <span className="chiamata__stato chiamata__stato--pausa" title={title}>
        <GlyphIcon glyph="pause" size="xs" className="me-1" />
        {t('status.idle')}
      </span>
    );
  }
  if (status === 'ENDED') {
    return <span className="chiamata__stato">{t('status.ended')}</span>;
  }
  if (status === 'ARCHIVED') {
    return <span className="chiamata__stato">{t('status.archived')}</span>;
  }
  return <span className="chiamata__stato">{status}</span>;
}

export default function InstantCallsList({
  locale,
  idleGraceMinutes,
}: {
  locale: string;
  idleGraceMinutes: number;
}) {
  const t = useTranslations('admin.instantCalls');
  const tc = useTranslations('common');
  const ta = useTranslations('admin');
  const toast = useToast();
  const fmt = useFormatter();
  const searchParams = useSearchParams();

  // I due link si copiano per incollarli altrove: devono essere assoluti.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  const [filters, setFilters] = useState<Filters>(() => ({
    q: searchParams.get('q') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    status: (searchParams.get('status') as StatusFilter) || 'all',
    hasRec: (searchParams.get('hasRec') as HasRecFilter) || 'any',
  }));

  const [rows, setRows] = useState<InstantCallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // L'elenco non si e' potuto leggere: lo si dice, invece di mostrarlo vuoto.
  const [erroreElenco, setErroreElenco] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced fetch: whenever a filter changes, wait DEBOUNCE_MS then
  // re-query the backend and reflect the current filter state in the URL.
  const [query, setQuery] = useState('');
  // Ogni lettura dell'elenco ha il suo numero: una risposta arrivata dopo che
  // i filtri sono cambiati (una pagina in piu', o filtri vecchi) si scarta.
  const generazione = useRef(0);
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.status !== 'all') params.set('status', filters.status);
    if (filters.hasRec !== 'any') params.set('hasRec', filters.hasRec);

    const handle = setTimeout(() => {
      const qs = params.toString();
      // Update URL so filters are shareable and survive navigation.
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
      setQuery(qs);
      setLoading(true);
      const mia = ++generazione.current;
      fetch(`/api/admin/events/instant${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<{ rows: InstantCallRow[]; total: number }>;
        })
        .then((data) => {
          if (mia !== generazione.current) return;
          setErroreElenco(false);
          setRows(data.rows);
          setTotal(data.total);
        })
        .catch(() => {
          if (mia !== generazione.current) return;
          setErroreElenco(true);
          setRows([]);
          setTotal(0);
        })
        .finally(() => {
          if (mia === generazione.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [filters]);

  const refresh = useCallback(() => {
    setFilters((f) => ({ ...f }));
  }, []);

  // Le chiamate oltre la prima pagina si aggiungono in fondo.
  const loadMore = useCallback(() => {
    setLoadingMore(true);
    const mia = generazione.current;
    const params = new URLSearchParams(query);
    params.set('limit', String(PAGINA));
    params.set('offset', String(rows.length));
    fetch(`/api/admin/events/instant?${params.toString()}`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ rows: InstantCallRow[]; total: number }>;
      })
      .then((data) => {
        // I filtri sono cambiati intanto: questa pagina era di un altro elenco.
        if (mia !== generazione.current) return;
        setRows((prima) => [
          ...prima,
          ...data.rows.filter((r) => !prima.some((p) => p.id === r.id)),
        ]);
        setTotal(data.total);
      })
      .catch(() => {
        if (mia === generazione.current) toast.error(tc('errorGeneric'));
      })
      .finally(() => setLoadingMore(false));
  }, [query, rows.length, toast, tc]);

  const resetFilters = useCallback(() => {
    setFilters({ q: '', from: '', to: '', status: 'all', hasRec: 'any' });
  }, []);

  const hasActiveFilters =
    filters.q !== '' ||
    filters.from !== '' ||
    filters.to !== '' ||
    filters.status !== 'all' ||
    filters.hasRec !== 'any';

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0;

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((c) => c.id))));
  }, [rows]);

  const handleBulkDelete = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/events/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) {
        setError(tc('errorGeneric'));
        return;
      }
      const { skippedLive = 0 } = (await res.json().catch(() => ({}))) as { skippedLive?: number };
      setDeleteOpen(false);
      setSelected(new Set());
      // Il modale si e' chiuso: l'avviso va in una notifica, non nel suo corpo.
      if (skippedLive > 0) toast.info(ta('bulkDeleteSkippedLive', { count: skippedLive }));
      refresh();
    } finally {
      setSubmitting(false);
    }
  }, [selected, tc, ta, toast, refresh]);

  const selectedCount = useMemo(() => selected.size, [selected]);

  const statoRicerca = loading
    ? tc('loading')
    : t('totalCount', { count: total });

  return (
    <>
      {/* I filtri, come nell'elenco degli eventi: etichetta sopra ogni campo,
          tutti alla stessa altezza. */}
      <div className="chiamate-filtri">
        <div className="row g-3 align-items-end">
          <div className="col-12 col-lg-4">
            <label className="form-label" htmlFor="ic-q">{t('filters.search')}</label>
            <input
              id="ic-q"
              type="search"
              className="form-control"
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder={t('filters.searchPlaceholder')}
            />
          </div>
          <div className="col-6 col-lg-2">
            <label className="form-label" htmlFor="ic-from">{t('filters.from')}</label>
            <input
              id="ic-from"
              type="date"
              className="form-control"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            />
          </div>
          <div className="col-6 col-lg-2">
            <label className="form-label" htmlFor="ic-to">{t('filters.to')}</label>
            <input
              id="ic-to"
              type="date"
              className="form-control"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            />
          </div>
          <div className="col-6 col-lg-2">
            <label className="form-label" htmlFor="ic-status">{t('filters.status')}</label>
            <select
              id="ic-status"
              className="form-select"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))}
            >
              <option value="all">{t('filters.statusAll')}</option>
              <option value="LIVE">{t('status.live')}</option>
              <option value="IDLE">{t('status.idle')}</option>
              <option value="ENDED">{t('status.ended')}</option>
              <option value="ARCHIVED">{t('status.archived')}</option>
            </select>
          </div>
          <div className="col-6 col-lg-2">
            <label className="form-label" htmlFor="ic-rec">{t('filters.recording')}</label>
            <select
              id="ic-rec"
              className="form-select"
              value={filters.hasRec}
              onChange={(e) => setFilters((f) => ({ ...f, hasRec: e.target.value as HasRecFilter }))}
            >
              <option value="any">{t('filters.recAny')}</option>
              <option value="yes">{t('filters.recYes')}</option>
              <option value="no">{t('filters.recNo')}</option>
            </select>
          </div>
        </div>
        {hasActiveFilters && (
          <div className="d-flex justify-content-end mt-2">
            <button type="button" className="btn btn-link btn-sm p-0" onClick={resetFilters}>
              {t('filters.reset')}
            </button>
          </div>
        )}
      </div>

      <div className="chiamate-barra">
        <div className="d-flex flex-wrap align-items-center gap-2">
          {rows.length > 0 && (
            <button
              type="button"
              className="btn btn-outline-primary btn-xs"
              onClick={toggleAll}
              aria-pressed={allSelected}
            >
              {allSelected ? t('deselectAll') : t('selectAll')}
            </button>
          )}
          {someSelected && (
            <>
              <span className="chiamate-barra__conta">
                {t('selectedCount', { count: selectedCount })}
              </span>
              <button
                type="button"
                className="btn btn-outline-danger btn-xs"
                onClick={() => setDeleteOpen(true)}
              >
                {t('deleteSelected')}
              </button>
            </>
          )}
        </div>
        <span className="chiamate-barra__conta" role="status">
          {erroreElenco ? '' : statoRicerca}
        </span>
      </div>

      {!loading && erroreElenco ? (
        <div className="alert alert-danger d-flex flex-wrap align-items-center justify-content-between gap-2" role="alert">
          <span>{tc('errorGeneric')}</span>
          <button type="button" className="btn btn-outline-danger btn-sm" onClick={refresh}>
            {tc('retry')}
          </button>
        </div>
      ) : !loading && rows.length === 0 ? (
        <div className="chiamate-vuoto">
          <Icon icon="it-video" size="lg" className="mb-2" />
          <p className="mb-0">{hasActiveFilters ? t('noResults') : t('noCalls')}</p>
        </div>
      ) : (
        <ul className="chiamate-elenco">
          {rows.map((call) => {
            const hasRecording = !!call.recordingUrl;
            const isSelected = selected.has(call.id);
            const liveUrl = `${origin}${localizedPath(`/events/${call.slug}/live`, locale)}`;
            // Una chiamata archiviata non si riapre: i suoi link non servono piu'.
            const conLink = call.status !== 'ARCHIVED';

            return (
              <li
                key={call.id}
                className={`chiamata${isSelected ? ' chiamata--scelta' : ''}`}
              >
                <input
                  type="checkbox"
                  className="form-check-input chiamata__scelta"
                  checked={isSelected}
                  onChange={() => toggleOne(call.id)}
                  aria-label={t('selectRowNamed', { title: call.title })}
                />
                <div className="chiamata__corpo">
                  <div className="chiamata__testa">
                    <Link href={percorso(eventAdminPath(call.id))} className="chiamata__titolo">
                      {call.title}
                    </Link>
                    <StatusBadge
                      status={call.status}
                      lastActiveAt={call.lastActiveAt}
                      idleGraceMinutes={idleGraceMinutes}
                      t={t}
                    />
                    {hasRecording && (
                      <span className="chiamata__stato chiamata__stato--rec">{t('recorded')}</span>
                    )}
                  </div>
                  <ul className="chiamata__dati">
                    {call.moderatorName && (
                      <li>
                        <Icon icon="it-user" size="xs" />
                        {call.moderatorName}
                      </li>
                    )}
                    <li>
                      <Icon icon="it-calendar" size="xs" />
                      {fmt.dateTime(new Date(call.createdAt), {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </li>
                    <li>
                      <IconaPersone />
                      {t('participantsCount', { count: call.peakParticipants })}
                    </li>
                    {call.recordingDuration ? (
                      <li>
                        <Icon icon="it-clock" size="xs" />
                        {formatDuration(call.recordingDuration)}
                        {call.recordingFileSize && ` · ${formatSize(call.recordingFileSize)}`}
                      </li>
                    ) : null}
                    {call.callSessionsCount > 0 && (
                      <li>{t('sessionsCount', { count: call.callSessionsCount })}</li>
                    )}
                  </ul>
                </div>
                {/* I due link della chiamata: una istantanea non ha una pagina
                    pubblica, e questi sono l'unico modo di farci entrare
                    qualcuno. */}
                {conLink && (
                  <div className="chiamata__link">
                    <CopyButton
                      text={`${liveUrl}?token=${call.moderatorToken}`}
                      label={t('linkModerator')}
                      accessibleName={t('copyModeratorLink', { title: call.title })}
                    />
                    <CopyButton
                      text={liveUrl}
                      label={t('linkGuests')}
                      accessibleName={t('copyGuestLink', { title: call.title })}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!loading && rows.length < total && (
        <div className="text-center mt-3">
          <button
            type="button"
            className="btn btn-outline-primary"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? tc('loading') : t('loadMore')}
          </button>
        </div>
      )}

      <Modal isOpen={deleteOpen} toggle={() => !submitting && setDeleteOpen(false)} centered>
        <ModalHeader closeAriaLabel={tc('close')} toggle={() => !submitting && setDeleteOpen(false)}>
          {t('deleteSelected')}
        </ModalHeader>
        <ModalBody>
          <p>{t('deleteConfirm', { count: selectedCount })}</p>
          {error && <div className="text-danger small">{error}</div>}
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" outline onClick={() => setDeleteOpen(false)} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button color="danger" onClick={handleBulkDelete} disabled={submitting}>
            {submitting ? tc('loading') : tc('delete')}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

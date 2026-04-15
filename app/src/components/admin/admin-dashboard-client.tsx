'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale, useFormatter } from 'next-intl';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Icon,
  Row,
  Col,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from 'design-react-kit';

import { Link } from '@/i18n/navigation';
import { getLocalized } from '@/lib/utils/locale';

import StatusBadge from './status-badge';

interface EventSummary {
  id: string;
  title: Record<string, string>;
  slug: string;
  startsAt: string;
  endsAt: string;
  status: string;
  eventType?: string;
  registrationCount: number;
  maxParticipants: number;
  moderatorToken: string;
}

interface AdminDashboardClientProps {
  events: EventSummary[];
  token?: string;
}

const STATUS_BORDER: Record<string, string> = {
  DRAFT: '#5A768A',
  PUBLISHED: '#0066CC',
  LIVE: '#008758',
  ENDED: '#A66300',
  ARCHIVED: '#5A768A',
};

type BulkAction = 'delete' | 'archive' | null;

export default function AdminDashboardClient({
  events,
  token,
}: AdminDashboardClientProps) {
  const locale = useLocale();
  const format = useFormatter();
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const te = useTranslations('events');
  const router = useRouter();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<BulkAction>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === events.length ? new Set() : new Set(events.map((e) => e.id)),
    );
  }, [events]);

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

  const selectedCount = useMemo(() => selected.size, [selected]);
  const allSelected = events.length > 0 && selected.size === events.length;
  const hasSelection = selectedCount > 0;

  return (
    <>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <Button
          color="primary"
          outline
          size="xs"
          onClick={toggleAll}
          aria-pressed={allSelected}
        >
          <Icon
            icon={allSelected ? 'it-check-circle' : 'it-check'}
            size="xs"
            className="me-1"
          />
          {allSelected ? t('bulk.deselectAll') : t('bulk.selectAll')}
        </Button>
        {hasSelection && (
          <>
            <span className="text-muted small ms-1">
              {selectedCount} {t('bulk.selected')}
            </span>
            <Button
              color="secondary"
              outline
              size="xs"
              onClick={() => setPendingAction('archive')}
            >
              <Icon icon="it-box" size="xs" className="me-1" />
              {t('bulk.archive')}
            </Button>
            <Button
              color="danger"
              outline
              size="xs"
              onClick={() => setPendingAction('delete')}
            >
              <Icon icon="it-delete" size="xs" className="me-1" />
              {t('bulk.delete')}
            </Button>
            <Button color="secondary" outline size="xs" onClick={clearSelection}>
              <Icon icon="it-close" size="xs" className="me-1" />
              {tc('cancel')}
            </Button>
          </>
        )}
      </div>

      <Row>
        {events.map((event) => {
          const title = getLocalized(event.title, locale);
          const startsAt = new Date(event.startsAt);
          const endsAt = new Date(event.endsAt);
          const isLive = event.status === 'LIVE';
          const isEnded = event.status === 'ENDED';
          const isInstant = event.eventType === 'INSTANT';
          const isSelected = selected.has(event.id);
          const occupancyPct = Math.min(
            100,
            (event.registrationCount / event.maxParticipants) * 100,
          );
          const borderColor = STATUS_BORDER[event.status] ?? STATUS_BORDER.DRAFT;
          const manageUrl = `/admin/events/${event.id}?token=${token ?? event.moderatorToken}`;

          return (
            <Col key={event.id} sm={12} md={6} lg={4} className="mb-4">
              <Card
                className="event-card h-100 border-0 position-relative"
                style={{
                  borderTop: `4px solid ${borderColor}`,
                  borderRadius: 8,
                  opacity: isEnded ? 0.75 : 1,
                  outline: isSelected ? '2px solid #0066CC' : 'none',
                  outlineOffset: isSelected ? '2px' : '0',
                }}
              >
                <div
                  className="position-absolute"
                  style={{ top: 10, right: 10, zIndex: 2 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={isSelected}
                    onChange={() => toggleOne(event.id)}
                    aria-label={t('bulk.selectRow')}
                    style={{ cursor: 'pointer' }}
                  />
                </div>

                <CardBody className="p-4 d-flex flex-column">
                  <div className="d-flex align-items-center gap-2 mb-3" style={{ paddingRight: 28 }}>
                    <StatusBadge status={event.status} />
                    {isInstant && (
                      <Badge
                        color=""
                        className="px-2 py-1"
                        style={{
                          fontSize: '0.7rem',
                          backgroundColor: 'rgba(0,135,88,0.1)',
                          color: '#008758',
                        }}
                      >
                        Instant
                      </Badge>
                    )}
                    {isLive && (
                      <Badge
                        color="success"
                        className="px-2 py-1 d-inline-flex align-items-center gap-1"
                        style={{ fontSize: '0.72rem' }}
                      >
                        <span
                          className="rounded-circle d-inline-block"
                          style={{
                            width: 7,
                            height: 7,
                            backgroundColor: '#fff',
                            animation: 'pulse-dot 1.5s ease-in-out infinite',
                          }}
                        />
                        {te('card.liveNow')}
                      </Badge>
                    )}
                  </div>

                  <h5 className="fw-semibold mb-2" style={{ color: '#17324D', lineHeight: 1.4 }}>
                    <Link
                      href={manageUrl}
                      className="text-decoration-none"
                      style={{ color: 'inherit' }}
                    >
                      {title}
                    </Link>
                  </h5>

                  <div className="d-flex align-items-center text-secondary mb-2" style={{ fontSize: '0.88rem' }}>
                    <Icon icon="it-calendar" size="sm" className="me-2 flex-shrink-0" />
                    <span>
                      {format.dateTime(startsAt, {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                      {' · '}
                      {format.dateTime(startsAt, { hour: '2-digit', minute: '2-digit' })}
                      {' – '}
                      {format.dateTime(endsAt, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="mt-auto">
                    <div className="d-flex align-items-center justify-content-between mb-1">
                      <span className="text-secondary" style={{ fontSize: '0.85rem' }}>
                        <Icon icon="it-user" size="sm" className="me-1" />
                        {event.registrationCount} / {event.maxParticipants}
                      </span>
                      <span className="text-muted" style={{ fontSize: '0.78rem' }}>
                        {Math.round(occupancyPct)}%
                      </span>
                    </div>
                    <div className="progress mb-3" style={{ height: 4, borderRadius: 2 }}>
                      <div
                        className="progress-bar"
                        role="progressbar"
                        style={{
                          width: `${occupancyPct}%`,
                          backgroundColor: borderColor,
                          borderRadius: 2,
                        }}
                        aria-valuenow={event.registrationCount}
                        aria-valuemin={0}
                        aria-valuemax={event.maxParticipants}
                      />
                    </div>

                    <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 12 }}>
                      <Link
                        href={manageUrl}
                        className="text-decoration-none fw-semibold d-inline-flex align-items-center"
                        style={{ color: '#0066CC', fontSize: '0.9rem' }}
                      >
                        {t('manage')} <Icon icon="it-arrow-right" size="sm" className="ms-1" />
                      </Link>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </Col>
          );
        })}
      </Row>

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

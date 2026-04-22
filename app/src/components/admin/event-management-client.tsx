'use client';

/**
 * Admin event detail page.
 *
 * Hero (title + status + tags + CTAs) on top; tabbed body on the left
 * (Panoramica / Impostazioni / Persone / Contenuti / Registrazioni &
 * Audit) — tab order mirrors the create-event wizard — and a sticky
 * sidebar on the right with KPIs, reminders and the primary edit CTA.
 *
 * Feature-flag toggles are intentionally read-only here: editing lives
 * in /admin/events/[id]/edit. Having two sources of truth caused
 * confusion where the wizard and the detail page could disagree.
 */

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { Link, useRouter } from '@/i18n/navigation';
import EventTitle from '@/components/events/event-title';
import { MarkdownRenderer } from '@/components/ui/markdown';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

import CallSessionsPanel from './call-sessions-panel';
import DeleteEventModal from './delete-event-modal';
import EventConfigDiagram from './event-config-diagram';
import EventModeratorsPanel from './event-moderators-panel';
import PostEventConfig from './post-event-config';
import RecordingManagement from './recording-management';
import StatusBadge from './status-badge';

// ── Palette ──
const C_PRIMARY = '#0066CC';
const C_SUCCESS = '#008758';
const C_INK = '#17324D';
const C_MUTED = '#5A768A';
const C_DANGER = '#CC334D';

// ── Shared styles ──
const CARD: CSSProperties = { borderRadius: 8, border: '1px solid #e8e8e8', background: '#fff' };
const EYEBROW: CSSProperties = { fontSize: '0.72rem', letterSpacing: '0.04em', color: C_MUTED, fontWeight: 600, textTransform: 'uppercase' };
const CAPTION: CSSProperties = { fontSize: '0.85rem', color: C_MUTED };
const PILL_MUTED: CSSProperties = { background: '#E9ECEF', color: C_INK, fontSize: '0.78rem', fontWeight: 500 };

// ── Inline SVGs (currentColor, 24×24 viewBox) ──
// Using SVG instead of design-react-kit <Icon> avoids the hydration
// mismatch the kit's dynamic icon loader triggers on SSR pages.
type IconName =
  | 'arrow-left' | 'link' | 'user-group' | 'video' | 'folder' | 'shield'
  | 'pencil' | 'check' | 'x' | 'info' | 'external' | 'settings';

const ICONS: Record<IconName, ReactNode> = {
  'arrow-left': <path d="M19 12H5M12 19l-7-7 7-7" />,
  link: <>
    <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.41 4.59" />
    <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.41-1.41" />
  </>,
  'user-group': <>
    <circle cx="9" cy="8" r="3.5" /><path d="M2 20v-1a6 6 0 0 1 12 0v1" />
    <circle cx="17" cy="9" r="2.5" /><path d="M16 14a5 5 0 0 1 6 4.9V20" />
  </>,
  video: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M22 8l-6 4 6 4V8z" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />,
  shield: <path d="M12 2l9 4v6c0 5-4 9-9 10-5-1-9-5-9-10V6l9-4z" />,
  pencil: <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </>,
  check: <path d="M20 6L9 17l-5-5" />,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
  external: <>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6M10 14L21 3" />
  </>,
  settings: <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9 2 2 0 1 1-2.8 2.8 1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2 2 2 0 1 1-2.8-2.8A1.7 1.7 0 0 0 4.6 14H3a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.6-2.9 2 2 0 1 1 2.8-2.8A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.1 2 2 0 1 1 2.8 2.8A1.7 1.7 0 0 0 20.9 10H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>,
};

function Svg({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

// ── Types ──
interface Registration {
  id: string; displayName: string; organization: string | null;
  organizationRole: string | null; organizationType: string | null;
  joinedAt: string | null; createdAt: string;
}
interface MaterialData {
  id: string; title: string; url: string;
  description: string | null; addedBy: string; createdAt: string;
}
interface ReminderData {
  id: string; offsetMinutes: number; label: string;
  sentCount: number; createdAt: string;
}
interface GdprAuditLogData {
  id: string; action: string; recordCount: number;
  details: string | null; createdAt: string;
}
interface TagData { id: string; slug: string; name: Record<string, string>; color: string | null }
interface OrganizerData { id: string; name: string; logoUrl: string | null; websiteUrl: string | null }
interface EventModeratorData {
  id: string; name: string; email: string | null;
  role: 'MODERATOR' | 'SPEAKER'; revokedAt: string | null;
}

interface EventData {
  id: string; slug: string;
  title: Record<string, string>; description: Record<string, string>;
  startsAt: string; endsAt: string; timezone: string;
  maxParticipants: number; registrationCount: number; peakParticipants: number;
  qaEnabled: boolean; chatEnabled: boolean; recordingEnabled: boolean;
  participantsCanUnmute: boolean; participantsCanStartVideo: boolean; participantsCanShareScreen: boolean;
  status: string;
  coverImageUrl: string | null; imageUrl: string | null;
  parseTitleKicker: boolean | null;
  expectedSenderRatioPct: number | null;
  capacityEstimateJson: Record<string, unknown> | null;
  recordingUrl: string | null; tempRecordingUrl: string | null; tempRecordingStartedAt: string | null;
  recordingPublished: boolean; recordingPublishedAt: string | null;
  recordingFileSize: number | null; recordingDuration: number | null; recordingDeleteAfterDays: number | null;
  postEventPublic: boolean; postEventPublicUntil: string | null;
  postEventShowQA: boolean; postEventShowMaterials: boolean;
  postEventShowPolls: boolean; postEventShowFeedback: boolean;
  feedbackEnabled: boolean; recordingConsentText: string | null;
  requireOrganization: boolean; requireOrganizationRole: boolean; requireOrganizationType: boolean;
  moderatorToken: string; moderatorName: string | null; moderatorEmail: string | null;
  jitsiRoomName: string; dataRetentionDays: number;
  privacyPolicyUrl: string | null; privacyPolicyText: string | null;
  speakersInfo: Record<string, string> | null;
  createdAt: string;
  tags: TagData[]; organizers: OrganizerData[]; eventModerators: EventModeratorData[];
  questionnaireCount: number;
  registrations: Registration[]; materials: MaterialData[];
  reminders: ReminderData[]; gdprAuditLogs: GdprAuditLogData[];
}

interface EventManagementClientProps {
  event: EventData; baseUrl: string; locale: string; kickerEnabled: boolean;
}

type TabId = 'panoramica' | 'impostazioni' | 'persone' | 'contenuti' | 'audit';

const ORG_TYPE_LABELS: Record<string, { it: string; en: string }> = {
  MINISTRY: { it: 'Ministero', en: 'Ministry' },
  AGENCY: { it: 'Agenzia', en: 'Agency' },
  REGION: { it: 'Regione', en: 'Region' },
  PROVINCE: { it: 'Provincia', en: 'Province' },
  MUNICIPALITY: { it: 'Comune', en: 'Municipality' },
  ASL: { it: 'ASL', en: 'ASL' },
  UNIVERSITY: { it: 'Università', en: 'University' },
  PUBLIC_ENTITY: { it: 'Ente pubblico', en: 'Public entity' },
  IN_HOUSE: { it: 'Società in-house', en: 'In-house company' },
  OTHER: { it: 'Altro', en: 'Other' },
};

function tagChipStyle(color: string | null): CSSProperties {
  const base = color ?? C_PRIMARY;
  return {
    background: `${base}18`, color: base, border: `1px solid ${base}40`,
    borderRadius: 999, fontSize: '0.75rem', fontWeight: 600,
    padding: '2px 10px', lineHeight: 1.6, whiteSpace: 'nowrap',
  };
}

// ── Main component ──
export default function EventManagementClient({
  event, baseUrl, locale, kickerEnabled,
}: EventManagementClientProps) {
  const t = useTranslations('admin');
  const td = useTranslations('admin.eventDetail');
  const te = useTranslations('events');
  const tr = useTranslations('reminders');
  const format = useFormatter();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabId>('panoramica');
  const [status, setStatus] = useState(event.status);
  const [updating, setUpdating] = useState(false);
  const [feedback, setFeedback] = useState('');

  const title = getLocalized(event.title, locale);
  const description = getLocalized(event.description, locale);
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const durationMs = endsAt.getTime() - startsAt.getTime();
  const durationHours = Math.floor(durationMs / 3_600_000);
  const durationMinutes = Math.floor((durationMs % 3_600_000) / 60_000);

  const publicUrl = `${baseUrl}/${locale}/${locale === 'it' ? 'eventi' : 'events'}/${event.slug}`;
  const moderatorUrl = `${baseUrl}/${locale}/admin/events/${event.id}?token=${event.moderatorToken}`;
  const liveModeratorUrl = `/events/${event.slug}/live?token=${event.moderatorToken}`;
  const editUrl = `/admin/events/${event.id}/edit?token=${event.moderatorToken}`;


  // Capacity estimate sidebar surface. Everything else stays in the diagram.
  const capacity = event.capacityEstimateJson ?? null;
  const jvbCount = capacity && typeof capacity.jvbCount === 'number' ? capacity.jvbCount : null;
  const jvbRam = capacity && typeof capacity.jvbRam === 'string' ? capacity.jvbRam : null;

  const togglePublish = useCallback(async () => {
    const newStatus = status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
    setUpdating(true); setFeedback('');
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${event.moderatorToken}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setStatus(newStatus);
        setFeedback(newStatus === 'PUBLISHED' ? t('publishSuccess') : t('unpublishSuccess'));
      }
    } finally { setUpdating(false); }
  }, [status, event.id, event.moderatorToken, t]);

  const isEarlyStart = startsAt.getTime() > Date.now() + 30 * 60_000;

  const startEvent = useCallback(async () => {
    setUpdating(true); setFeedback('');
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${event.moderatorToken}` },
        body: JSON.stringify({ status: 'LIVE' }),
      });
      if (res.ok) {
        setStatus('LIVE');
        setFeedback(isEarlyStart ? `${t('startEventSuccess')} ${t('jvbWarmupWarning')}` : t('startEventSuccess'));
      }
    } finally { setUpdating(false); }
  }, [event.id, event.moderatorToken, isEarlyStart, t]);

  const handleDeleted = useCallback(() => { router.push('/admin'); }, [router]);

  const exportCsv = useCallback(() => {
    const headers = ['Nome', 'Ente', 'Ruolo', 'Tipologia ente', 'Data registrazione', 'Entrato'];
    const rows = event.registrations.map((r) => [
      r.displayName,
      r.organization ?? '',
      r.organizationRole ?? '',
      r.organizationType ? (ORG_TYPE_LABELS[r.organizationType]?.[locale as 'it' | 'en'] ?? r.organizationType) : '',
      new Date(r.createdAt).toISOString(),
      r.joinedAt ? 'Si' : 'No',
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `registrazioni-${event.slug}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [event.registrations, event.slug, locale]);

  // Live peak-count poll when LIVE.
  const [liveCount, setLiveCount] = useState<number | null>(null);
  useEffect(() => {
    if (status !== 'LIVE') { setLiveCount(null); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/events/${event.slug}/analytics/peak?token=${event.moderatorToken}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setLiveCount(data.peakParticipants ?? null);
        }
      } catch { /* ignore */ }
    };
    poll();
    const i = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(i); };
  }, [status, event.slug, event.moderatorToken]);

  const coverBg = event.coverImageUrl ?? event.imageUrl ?? null;
  const firstLetter = (title || '?').trim().charAt(0).toUpperCase();

  return (
    <>
      {/* ── Breadcrumb ── */}
      <div className="mb-3">
        <Link href="/admin" className="text-decoration-none d-inline-flex align-items-center"
              style={{ fontSize: '0.9rem', color: C_PRIMARY }}>
          <span className="me-1"><Svg name="arrow-left" size={14} /></span>
          {t('title')}
        </Link>
      </div>

      {/* ═══ Hero ═══ */}
      <div className="p-4 mb-4" style={CARD}>
        <div className="d-flex flex-wrap gap-3 align-items-start">
          {/* Cover thumbnail */}
          <div className="flex-shrink-0 d-flex align-items-center justify-content-center"
               aria-hidden={!!coverBg}
               style={{
                 width: 120, height: 80, borderRadius: 8, overflow: 'hidden',
                 background: coverBg
                   ? `url(${coverBg}) center/cover no-repeat`
                   : `linear-gradient(135deg, ${C_PRIMARY} 0%, ${C_SUCCESS} 100%)`,
                 color: '#fff', fontSize: '2rem', fontWeight: 700,
               }}>
            {!coverBg && firstLetter}
          </div>

          {/* Middle */}
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <EventTitle title={title} kickerEnabled={kickerEnabled} as="h1"
                        className="fw-bold mb-2"
                        style={{ color: C_INK, fontSize: '1.5rem', lineHeight: 1.2 }} />
            <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
              <StatusBadge status={status} />
              {event.tags.map((tag) => (
                <span key={tag.id} style={tagChipStyle(tag.color)}>
                  {getLocalized(tag.name, locale) || tag.slug}
                </span>
              ))}
            </div>
            <div className="d-flex align-items-center gap-3 flex-wrap" style={{ ...CAPTION, fontSize: '0.88rem' }}>
              <span>
                {format.dateTime(startsAt, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                {' · '}
                {format.dateTime(startsAt, { hour: '2-digit', minute: '2-digit' })}
                {' – '}
                {format.dateTime(endsAt, { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span>·</span>
              <span>{te('detail.durationHours', { hours: durationHours, minutes: durationMinutes })}</span>
              <span>·</span>
              <span>{event.timezone}</span>
            </div>
            {event.organizers.length > 0 && (
              <div className="mt-2 d-flex flex-wrap gap-2 align-items-center"
                   style={{ ...CAPTION, fontSize: '0.82rem' }}>
                <span className="fw-semibold">{td('organizers')}:</span>
                {event.organizers.map((o, i) => (
                  <span key={o.id}>
                    {o.websiteUrl
                      ? <a href={o.websiteUrl} target="_blank" rel="noopener noreferrer"
                           style={{ color: C_PRIMARY, textDecoration: 'none' }}>{o.name}</a>
                      : o.name}
                    {i < event.organizers.length - 1 && ','}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Right CTAs */}
          <div className="d-flex flex-column gap-2 flex-shrink-0" style={{ minWidth: 220 }}>
            <CopyBtn text={publicUrl} label={td('copyPublicUrl')} />
            <CopyBtn text={moderatorUrl} label={td('copyModeratorUrl')} />
            {(status === 'PUBLISHED' || status === 'LIVE') && (
              <Link href={liveModeratorUrl}
                    className="btn btn-primary d-inline-flex align-items-center justify-content-center gap-2"
                    style={{ fontSize: '0.88rem' }}>
                <Svg name="video" size={14} /> {td('enterAsModerator')}
              </Link>
            )}
          </div>
        </div>
      </div>

      {feedback && (
        <div className="mb-3 p-3 rounded d-flex align-items-center gap-2"
             style={{ background: '#e6f4ea', color: '#0c5a2a', border: '1px solid #c2e3cc' }}>
          <Svg name="check" /> {feedback}
        </div>
      )}

      {status === 'LIVE' && (
        <div className="mb-3 p-3 rounded d-flex align-items-center justify-content-between gap-3 flex-wrap"
             style={{ background: '#e8f0fe', color: C_INK, border: `1px solid ${C_PRIMARY}40` }}>
          <div className="d-flex align-items-center gap-2">
            <span style={{ color: C_PRIMARY }}><Svg name="video" /></span>
            <strong>{t('eventIsLive')}</strong>
            {liveCount !== null && (
              <span className="px-2 py-1 rounded-pill"
                    style={{ background: `${C_PRIMARY}18`, color: C_PRIMARY,
                             fontSize: '0.78rem', fontWeight: 600 }}>
                {t('liveParticipants', { count: liveCount, max: event.maxParticipants })}
              </span>
            )}
          </div>
          <Link href={liveModeratorUrl} className="btn btn-primary btn-sm"
                style={{ fontSize: '0.84rem' }}>
            {t('joinAsModeratorBtn')}
          </Link>
        </div>
      )}

      {/* ═══ Body ═══ */}
      <div className="row g-4">
        <div className="col-lg-8">
          <TabNav active={activeTab} onChange={setActiveTab} t={td} />
          <div className="p-4" style={CARD}>
            {activeTab === 'panoramica' && (
              <OverviewTab event={event} description={description} locale={locale} editUrl={editUrl} />
            )}
            {activeTab === 'impostazioni' && <SettingsTab event={event} editUrl={editUrl} />}
            {activeTab === 'persone' && (
              <PeopleTab event={event} baseUrl={baseUrl} locale={locale} onExportCsv={exportCsv} />
            )}
            {activeTab === 'contenuti' && <ContentTab event={event} />}
            {activeTab === 'audit' && <AuditTab event={event} status={status} />}
          </div>
        </div>

        {/* ═══ Sidebar ═══ */}
        <div className="col-lg-4">
          <div style={{ position: 'sticky', top: 20 }}>
            {/* KPI */}
            <div className="p-4 mb-3" style={CARD}>
              <div className="mb-1" style={EYEBROW}>{td('sidebar.registrations')}</div>
              <div className="fw-bold mb-1" style={{ fontSize: '2rem', color: C_INK, lineHeight: 1 }}>
                {event.registrationCount}
              </div>
              {status === 'ENDED' && event.peakParticipants > 0 ? (
                <div style={CAPTION}>
                  {td('sidebar.postEventSummary', {
                    connected: event.peakParticipants,
                    registered: event.registrationCount,
                    estimated: event.maxParticipants,
                  })}
                </div>
              ) : (
                <div style={CAPTION}>
                  {td('sidebar.estimatedAttendance', { estimated: event.maxParticipants })}
                </div>
              )}
              {(jvbCount !== null || jvbRam) && (
                <div className="mt-3 pt-3 d-flex align-items-center gap-2"
                     style={{ borderTop: '1px solid #f0f0f0', ...CAPTION, fontSize: '0.82rem' }}>
                  <Svg name="info" size={14} />
                  <span>
                    {td('sidebar.capacityEstimate', { jvbs: jvbCount ?? 1, ram: jvbRam ?? '—' })}
                  </span>
                </div>
              )}
            </div>

            {/* Reminders */}
            <div className="p-4 mb-3" style={CARD}>
              <div className="mb-2" style={EYEBROW}>{tr('title')}</div>
              {event.reminders.length === 0 ? (
                <div style={CAPTION}>{td('sidebar.noReminders')}</div>
              ) : (
                <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
                  {event.reminders.map((r) => {
                    const sent = r.sentCount > 0;
                    return (
                      <li key={r.id} className="d-flex align-items-center gap-2"
                          style={{ fontSize: '0.85rem', color: C_INK }}>
                        <span aria-hidden="true"
                              style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                       background: sent ? C_SUCCESS : '#CED4DA' }} />
                        <span className="flex-grow-1">{r.label}</span>
                        <span style={{ color: C_MUTED, fontSize: '0.75rem' }}>
                          {sent ? tr('sentStatus', { count: r.sentCount }) : tr('notSent')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Tags recap */}
            {event.tags.length > 0 && (
              <div className="p-4 mb-3" style={CARD}>
                <div className="mb-2" style={EYEBROW}>{td('sidebar.tags')}</div>
                <div className="d-flex flex-wrap gap-2">
                  {event.tags.map((tag) => (
                    <span key={tag.id} style={tagChipStyle(tag.color)}>
                      {getLocalized(tag.name, locale) || tag.slug}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="p-4 mb-3" style={CARD}>
              <div className="d-grid gap-2">
                {status === 'PUBLISHED' && (
                  <button type="button"
                          className="btn btn-success d-flex align-items-center justify-content-center gap-2"
                          onClick={startEvent} disabled={updating}>
                    <Svg name="video" size={14} /> {t('startEvent')}
                  </button>
                )}
                <Link href={editUrl}
                      className="btn btn-primary d-flex align-items-center justify-content-center gap-2">
                  <Svg name="pencil" size={14} /> {td('editEvent')}
                </Link>
                <button type="button"
                        className={status === 'PUBLISHED' ? 'btn btn-outline-warning' : 'btn btn-outline-primary'}
                        onClick={togglePublish}
                        disabled={updating || status === 'LIVE' || status === 'ENDED'}>
                  {status === 'PUBLISHED' ? t('unpublish') : t('publish')}
                </button>
                <a href={publicUrl} target="_blank" rel="noopener noreferrer"
                   className="btn btn-outline-secondary d-flex align-items-center justify-content-center gap-2">
                  <Svg name="external" size={14} /> {t('openPublicPage')}
                </a>
                <DeleteEventModal eventId={event.id} moderatorToken={event.moderatorToken}
                                  onDeleted={handleDeleted} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── TabNav ──
function TabNav({ active, onChange, t }: {
  active: TabId;
  onChange: (tab: TabId) => void;
  t: (key: string) => string;
}) {
  const tabs: { id: TabId; icon: IconName; key: string }[] = [
    { id: 'panoramica', icon: 'info', key: 'tabs.overview' },
    { id: 'impostazioni', icon: 'settings', key: 'tabs.settings' },
    { id: 'persone', icon: 'user-group', key: 'tabs.people' },
    { id: 'contenuti', icon: 'folder', key: 'tabs.content' },
    { id: 'audit', icon: 'shield', key: 'tabs.audit' },
  ];
  return (
    <ul className="nav nav-tabs mb-0" role="tablist" style={{ borderBottom: 'none' }}>
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <li key={tab.id} className="nav-item" role="presentation">
            <button type="button" role="tab" aria-selected={isActive}
                    className="nav-link d-inline-flex align-items-center gap-2"
                    onClick={() => onChange(tab.id)}
                    style={{
                      background: isActive ? '#fff' : 'transparent',
                      color: isActive ? C_PRIMARY : C_MUTED,
                      border: '1px solid #e8e8e8',
                      borderBottom: isActive ? '1px solid #fff' : '1px solid #e8e8e8',
                      borderTopLeftRadius: 6, borderTopRightRadius: 6,
                      marginBottom: -1,
                      fontWeight: isActive ? 600 : 500,
                      fontSize: '0.88rem', padding: '10px 14px',
                    }}>
              <Svg name={tab.icon} size={14} /> {t(tab.key)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── Tabs ──
function OverviewTab({ event, description, locale, editUrl }: {
  event: EventData; description: string; locale: string; editUrl: string;
}) {
  const td = useTranslations('admin.eventDetail');
  const te = useTranslations('events');
  const speakers = getLocalized(event.speakersInfo as LocalizedField, locale);

  const toggles: { label: string; value: boolean }[] = [
    { label: te('manage.toggleChat'), value: event.chatEnabled },
    { label: te('manage.toggleQa'), value: event.qaEnabled },
    { label: te('manage.toggleRecording'), value: event.recordingEnabled },
    { label: td('toggles.unmute'), value: event.participantsCanUnmute },
    { label: td('toggles.video'), value: event.participantsCanStartVideo },
    { label: td('toggles.screenShare'), value: event.participantsCanShareScreen },
  ];

  return (
    <>
      {description && (
        <div className="mb-4">
          <H>{te('detail.description')}</H>
          <MarkdownRenderer content={description} />
        </div>
      )}

      <div className="mb-4">
        <H>{te('manage.settingsSection')}</H>
        <EventConfigDiagram
          event={{
            maxParticipants: event.maxParticipants,
            qaEnabled: event.qaEnabled, chatEnabled: event.chatEnabled,
            recordingEnabled: event.recordingEnabled,
            participantsCanUnmute: event.participantsCanUnmute,
            participantsCanStartVideo: event.participantsCanStartVideo,
            participantsCanShareScreen: event.participantsCanShareScreen,
            speakers: speakers || undefined,
            startsAt: event.startsAt, endsAt: event.endsAt,
          }}
          registrationCount={event.registrationCount} adminMode
        />
      </div>

      <div>
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <H>{td('featureSummary')}</H>
          <Link href={editUrl}
                className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-2">
            <Svg name="pencil" size={12} /> {td('editSettings')}
          </Link>
        </div>
        <div className="d-grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {toggles.map((toggle) => (
            <div key={toggle.label}
                 className="d-flex align-items-center gap-2 px-3 py-2"
                 style={{ background: '#f8f9fa', borderRadius: 6, fontSize: '0.88rem', color: C_INK }}>
              <span style={{ color: toggle.value ? C_SUCCESS : C_DANGER, flexShrink: 0 }}>
                <Svg name={toggle.value ? 'check' : 'x'} size={14} />
              </span>
              <span>{toggle.label}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function SettingsTab({ event, editUrl }: { event: EventData; editUrl: string }) {
  const td = useTranslations('admin.eventDetail');
  const t = useTranslations('admin');

  return (
    <>
      <div className="mb-4">
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <H>{td('privacyGdpr')}</H>
          <Link href={editUrl}
                className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-2">
            <Svg name="pencil" size={12} /> {td('editSettings')}
          </Link>
        </div>
        <dl className="mb-0">
          <KV label={td('fields.dataRetention')}
              value={td('fields.dataRetentionValue', { days: event.dataRetentionDays })} />
          {event.privacyPolicyUrl && (
            <KV label={td('fields.privacyUrl')}
                value={<a href={event.privacyPolicyUrl} target="_blank" rel="noopener noreferrer"
                          style={{ color: C_PRIMARY }}>{event.privacyPolicyUrl}</a>} />
          )}
          {event.moderatorName && (
            <KV label={t('form.moderatorName')}
                value={event.moderatorEmail ? `${event.moderatorName} (${event.moderatorEmail})` : event.moderatorName} />
          )}
          {event.recordingConsentText && (
            <KV label={td('fields.recordingConsent')}
                value={<span style={{ whiteSpace: 'pre-wrap', color: C_INK }}>{event.recordingConsentText}</span>} />
          )}
        </dl>
      </div>

      <div>
        <H>{td('postEventTitle')}</H>
        <PostEventConfig
          event={{
            id: event.id, moderatorToken: event.moderatorToken,
            postEventPublic: event.postEventPublic,
            postEventPublicUntil: event.postEventPublicUntil,
            postEventShowQA: event.postEventShowQA,
            postEventShowMaterials: event.postEventShowMaterials,
            postEventShowPolls: event.postEventShowPolls,
            postEventShowFeedback: event.postEventShowFeedback,
            feedbackEnabled: event.feedbackEnabled,
            dataRetentionDays: event.dataRetentionDays,
          }}
        />
      </div>
    </>
  );
}

function PeopleTab({ event, baseUrl, locale, onExportCsv }: {
  event: EventData; baseUrl: string; locale: string; onExportCsv: () => void;
}) {
  const t = useTranslations('admin');
  const te = useTranslations('events');
  const format = useFormatter();

  // Aggregated org-type histogram for the intro chip row.
  const orgTypeCounts = event.registrations.reduce<Record<string, number>>((acc, r) => {
    if (r.organizationType) acc[r.organizationType] = (acc[r.organizationType] || 0) + 1;
    return acc;
  }, {});
  const orgTypeEntries = Object.entries(orgTypeCounts).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="mb-4">
        <H>{t('coModerators.title')}</H>
        <EventModeratorsPanel eventId={event.id} eventSlug={event.slug}
                              moderatorToken={event.moderatorToken}
                              baseUrl={baseUrl} locale={locale} />
      </div>

      <div>
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <H>
            {t('registrationsSection')}
            <span className="ms-2" style={{ color: C_MUTED, fontWeight: 400, fontSize: '0.88rem' }}>
              ({event.registrationCount})
            </span>
          </H>
          {event.registrations.length > 0 && (
            <button type="button" className="btn btn-outline-primary btn-sm" onClick={onExportCsv}>
              {t('exportCsv')}
            </button>
          )}
        </div>

        {orgTypeEntries.length > 0 && (
          <div className="mb-3 d-flex flex-wrap gap-2">
            {orgTypeEntries.map(([type, count]) => {
              const pct = Math.round((count / event.registrations.length) * 100);
              const label = ORG_TYPE_LABELS[type]?.[locale as 'it' | 'en'] ?? type;
              return (
                <span key={type} className="px-2 py-1 rounded-pill" style={PILL_MUTED}>
                  {label}: {pct}% ({count})
                </span>
              );
            })}
          </div>
        )}

        {event.registrations.length === 0 ? (
          <div className="text-center py-4" style={{ color: C_MUTED, fontSize: '0.9rem' }}>
            {t('noRegistrations')}
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 40 }}>#</th>
                  <th scope="col">{te('detail.participants')}</th>
                  {event.requireOrganization && <th scope="col">{t('organization')}</th>}
                  {event.requireOrganizationType && <th scope="col">{t('organizationType')}</th>}
                  <th scope="col">{t('registrationDate')}</th>
                  <th scope="col">{t('joined')}</th>
                </tr>
              </thead>
              <tbody>
                {event.registrations.map((reg, i) => {
                  const joined = !!reg.joinedAt;
                  const typeLabel = reg.organizationType
                    ? (ORG_TYPE_LABELS[reg.organizationType]?.[locale as 'it' | 'en'] ?? reg.organizationType)
                    : '—';
                  return (
                    <tr key={reg.id}>
                      <td style={{ color: C_MUTED }}>{i + 1}</td>
                      <td className="fw-semibold">{reg.displayName}</td>
                      {event.requireOrganization && (
                        <td style={{ color: C_MUTED }}>{reg.organization ?? '—'}</td>
                      )}
                      {event.requireOrganizationType && (
                        <td style={{ color: C_MUTED }}>{typeLabel}</td>
                      )}
                      <td style={{ color: C_MUTED }}>
                        {format.dateTime(new Date(reg.createdAt), {
                          day: 'numeric', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td>
                        <span className="px-2 py-1 rounded-pill"
                              style={{ fontSize: '0.75rem', fontWeight: 600,
                                       background: joined ? `${C_SUCCESS}22` : '#E9ECEF',
                                       color: joined ? C_SUCCESS : C_MUTED }}>
                          {joined ? t('joined') : t('notJoined')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function ContentTab({ event }: { event: EventData }) {
  const tm = useTranslations('materials');
  const td = useTranslations('admin.eventDetail');
  const format = useFormatter();

  return (
    <>
      <div className="mb-4">
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <H>
            {tm('title')}
            <span className="ms-2" style={{ color: C_MUTED, fontWeight: 400, fontSize: '0.88rem' }}>
              ({event.materials.length})
            </span>
          </H>
          <Link href={`/admin/events/${event.id}/materials`}
                className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-2">
            <Svg name="pencil" size={12} /> {td('manageMaterials')}
          </Link>
        </div>
        {event.materials.length === 0 ? (
          <div className="text-center py-3" style={{ color: C_MUTED, fontSize: '0.9rem' }}>
            {tm('noMaterials')}
          </div>
        ) : (
          <div className="d-flex flex-column gap-2">
            {event.materials.map((m) => (
              <div key={m.id} className="d-flex justify-content-between align-items-start p-3"
                   style={{ border: '1px solid #e8e8e8', borderRadius: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <a href={m.url} target="_blank" rel="noopener noreferrer"
                     className="fw-semibold text-decoration-none d-inline-flex align-items-center gap-1"
                     style={{ color: C_PRIMARY }}>
                    <Svg name="external" size={12} /> {m.title}
                  </a>
                  {m.description && (
                    <div style={CAPTION}>{m.description}</div>
                  )}
                  <div style={{ ...CAPTION, fontSize: '0.78rem' }}>
                    {tm('addedBy', { name: m.addedBy })} ·{' '}
                    {format.dateTime(new Date(m.createdAt), {
                      day: 'numeric', month: 'short',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
          <H>{td('questionnaires')}</H>
          <Link href={`/admin/events/${event.id}/questionnaires`}
                className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-2">
            <Svg name="pencil" size={12} /> {td('manageQuestionnaires')}
          </Link>
        </div>
        <div style={{ fontSize: '0.88rem', color: C_MUTED }}>
          {td('questionnaireCount', { count: event.questionnaireCount })}
        </div>
      </div>
    </>
  );
}

function AuditTab({ event, status }: { event: EventData; status: string }) {
  const td = useTranslations('admin.eventDetail');
  const t = useTranslations('admin');
  const format = useFormatter();

  // Small helper for the action-badge color mapping.
  const actionColor = (action: string) => {
    if (action === 'DATA_DELETED') return { bg: '#FFF3CD', fg: '#856404' };
    if (action === 'DATA_EXPORTED') return { bg: '#D1ECF1', fg: '#0C5460' };
    return { bg: '#D4EDDA', fg: '#155724' };
  };

  return (
    <>
      <div className="mb-4">
        <H>{td('recordingSection')}</H>
        <RecordingManagement
          event={{
            id: event.id, slug: event.slug, status,
            recordingEnabled: event.recordingEnabled,
            recordingUrl: event.recordingUrl,
            tempRecordingUrl: event.tempRecordingUrl,
            tempRecordingStartedAt: event.tempRecordingStartedAt,
            recordingPublished: event.recordingPublished,
            recordingPublishedAt: event.recordingPublishedAt,
            recordingFileSize: event.recordingFileSize,
            recordingDuration: event.recordingDuration,
            recordingDeleteAfterDays: event.recordingDeleteAfterDays,
            moderatorToken: event.moderatorToken,
          }}
        />
      </div>

      <div className="mb-4">
        <H>{td('callSessions')}</H>
        <CallSessionsPanel eventId={event.id} eventSlug={event.slug}
                           moderatorToken={event.moderatorToken} />
      </div>

      {event.gdprAuditLogs.length > 0 && (
        <div>
          <H>{t('gdprAuditLog.title')}</H>
          <div style={{ ...CAPTION, marginBottom: 8 }}>{t('gdprAuditLog.subtitle')}</div>
          <div className="table-responsive">
            <table className="table table-hover align-middle" style={{ fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th>{t('gdprAuditLog.date')}</th>
                  <th>{t('gdprAuditLog.action')}</th>
                  <th>{t('gdprAuditLog.recordCount')}</th>
                  <th>{t('gdprAuditLog.details')}</th>
                </tr>
              </thead>
              <tbody>
                {event.gdprAuditLogs.map((log) => {
                  const c = actionColor(log.action);
                  return (
                    <tr key={log.id}>
                      <td>{format.dateTime(new Date(log.createdAt), { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>
                        <span className="px-2 py-1 rounded-pill"
                              style={{ fontSize: '0.72rem', fontWeight: 600,
                                       background: c.bg, color: c.fg }}>
                          {t(`gdprAuditLog.actions.${log.action}`)}
                        </span>
                      </td>
                      <td>{log.recordCount}</td>
                      <td style={{ maxWidth: 200 }} className="text-truncate">
                        {log.details ? JSON.stringify(JSON.parse(log.details)) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ── Reusable bits ──
function H({ children }: { children: ReactNode }) {
  return (
    <h2 className="fw-semibold mb-3" style={{ color: C_INK, fontSize: '1rem' }}>
      {children}
    </h2>
  );
}

function KV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="py-3" style={{ borderBottom: '1px solid #f0f0f0' }}>
      <dt className="mb-1" style={EYEBROW}>{label}</dt>
      <dd className="mb-0" style={{ color: C_INK, fontSize: '0.9rem' }}>{value}</dd>
    </div>
  );
}

// Minimal copy-to-clipboard button with a caller-supplied label.
// We don't reuse the shared <CopyButton> because it hardcodes its
// own label from `admin.links` — the hero needs two buttons side by
// side with distinct labels ("public URL" vs "moderator URL").
function CopyBtn({ text, label }: { text: string; label: string }) {
  const tl = useTranslations('admin.links');
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button type="button" onClick={handleCopy}
            aria-label={label}
            className="btn btn-outline-primary btn-sm d-inline-flex align-items-center justify-content-center gap-2"
            style={{ fontSize: '0.85rem' }}>
      <Svg name={copied ? 'check' : 'link'} size={14} />
      {copied ? tl('copied') : label}
    </button>
  );
}

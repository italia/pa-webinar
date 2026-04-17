'use client';

import { useTranslations } from 'next-intl';
import { calculateEstimates, type EventEstimates } from '@/lib/estimates';

interface EventConfigDiagramProps {
  event: {
    maxParticipants: number;
    qaEnabled: boolean;
    chatEnabled: boolean;
    recordingEnabled: boolean;
    participantsCanUnmute: boolean;
    participantsCanStartVideo: boolean;
    participantsCanShareScreen: boolean;
    speakers?: string | null;
    startsAt?: string;
    endsAt?: string;
  };
  registrationCount?: number;
  adminMode?: boolean;
}

function FeatureChip({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  return (
    <span className={`feature-chip ${active ? 'feature-chip--on' : 'feature-chip--off'}`}>
      <span className="feature-chip__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-cell">
      <div className="metric-cell__label">{label}</div>
      <div className="metric-cell__value">{value}</div>
    </div>
  );
}

export default function EventConfigDiagram({
  event,
  registrationCount,
  adminMode = true,
}: EventConfigDiagramProps) {
  const t = useTranslations('diagram');

  // Size estimates on the *current* registrations when we have them, so
  // moderators see the actual demand. Falls back to maxParticipants
  // when the event hasn't attracted registrations yet.
  const estimates: EventEstimates = calculateEstimates({
    maxParticipants: event.maxParticipants,
    registeredParticipants: registrationCount,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    recordingEnabled: event.recordingEnabled,
    participantsCanUnmute: event.participantsCanUnmute,
    participantsCanStartVideo: event.participantsCanStartVideo,
    participantsCanShareScreen: event.participantsCanShareScreen,
  });

  const speakerCount = event.speakers
    ? event.speakers.split(',').filter(Boolean).length
    : 0;
  const shownParticipants = registrationCount ?? event.maxParticipants;
  const occupancy = Math.min(100, (shownParticipants / event.maxParticipants) * 100);

  return (
    <div className="event-config-diagram">
      {/* ── Minimal topology ─────────────────────────────────────────── */}
      <svg
        viewBox="0 0 600 120"
        className="w-100"
        role="img"
        aria-label={t('topology')}
        style={{ maxHeight: 140 }}
      >
        {/* Moderator */}
        <g transform="translate(70, 60)">
          <circle r="26" fill="#E8F0FE" stroke="#0066CC" strokeWidth="1.5" />
          <text textAnchor="middle" y="5" fontSize="13">🎙️</text>
          <text textAnchor="middle" y="46" fontSize="10" fontWeight="600" fill="#17324D">
            {t('moderator')}{speakerCount > 0 ? ` +${speakerCount}` : ''}
          </text>
        </g>

        {/* Mod → JVB */}
        <line x1="96" y1="60" x2="274" y2="60" stroke="#0066CC" strokeWidth="1.5" strokeDasharray="5,4" />
        <text x="185" y="54" textAnchor="middle" fontSize="9" fill="#5A768A">
          {estimates.moderatorBandwidth}
        </text>

        {/* JVB */}
        <g transform="translate(300, 60)">
          <rect x="-32" y="-24" width="64" height="48" rx="8" fill="#E6F4EA" stroke="#008758" strokeWidth="1.5" />
          <text textAnchor="middle" y="2" fontSize="11" fontWeight="700" fill="#008758">JVB</text>
          <text textAnchor="middle" y="14" fontSize="9" fill="#5A768A">×{estimates.jvbCount}</text>
          <text textAnchor="middle" y="46" fontSize="10" fontWeight="600" fill="#17324D">
            {t('bridge')}
          </text>
        </g>

        {/* JVB → participants */}
        <line x1="332" y1="60" x2="504" y2="60" stroke="#0066CC" strokeWidth="1.5" strokeDasharray="5,4" />
        <text x="418" y="54" textAnchor="middle" fontSize="9" fill="#5A768A">
          {estimates.participantBandwidth}
        </text>

        {/* Participants */}
        <g transform="translate(530, 60)">
          <circle r="26" fill="#E8F0FE" stroke="#0066CC" strokeWidth="1.5" />
          <text textAnchor="middle" y="2" fontSize="13" fontWeight="700" fill="#17324D">
            {shownParticipants}
          </text>
          <text textAnchor="middle" y="14" fontSize="8" fill="#5A768A">
            /{event.maxParticipants}
          </text>
          <text textAnchor="middle" y="46" fontSize="10" fontWeight="600" fill="#17324D">
            {t('participants')}
          </text>
        </g>

        {/* Recording branch */}
        {event.recordingEnabled && (
          <g transform="translate(300, 110)">
            <line x1="0" y1="-26" x2="0" y2="-10" stroke="#d9534f" strokeWidth="1.5" strokeDasharray="3,3" />
            <rect x="-38" y="-10" width="76" height="20" rx="10" fill="#FDEBEA" stroke="#d9534f" strokeWidth="1.5" />
            <text textAnchor="middle" y="4" fontSize="10" fontWeight="600" fill="#d9534f">
              📹 {t('jibri')}
            </text>
          </g>
        )}
      </svg>

      {/* ── Feature chips ─────────────────────────────────────────── */}
      <div className="diagram-chips mt-3">
        <FeatureChip active={event.qaEnabled} label="Q&A" />
        <FeatureChip active={event.chatEnabled} label="Chat" />
        <FeatureChip active={event.recordingEnabled} label={t('jibri')} />
        <FeatureChip active={event.participantsCanUnmute} label={t('chips.mic')} />
        <FeatureChip active={event.participantsCanStartVideo} label={t('chips.video')} />
        <FeatureChip active={event.participantsCanShareScreen} label={t('chips.screen')} />
      </div>

      {/* ── Occupancy + estimates (admin only) ───────────────────── */}
      {adminMode && (
        <div className="diagram-metrics mt-3">
          <div className="diagram-metrics__header">
            <span className="diagram-metrics__title">{t('estimates')}</span>
            <span className="diagram-metrics__basis">
              {estimates.basedOnRegistrations
                ? t('sizedForRegistrations', { count: estimates.sizedFor })
                : t('sizedForCapacity', { count: estimates.sizedFor })}
            </span>
          </div>
          <div className="diagram-metrics__bar" aria-label={t('occupancy')}>
            <div
              className="diagram-metrics__bar-fill"
              style={{ width: `${occupancy}%` }}
            />
          </div>
          <div className="diagram-metrics__grid">
            <MetricCell label={t('bandwidth.moderator')} value={estimates.moderatorBandwidth} />
            <MetricCell label={t('bandwidth.participant')} value={estimates.participantBandwidth} />
            <MetricCell label={t('bandwidth.total')} value={estimates.totalBandwidth} />
            <MetricCell label={t('jvbCount')} value={`${estimates.jvbCount}× JVB · ${estimates.jvbRam}`} />
            {event.recordingEnabled && (
              <>
                <MetricCell label={t('duration')} value={estimates.estimatedDuration} />
                <MetricCell label={t('storage')} value={estimates.storageEstimate} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

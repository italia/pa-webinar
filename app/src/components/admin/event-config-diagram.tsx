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

function FeatureBadge({
  active,
  label,
  icon,
}: {
  active: boolean;
  label: string;
  icon: string;
}) {
  return (
    <span className={`feature-badge ${active ? 'feature-badge--active' : 'feature-badge--inactive'}`}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

function EstimateCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: string;
  color: 'primary' | 'info' | 'warning' | 'success';
}) {
  return (
    <div className="col-6 col-md-3">
      <div className={`estimate-card estimate-card--${color}`}>
        <div className="text-muted" style={{ fontSize: '0.78rem' }}>
          <span aria-hidden="true" className="me-1">{icon}</span>
          {label}
        </div>
        <div className="fw-semibold mt-1" style={{ fontSize: '0.95rem', color: '#17324D' }}>
          {value}
        </div>
      </div>
    </div>
  );
}

export default function EventConfigDiagram({
  event,
  registrationCount,
  adminMode = true,
}: EventConfigDiagramProps) {
  const t = useTranslations('diagram');

  const estimates: EventEstimates = calculateEstimates({
    maxParticipants: event.maxParticipants,
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

  const participantLabel =
    event.participantsCanStartVideo
      ? '🎤🎥'
      : event.participantsCanUnmute
        ? '🎤'
        : t('viewOnly');

  return (
    <div className="event-config-diagram">
      {/* Topology SVG */}
      <div className="diagram-topology">
        <svg viewBox="0 0 800 300" className="w-100" role="img" aria-label={t('topology')}>
          {/* Moderator node */}
          <g transform="translate(100, 130)">
            <rect
              x="-70" y="-45" width="140" height="90" rx="10"
              fill="#0066CC" fillOpacity="0.08" stroke="#0066CC" strokeWidth="1.5"
            />
            <text textAnchor="middle" y="-18" fontSize="13" fontWeight="600" fill="#17324D">
              {t('moderator')}
            </text>
            <text textAnchor="middle" y="5" fontSize="18">
              🎤🎥📺
            </text>
            {speakerCount > 0 && (
              <text textAnchor="middle" y="28" fontSize="10" fill="#5A768A">
                + {speakerCount} relatori
              </text>
            )}
          </g>

          {/* Connection: moderator → JVB */}
          <line x1="170" y1="130" x2="330" y2="130" stroke="#0066CC" strokeWidth="1.5" strokeDasharray="6,4" />
          <text x="250" y="118" textAnchor="middle" fontSize="10" fill="#5A768A">
            {estimates.moderatorBandwidth}
          </text>
          <polygon points="325,125 335,130 325,135" fill="#0066CC" />

          {/* JVB node */}
          <g transform="translate(400, 130)">
            <rect
              x="-55" y="-45" width="110" height="90" rx="10"
              fill="#008758" fillOpacity="0.08" stroke="#008758" strokeWidth="1.5"
            />
            <text textAnchor="middle" y="-18" fontSize="13" fontWeight="600" fill="#17324D">
              🖥️ JVB
            </text>
            <text textAnchor="middle" y="5" fontSize="11" fill="#17324D">
              {estimates.jvbCount} server
            </text>
            <text textAnchor="middle" y="22" fontSize="10" fill="#5A768A">
              ~{estimates.jvbRam} RAM
            </text>
          </g>

          {/* Connection: JVB → participants */}
          <line x1="455" y1="130" x2="620" y2="130" stroke="#0066CC" strokeWidth="1.5" strokeDasharray="6,4" />
          <text x="538" y="118" textAnchor="middle" fontSize="10" fill="#5A768A">
            {estimates.participantBandwidth}
          </text>
          <polygon points="615,125 625,130 615,135" fill="#0066CC" />

          {/* Participants node */}
          <g transform="translate(700, 130)">
            <rect
              x="-65" y="-45" width="130" height="90" rx="10"
              fill="#0066CC" fillOpacity="0.08" stroke="#0066CC" strokeWidth="1.5"
            />
            <text textAnchor="middle" y="-18" fontSize="16" fontWeight="700" fill="#17324D">
              {registrationCount ?? event.maxParticipants}
            </text>
            <text textAnchor="middle" y="2" fontSize="12" fill="#17324D">
              {t('participants')}
            </text>
            <text textAnchor="middle" y="22" fontSize="10" fill="#5A768A">
              {participantLabel}
            </text>
          </g>

          {/* Jibri node (recording) */}
          {event.recordingEnabled && (
            <g transform="translate(400, 255)">
              <line x1="0" y1="-70" x2="0" y2="-15" stroke="#d9534f" strokeWidth="1.5" strokeDasharray="4,3" />
              <rect
                x="-50" y="-15" width="100" height="45" rx="8"
                fill="#d9534f" fillOpacity="0.08" stroke="#d9534f" strokeWidth="1.5"
              />
              <text textAnchor="middle" y="5" fontSize="11" fontWeight="500" fill="#17324D">
                📹 Jibri
              </text>
              <text textAnchor="middle" y="20" fontSize="9" fill="#5A768A">
                {t('jibri')}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Features grid */}
      <div className="diagram-features mt-3">
        <h6 className="fw-semibold mb-2" style={{ color: '#17324D' }}>
          {t('features')}
        </h6>
        <div className="d-flex flex-wrap gap-2">
          <FeatureBadge active={event.qaEnabled} label="Q&A" icon="❓" />
          <FeatureBadge active={event.chatEnabled} label="Chat" icon="💬" />
          <FeatureBadge active={event.participantsCanShareScreen} label="Screen share" icon="📺" />
          <FeatureBadge active={event.recordingEnabled} label={t('jibri')} icon="📹" />
          <FeatureBadge active={event.participantsCanUnmute} label="Microfono" icon="🎤" />
          <FeatureBadge active={event.participantsCanStartVideo} label="Webcam" icon="🎥" />
        </div>
      </div>

      {/* Resource estimates (admin only) */}
      {adminMode && (
        <div className="diagram-estimates mt-3">
          <h6 className="fw-semibold mb-2" style={{ color: '#17324D' }}>
            {t('estimates')}
          </h6>
          <div className="row g-2">
            <EstimateCard
              label={t('bandwidth.moderator')}
              value={estimates.moderatorBandwidth}
              icon="↑"
              color="primary"
            />
            <EstimateCard
              label={t('bandwidth.participant')}
              value={estimates.participantBandwidth}
              icon="↓"
              color="info"
            />
            <EstimateCard
              label={t('bandwidth.total')}
              value={estimates.totalBandwidth}
              icon="⇅"
              color="warning"
            />
            <EstimateCard
              label={t('jvbCount')}
              value={`${estimates.jvbCount} server`}
              icon="🖥️"
              color="success"
            />
          </div>
          {event.recordingEnabled && (
            <div className="row g-2 mt-0">
              <EstimateCard
                label={t('storage')}
                value={estimates.storageEstimate}
                icon="💾"
                color="info"
              />
              <EstimateCard
                label={t('duration')}
                value={estimates.estimatedDuration}
                icon="⏱️"
                color="primary"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

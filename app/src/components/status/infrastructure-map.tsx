'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Collapse } from 'design-react-kit';

import type { InfraMapData } from '@/app/api/status/infrastructure/route';

const POLL_MS = 15_000;

const STATUS_COLORS: Record<string, string> = {
  healthy: '#008758',
  degraded: '#A66300',
  down: '#CC334D',
  standby: '#5A768A',
  scaling: '#0066CC',
};

const STATUS_BG: Record<string, string> = {
  healthy: '#e8f5e9',
  degraded: '#fff3e0',
  down: '#fce4ec',
  standby: '#eceff1',
  scaling: '#e3f2fd',
};

const SERVICE_ICONS: Record<string, string> = {
  app: 'M4 4h16v12H4V4zm2 2v8h12V6H6zm1 10h10v2H7v-2z',
  database: 'M12 2C7.58 2 4 3.34 4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5c0-1.66-3.58-3-8-3zm6 16c0 .88-2.13 2-6 2s-6-1.12-6-2v-2.74C7.53 16.02 9.6 16.5 12 16.5s4.47-.48 6-1.24V18zM6 12.26C7.53 13.02 9.6 13.5 12 13.5s4.47-.48 6-1.24V15c0 .88-2.13 2-6 2s-6-1.12-6-2v-2.74zM6 7.26C7.53 8.02 9.6 8.5 12 8.5s4.47-.48 6-1.24V10c0 .88-2.13 2-6 2s-6-1.12-6-2V7.26zM12 6c3.87 0 6-1.12 6-1s-2.13-1-6-1-6 .12-6 1 2.13 1 6 1z',
  'jitsi-web': 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z',
  prosody: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z',
  jicofo: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2V7zm0 8h2v2h-2v-2z',
  jvb: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4zM14 17H5V7h9v10z',
  jibri: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z',
  smtp: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z',
  storage: 'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z',
  globe: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  server: 'M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zm0-10H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1z',
};

interface Pos { x: number; y: number }

const NODE_W = 160;
const NODE_H = 80;

const LAYOUT: Record<string, Pos> = {
  app:         { x: 200, y: 185 },
  'jitsi-web': { x: 500, y: 185 },
  database:    { x: 120, y: 310 },
  prosody:     { x: 370, y: 310 },
  jicofo:      { x: 570, y: 310 },
  jvb:         { x: 830, y: 290 },
  smtp:        { x: 120, y: 430 },
  jibri:       { x: 680, y: 430 },
};

const FIXED_POS: Record<string, Pos> = {
  'endpoint-app':   { x: 200, y: 55 },
  'endpoint-jitsi': { x: 500, y: 55 },
  'endpoint-media': { x: 830, y: 55 },
  storage:          { x: 960, y: 430 },
};

const ENDPOINT_ID_MAP: Record<string, string> = {
  app: 'endpoint-app',
  'jitsi-web': 'endpoint-jitsi',
  jvb: 'endpoint-media',
};

const ENDPOINT_LABEL_KEY: Record<string, string> = {
  app: 'endpointApp',
  'jitsi-web': 'endpointJitsi',
  jvb: 'endpointMedia',
};

type ConnDef = { from: string; to: string; labelKey: string; dashed?: boolean };

const CONNECTIONS: ConnDef[] = [
  { from: 'endpoint-app', to: 'app', labelKey: 'connData' },
  { from: 'endpoint-jitsi', to: 'jitsi-web', labelKey: 'connData' },
  { from: 'app', to: 'database', labelKey: 'connData' },
  { from: 'app', to: 'smtp', labelKey: 'connNotifications', dashed: true },
  { from: 'jitsi-web', to: 'prosody', labelKey: 'connSignaling' },
  { from: 'prosody', to: 'jicofo', labelKey: 'connSignaling' },
  { from: 'prosody', to: 'jvb', labelKey: 'connSignaling' },
  { from: 'prosody', to: 'jibri', labelKey: 'connRecording', dashed: true },
  { from: 'jicofo', to: 'jvb', labelKey: 'connMedia' },
  { from: 'endpoint-media', to: 'jvb', labelKey: 'connMedia' },
  { from: 'jibri', to: 'storage', labelKey: 'connUpload', dashed: true },
];

function pos(id: string): Pos {
  return FIXED_POS[id] ?? LAYOUT[id] ?? { x: 500, y: 300 };
}

function formatMbps(mbps: number | null): string {
  if (mbps === null) return '—';
  if (mbps < 1) return `${(mbps * 1024).toFixed(0)} Kbps`;
  return `${mbps.toFixed(1)} Mbps`;
}

function resolveI18nKey(t: ReturnType<typeof useTranslations<'infraMap'>>, key: string): string {
  const prefix = 'infraMap.';
  const lookupKey = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  try {
    return t(lookupKey as Parameters<typeof t>[0]);
  } catch {
    return key;
  }
}

function SvgIcon({ path, x, y, size, fill, opacity = 1 }: {
  path: string; x: number; y: number; size: number; fill: string; opacity?: number;
}) {
  const scale = size / 24;
  return (
    <path
      d={path}
      fill={fill}
      opacity={opacity}
      transform={`translate(${x}, ${y}) scale(${scale})`}
    />
  );
}

export default function InfrastructureMap() {
  const t = useTranslations('infraMap');
  const [data, setData] = useState<InfraMapData | null>(null);
  const [error, setError] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const animSeedRef = useRef<Record<string, number>>({});

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/status/infrastructure', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const getAnimDur = useCallback((key: string) => {
    if (!animSeedRef.current[key]) {
      animSeedRef.current[key] = 1.8 + Math.random() * 1.4;
    }
    return animSeedRef.current[key];
  }, []);

  const selectedSvc = useMemo(
    () => data?.services.find((s) => s.id === selected) ?? null,
    [data, selected],
  );

  const W = 1100;
  const H = 530;

  if (!data && !error) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">{t('loading')}</span>
        </div>
      </div>
    );
  }

  const isHighlighted = (id: string) =>
    hovered === id || selected === id;

  const connActive = (from: string, to: string) => {
    if (!data) return false;
    const fromSvc = data.services.find((s) => s.id === from);
    const toSvc = data.services.find((s) => s.id === to);
    const okStatus = (s?: string) => s === 'healthy' || s === 'scaling';
    return (
      (okStatus(fromSvc?.status) || from.startsWith('endpoint')) &&
      (okStatus(toSvc?.status) || to === 'storage')
    );
  };

  const issueServices = data?.services.filter(s =>
    s.status === 'down' || s.status === 'degraded',
  ) ?? [];

  const poolLabelKey = (name: string): string => {
    const map: Record<string, string> = {
      system: 'poolSystem',
      jvb: 'poolJvb',
      main: 'poolMain',
      local: 'poolLocal',
    };
    return map[name] ?? name;
  };

  return (
    <div className="infra-map">
      {/* Overall status banner */}
      {data && (
        <OverallBanner verdict={data.overallVerdict} t={t} />
      )}

      {/* Stats bar */}
      {data && (
        <div className="infra-map__stats-bar">
          <StatPill label={t('participants')} value={String(data.traffic.totalParticipants)} color={data.traffic.totalParticipants > 0 ? '#008758' : '#5A768A'} iconPath={SERVICE_ICONS.globe ?? ''} />
          <StatPill label={t('conferences')} value={String(data.traffic.activeConferences)} color={data.traffic.activeConferences > 0 ? '#0066CC' : '#5A768A'} iconPath={SERVICE_ICONS.jvb ?? ''} />
          <StatPill label={t('bandwidthIn')} value={formatMbps(data.traffic.bandwidthInMbps)} color="#0066CC" iconPath="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
          <StatPill label={t('bandwidthOut')} value={formatMbps(data.traffic.bandwidthOutMbps)} color="#0066CC" iconPath="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z" />
          <StatPill label={t('recordings')} value={String(data.storage.recordings.count)} color={data.storage.configured ? '#008758' : '#5A768A'} iconPath={SERVICE_ICONS.jibri ?? ''} />
          <StatPill label={t('registrationsToday')} value={String(data.events.registrationsToday)} color="#0066CC" iconPath="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z" />
        </div>
      )}

      {/* SVG Canvas */}
      <div className="infra-map__canvas" onClick={() => setSelected(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="infra-map__svg" role="img" aria-label={t('ariaLabel')}>
          <defs>
            <filter id="infraShadow">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.07" />
            </filter>
            <marker id="infraArrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#B0BEC5" />
            </marker>
            <marker id="infraArrowHi" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#0066CC" />
            </marker>
          </defs>

          {/* Zone: Public endpoints (top) */}
          <rect x="10" y="10" width={W - 20} height="90" rx="12" fill="#E3F2FD" opacity="0.3" />
          <text x="55" y="28" className="infra-map__zone-label">{t('zonePublic')}</text>

          {/* Zone: Platform services (main body) */}
          <rect x="10" y="115" width={W - 20} height="370" rx="12" fill="#F8FAFE" opacity="0.3" />
          <text x="55" y="138" className="infra-map__zone-label">{t('zoneCluster')}</text>

          {/* Connection lines */}
          {data && CONNECTIONS.map((c) => {
            const f = pos(c.from);
            const t2 = pos(c.to);
            const active = connActive(c.from, c.to);
            const hi = isHighlighted(c.from) || isHighlighted(c.to);
            const hasTraffic = active && data.traffic.totalParticipants > 0 && !c.dashed;
            const key = `${c.from}-${c.to}`;

            return (
              <g key={key}>
                <line
                  x1={f.x} y1={f.y} x2={t2.x} y2={t2.y}
                  stroke={hi ? '#0066CC' : '#CFD8DC'}
                  strokeWidth={hi ? 2 : 1.2}
                  strokeDasharray={c.dashed ? '6 4' : undefined}
                  opacity={active ? (hi ? 1 : 0.7) : 0.2}
                  markerEnd={hi ? 'url(#infraArrowHi)' : 'url(#infraArrow)'}
                />

                {hasTraffic && (
                  <>
                    <circle r="3" fill={c.labelKey === 'connMedia' ? '#008758' : '#0066CC'} opacity="0.8">
                      <animateMotion
                        dur={`${getAnimDur(key)}s`}
                        repeatCount="indefinite"
                        path={`M${f.x},${f.y} L${t2.x},${t2.y}`}
                      />
                    </circle>
                    <circle r="2" fill={c.labelKey === 'connMedia' ? '#008758' : '#0066CC'} opacity="0.5">
                      <animateMotion
                        dur={`${getAnimDur(key) + 0.7}s`}
                        repeatCount="indefinite"
                        path={`M${f.x},${f.y} L${t2.x},${t2.y}`}
                        begin={`${getAnimDur(key) * 0.4}s`}
                      />
                    </circle>
                  </>
                )}

                {hi && (
                  <>
                    {(() => {
                      const label = t(c.labelKey as Parameters<typeof t>[0]);
                      return (
                        <>
                          <rect
                            x={(f.x + t2.x) / 2 - label.length * 3.2}
                            y={(f.y + t2.y) / 2 - 18}
                            width={label.length * 6.4}
                            height="14"
                            rx="3"
                            fill="#fff"
                            opacity="0.9"
                          />
                          <text
                            x={(f.x + t2.x) / 2}
                            y={(f.y + t2.y) / 2 - 8}
                            textAnchor="middle"
                            className="infra-map__conn-label"
                          >
                            {label}
                          </text>
                        </>
                      );
                    })()}
                  </>
                )}
              </g>
            );
          })}

          {/* All public endpoints at top */}
          {data?.endpoints.map((ep) => {
            const epId = ENDPOINT_ID_MAP[ep.service];
            if (!epId) return null;
            const p = FIXED_POS[epId];
            if (!p) return null;
            const hi = isHighlighted(epId);
            const isMedia = ep.service === 'jvb';
            const pillFill = isMedia ? '#E8F5E9' : '#E3F2FD';
            const pillStroke = isMedia ? (hi ? '#008758' : '#A5D6A7') : (hi ? '#0066CC' : '#90CAF9');
            const iconColor = isMedia ? '#008758' : '#0066CC';
            const label = t(ENDPOINT_LABEL_KEY[ep.service] as Parameters<typeof t>[0]);

            return (
              <g
                key={`ep-${ep.service}-${ep.port}`}
                onMouseEnter={() => setHovered(epId)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'default' }}
              >
                <rect x={p.x - 55} y={p.y - 20} width="110" height="40" rx="20" fill={pillFill} stroke={pillStroke} strokeWidth={hi ? 2 : 1} />
                <SvgIcon path={SERVICE_ICONS.globe!} x={p.x - 42} y={p.y - 10} size={20} fill={iconColor} />
                <text x={p.x + 8} y={p.y + 4} textAnchor="middle" className="infra-map__endpoint-name">
                  {label}
                </text>
                <text x={p.x} y={p.y + 34} textAnchor="middle" className="infra-map__endpoint-label">
                  {ep.host ? ep.host.replace(/\.innovazione\.gov\.it$/, '') : ep.protocol}
                </text>
              </g>
            );
          })}

          {/* Storage node */}
          {data && (() => {
            const sp = FIXED_POS.storage!;
            return (
              <g>
                <rect x={sp.x - 55} y={sp.y - 30} width="110" height="60" rx="10" fill="#F3E5F5" stroke="#9C27B0" strokeWidth="1.2" filter="url(#infraShadow)" />
                <SvgIcon path={SERVICE_ICONS.storage!} x={sp.x - 10} y={sp.y - 18} size={18} fill="#7B1FA2" />
                <text x={sp.x} y={sp.y + 6} textAnchor="middle" className="infra-map__node-label-sm">
                  {t('zoneStorage')}
                </text>
                <text x={sp.x} y={sp.y + 20} textAnchor="middle" className="infra-map__node-sublabel">
                  {data.storage.recordings.count} rec · {data.storage.type === 'not-configured' ? 'N/A' : data.storage.type}
                </text>
              </g>
            );
          })()}

          {/* Service nodes */}
          {data?.services.map((svc) => {
            const p = LAYOUT[svc.id];
            if (!p) return null;
            const hi = isHighlighted(svc.id);
            const sc = STATUS_COLORS[svc.status] ?? '#5A768A';
            const bg = hi ? (STATUS_BG[svc.status] ?? '#eceff1') : '#fff';
            const iconPath = SERVICE_ICONS[svc.id] ?? SERVICE_ICONS.app ?? '';
            const halfW = NODE_W / 2;
            const halfH = NODE_H / 2;
            const svcName = resolveI18nKey(t, svc.name);
            const svcDesc = resolveI18nKey(t, svc.description);

            return (
              <g
                key={svc.id}
                onMouseEnter={() => setHovered(svc.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => { e.stopPropagation(); setSelected(svc.id === selected ? null : svc.id); }}
                style={{ cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                aria-label={`${svcName}: ${t(`statuses.${svc.status}` as Parameters<typeof t>[0])}`}
              >
                {svc.status === 'healthy' && data.traffic.totalParticipants > 0 && (
                  <circle cx={p.x} cy={p.y} r="50" fill="none" stroke={sc} strokeWidth="1.5" opacity="0">
                    <animate attributeName="r" values="42;58;42" dur="2.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.5;0;0.5" dur="2.5s" repeatCount="indefinite" />
                  </circle>
                )}

                {svc.status === 'scaling' && (
                  <circle cx={p.x} cy={p.y} r="50" fill="none" stroke="#0066CC" strokeWidth="2" strokeDasharray="8 5" opacity="0.6">
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from={`0 ${p.x} ${p.y}`}
                      to={`360 ${p.x} ${p.y}`}
                      dur="6s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}

                <rect
                  x={p.x - halfW} y={p.y - halfH}
                  width={NODE_W} height={NODE_H}
                  rx="14"
                  fill={bg}
                  stroke={sc}
                  strokeWidth={hi ? 2.5 : 1.2}
                  filter="url(#infraShadow)"
                />

                <circle cx={p.x - halfW + 16} cy={p.y - halfH + 16} r="5" fill={sc}>
                  {svc.status === 'healthy' && data.traffic.totalParticipants > 0 && (
                    <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
                  )}
                </circle>

                <SvgIcon path={iconPath} x={p.x - halfW + 8} y={p.y - 6} size={16} fill={sc} opacity={0.6} />

                <text x={p.x - halfW + 30} y={p.y - 8} className="infra-map__node-label">
                  {svcName}
                </text>

                {hi && (
                  <text x={p.x - halfW + 30} y={p.y + 6} className="infra-map__node-sublabel" style={{ fontSize: '8px' }}>
                    {svcDesc.length > 40 ? svcDesc.substring(0, 39) + '…' : svcDesc}
                  </text>
                )}
                {!hi && (
                  <text x={p.x - halfW + 30} y={p.y + 6} className="infra-map__node-sublabel">
                    {t(`statuses.${svc.status}` as Parameters<typeof t>[0])}
                  </text>
                )}

                {Array.from({ length: Math.min(svc.replicas.max, 10) }).map((_, i) => {
                  const bx = p.x - halfW + 10 + i * 14;
                  const by = p.y + halfH - 12;
                  const isRunning = i < svc.replicas.running;
                  const isDesired = i < svc.replicas.desired;
                  const barFill = isRunning ? sc : isDesired ? '#FFB74D' : '#E0E0E0';

                  return (
                    <rect
                      key={i}
                      x={bx} y={by}
                      width="10" height="4" rx="2"
                      fill={barFill}
                      opacity={isRunning ? 1 : 0.5}
                    >
                      {isDesired && !isRunning && (
                        <animate attributeName="opacity" values="0.3;0.8;0.3" dur="1.5s" repeatCount="indefinite" />
                      )}
                    </rect>
                  );
                })}
              </g>
            );
          })}

          {/* Node pools (bottom) */}
          {data?.nodePools.map((pool, i) => {
            const px = 250 + i * 280;
            const py = H - 28;
            const pc = pool.status === 'active' ? '#008758'
              : pool.status === 'scaling' ? '#A66300'
                : pool.status === 'scaled-to-zero' ? '#5A768A'
                  : '#CFD8DC';
            const label = t(poolLabelKey(pool.name) as Parameters<typeof t>[0]);

            return (
              <g key={pool.name}>
                <rect x={px - 100} y={py - 16} width="200" height="32" rx="6" fill="#FAFAFA" stroke={pc} strokeWidth="1" />
                <SvgIcon path={SERVICE_ICONS.server!} x={px - 90} y={py - 8} size={16} fill={pc} />
                <text x={px - 66} y={py + 4} className="infra-map__pool-label">{label}</text>
                <text x={px + 30} y={py + 4} className="infra-map__pool-count" fill={pc}>
                  {pool.nodeCount}/{pool.maxNodes}
                </text>
                {pool.status === 'scaled-to-zero' && (
                  <text x={px + 65} y={py + 4} fill="#5A768A" className="infra-map__pool-tag">idle</text>
                )}
                {pool.status === 'scaling' && (
                  <text x={px + 65} y={py + 4} fill="#A66300" className="infra-map__pool-tag">
                    scaling
                    <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" />
                  </text>
                )}
              </g>
            );
          })}

          {/* Mode badge */}
          {data && (
            <g>
              <rect x={W - 158} y="8" width="148" height="24" rx="12" fill="#E3F2FD" />
              <text x={W - 84} y="24" textAnchor="middle" className="infra-map__mode-badge">
                {data.cluster.mode.toUpperCase()} · {data.cluster.environment}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Detail panel */}
      {selectedSvc && data && (
        <ServiceDetailPanel
          service={selectedSvc}
          data={data}
          t={t}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Verdict cards for services with issues */}
      {data && issueServices.length > 0 && (
        <div className="infra-map__verdicts">
          <h6 className="infra-map__verdicts-title">{t('verdictSection')}</h6>
          <p className="infra-map__verdicts-subtitle">{t('verdictSectionSubtitle')}</p>
          <div className="infra-map__verdicts-grid">
            {issueServices.map((svc) => (
              <VerdictCard key={svc.id} service={svc} t={t} />
            ))}
          </div>
        </div>
      )}

      {/* Collapsible service table */}
      {data && (
        <div className="infra-map__table-section">
          <button
            className="infra-map__table-toggle"
            onClick={() => setShowTable(!showTable)}
            aria-expanded={showTable}
          >
            <span>{t('detailedTable')}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" style={{ transform: showTable ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
              <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" fill="currentColor" />
            </svg>
          </button>
          <Collapse isOpen={showTable}>
            <div className="infra-map__table-wrap">
              <table className="table table-sm mb-0">
                <thead>
                  <tr>
                    <th className="border-0 ps-3">{t('tableComponent')}</th>
                    <th className="border-0">{t('tableStatus')}</th>
                    <th className="border-0">{t('tableReplicas')}</th>
                    <th className="border-0">{t('tableCpu')}</th>
                    <th className="border-0">{t('tableMemory')}</th>
                    <th className="border-0 pe-3">{t('tableVerdict')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.services.map((svc) => {
                    const sc = STATUS_COLORS[svc.status] ?? '#5A768A';
                    const svcName = resolveI18nKey(t, svc.name);
                    const verdictText = resolveI18nKey(t, svc.verdict);
                    return (
                      <tr key={svc.id}>
                        <td className="ps-3 align-middle">
                          <span className="d-flex align-items-center gap-2">
                            <span className="rounded-circle d-inline-block flex-shrink-0" style={{ width: 8, height: 8, backgroundColor: sc }} />
                            <span>
                              <span className="fw-semibold" style={{ fontSize: '0.85rem' }}>{svcName}</span>
                              <br />
                              <span style={{ fontSize: '0.72rem', color: '#78909C' }}>{svc.technicalName}</span>
                            </span>
                          </span>
                        </td>
                        <td className="align-middle">
                          <Badge style={{ backgroundColor: sc, fontSize: '0.7rem' }}>
                            {t(`statuses.${svc.status}` as Parameters<typeof t>[0])}
                          </Badge>
                        </td>
                        <td className="align-middle" style={{ fontSize: '0.82rem', fontVariantNumeric: 'tabular-nums' }}>
                          {svc.replicas.running}/{svc.replicas.desired}
                        </td>
                        <td className="align-middle" style={{ fontSize: '0.82rem' }}>
                          {svc.resources.cpuRequest !== '—' ? formatCpu(svc.resources.cpuRequest) : '—'}
                        </td>
                        <td className="align-middle" style={{ fontSize: '0.82rem' }}>
                          {svc.resources.memRequest !== '—' ? formatMem(svc.resources.memRequest) : '—'}
                        </td>
                        <td className="pe-3 align-middle" style={{ fontSize: '0.78rem', color: '#455A64', maxWidth: '220px' }}>
                          {verdictText.length > 60 ? verdictText.substring(0, 59) + '…' : verdictText}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Collapse>
        </div>
      )}

      {/* Footer */}
      {data && (
        <div className="infra-map__footer">
          <div className="infra-map__legend">
            {Object.entries(STATUS_COLORS).map(([status, color]) => (
              <span key={status} className="infra-map__legend-item">
                <span className="infra-map__legend-dot" style={{ backgroundColor: color }} />
                {t(`statuses.${status}` as Parameters<typeof t>[0])}
              </span>
            ))}
          </div>
          <span className="infra-map__last-update">
            {t('lastUpdated')}: {new Date(data.lastUpdated).toLocaleTimeString()}
          </span>
        </div>
      )}

      {error && <div className="infra-map__error">{t('fetchError')}</div>}
    </div>
  );
}

function OverallBanner({ verdict, t }: {
  verdict: string;
  t: ReturnType<typeof useTranslations<'infraMap'>>;
}) {
  const text = resolveI18nKey(t, verdict);
  const isOk = verdict.includes('operational');
  const isDegraded = verdict.includes('degraded');
  const color = isOk ? 'success' : isDegraded ? 'warning' : 'danger';

  return (
    <Alert color={color} className="infra-map__banner mb-0 rounded-0 border-start-0 border-end-0 border-top-0">
      <span style={{ fontSize: '0.88rem' }}>{text}</span>
    </Alert>
  );
}

function VerdictCard({ service, t }: {
  service: InfraMapData['services'][0];
  t: ReturnType<typeof useTranslations<'infraMap'>>;
}) {
  const sc = STATUS_COLORS[service.status] ?? '#5A768A';
  const svcName = resolveI18nKey(t, service.name);
  const verdictText = resolveI18nKey(t, service.verdict);
  const impactText = service.impact ? resolveI18nKey(t, service.impact) : null;
  const iconPath = SERVICE_ICONS[service.id] ?? SERVICE_ICONS.app ?? '';

  return (
    <div className="infra-map__verdict-card" style={{ borderLeftColor: sc }}>
      <div className="d-flex align-items-center gap-2 mb-2">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d={iconPath} fill={sc} />
        </svg>
        <span className="fw-semibold" style={{ color: '#17324D', fontSize: '0.88rem' }}>{svcName}</span>
        <Badge style={{ backgroundColor: sc, fontSize: '0.68rem', marginLeft: 'auto' }}>
          {t(`statuses.${service.status}` as Parameters<typeof t>[0])}
        </Badge>
      </div>
      <p className="mb-1" style={{ fontSize: '0.82rem', color: '#455A64', lineHeight: 1.4 }}>
        {verdictText}
      </p>
      {impactText && (
        <p className="mb-0" style={{ fontSize: '0.78rem', color: '#CC334D', lineHeight: 1.3 }}>
          <strong>{t('impactLabel')}:</strong> {impactText}
        </p>
      )}
    </div>
  );
}

function StatPill({ label, value, color, iconPath }: {
  label: string; value: string; color: string; iconPath: string;
}) {
  return (
    <div className="infra-map__stat-pill">
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path d={iconPath} fill={color} />
      </svg>
      <span className="infra-map__stat-value" style={{ color }}>{value}</span>
      <span className="infra-map__stat-label">{label}</span>
    </div>
  );
}

function ServiceDetailPanel({ service, data, t, onClose }: {
  service: InfraMapData['services'][0];
  data: InfraMapData;
  t: ReturnType<typeof useTranslations<'infraMap'>>;
  onClose: () => void;
}) {
  const sc = STATUS_COLORS[service.status] ?? '#5A768A';
  const svcName = resolveI18nKey(t, service.name);
  const verdictText = resolveI18nKey(t, service.verdict);

  return (
    <div className="infra-map__detail" onClick={(e) => e.stopPropagation()}>
      <div className="infra-map__detail-header" style={{ borderLeftColor: sc }}>
        <div>
          <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
            <span className="rounded-circle d-inline-block" style={{ width: 10, height: 10, backgroundColor: sc }} />
            {svcName}
          </h6>
          <div className="d-flex align-items-center gap-2 mt-1">
            <Badge style={{ backgroundColor: sc, fontSize: '0.68rem' }}>
              {t(`statuses.${service.status}` as Parameters<typeof t>[0])}
            </Badge>
            <span style={{ fontSize: '0.7rem', color: '#78909C' }}>{service.technicalName}</span>
          </div>
        </div>
        <button className="btn btn-sm btn-link text-muted p-0" onClick={onClose} aria-label="Close">&#10005;</button>
      </div>

      <div className="infra-map__detail-body">
        <p style={{ fontSize: '0.8rem', color: '#455A64', lineHeight: 1.4, marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid #f0f0f0' }}>
          {verdictText}
        </p>

        <DRow label={t('replicas')} value={`${service.replicas.running} / ${service.replicas.desired} (max ${service.replicas.max})`} />

        {service.resources.cpuRequest !== '—' && (
          <DRow label={t('cpu')} value={formatCpu(service.resources.cpuRequest)} />
        )}
        {service.resources.memRequest !== '—' && (
          <DRow label={t('memory')} value={formatMem(service.resources.memRequest)} />
        )}

        {service.ports.length > 0 && (
          <DRow label={t('ports')} value={service.ports.map((p) => `${p.port}/${p.protocol}`).join(', ')} />
        )}

        {service.id === 'app' && data.appMetrics && (
          <>
            {data.appMetrics.cpuUsagePercent != null && <DRow label={t('cpuUsage')} value={`${data.appMetrics.cpuUsagePercent}%`} />}
            {data.appMetrics.memoryUsedMB != null && <DRow label={t('memoryUsed')} value={`${data.appMetrics.memoryUsedMB} MB`} />}
            {data.appMetrics.heapUsedMB != null && <DRow label={t('heapUsed')} value={`${data.appMetrics.heapUsedMB} MB`} />}
            {data.appMetrics.eventLoopLagMs != null && <DRow label={t('eventLoopLag')} value={`${data.appMetrics.eventLoopLagMs} ms`} />}
            {data.appMetrics.uptimeHours != null && <DRow label={t('uptime')} value={`${data.appMetrics.uptimeHours} h`} />}
          </>
        )}

        {service.id === 'database' && (
          <>
            {service.metadata.type != null && <DRow label={t('type')} value={String(service.metadata.type)} />}
            {service.metadata.latencyMs != null && <DRow label={t('latency')} value={`${service.metadata.latencyMs} ms`} />}
          </>
        )}

        {service.id === 'jvb' && (
          <>
            {service.metadata.stressLevel !== null && service.metadata.stressLevel !== undefined && (
              <div className="mt-2">
                <div className="d-flex justify-content-between mb-1">
                  <span className="infra-map__detail-label">{t('stressLevel')}</span>
                  <span style={{ color: sc, fontWeight: 600, fontSize: '0.8rem' }}>
                    {Math.round(Number(service.metadata.stressLevel) * 100)}%
                  </span>
                </div>
                <div className="progress" style={{ height: 6, borderRadius: 3 }}>
                  <div className="progress-bar" style={{ width: `${Number(service.metadata.stressLevel) * 100}%`, backgroundColor: sc, borderRadius: 3 }} />
                </div>
              </div>
            )}
            {service.metadata.participants != null && <DRow label={t('participants')} value={String(service.metadata.participants)} />}
            {service.metadata.conferences != null && <DRow label={t('conferences')} value={String(service.metadata.conferences)} />}
            {data.traffic.bandwidthInMbps != null && <DRow label={t('bandwidthIn')} value={formatMbps(data.traffic.bandwidthInMbps)} />}
            {data.traffic.bandwidthOutMbps != null && <DRow label={t('bandwidthOut')} value={formatMbps(data.traffic.bandwidthOutMbps)} />}
            {data.jvbExtended.largestConference != null && <DRow label={t('largestConference')} value={String(data.jvbExtended.largestConference)} />}
            {data.jvbExtended.rttAggregateMs != null && <DRow label={t('rtt')} value={`${Math.round(data.jvbExtended.rttAggregateMs)} ms`} />}
            {data.jvbExtended.jitterAggregateMs != null && <DRow label={t('jitter')} value={`${Math.round(data.jvbExtended.jitterAggregateMs)} ms`} />}
            {data.jvbExtended.lossRateDownload != null && <DRow label={t('packetLoss')} value={`${(data.jvbExtended.lossRateDownload * 100).toFixed(1)}%`} />}
            {data.jvbExtended.endpointsSendingAudio != null && <DRow label={t('sendingAudio')} value={String(data.jvbExtended.endpointsSendingAudio)} />}
            {data.jvbExtended.endpointsSendingVideo != null && <DRow label={t('sendingVideo')} value={String(data.jvbExtended.endpointsSendingVideo)} />}
            {data.jvbExtended.iceSuccessRate != null && <DRow label={t('iceSuccess')} value={`${data.jvbExtended.iceSuccessRate}%`} />}
            {data.jvbExtended.totalConferencesCreated != null && <DRow label={t('totalConferences')} value={String(data.jvbExtended.totalConferencesCreated)} />}
          </>
        )}

        {service.id === 'jibri' && service.metadata.busyStatus != null && (
          <DRow label={t('busyStatus')} value={String(service.metadata.busyStatus)} />
        )}
      </div>
    </div>
  );
}

function DRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="d-flex justify-content-between align-items-center py-1" style={{ borderBottom: '1px solid #f0f0f0' }}>
      <span className="infra-map__detail-label">{label}</span>
      <span className="infra-map__detail-value">{value}</span>
    </div>
  );
}

function formatCpu(raw: string): string {
  if (raw.endsWith('m')) {
    const millis = parseInt(raw, 10);
    return millis >= 1000 ? `${(millis / 1000).toFixed(1)} CPU` : `${millis / 1000} CPU`;
  }
  return `${raw} CPU`;
}

function formatMem(raw: string): string {
  if (raw.endsWith('Mi')) return `${parseInt(raw, 10)} MB`;
  if (raw.endsWith('Gi')) return `${parseFloat(raw)} GB`;
  return raw;
}

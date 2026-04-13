'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from 'design-react-kit';

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

const NODE_W = 120;
const NODE_H = 68;

const LAYOUT: Record<string, Pos> = {
  app:         { x: 200, y: 200 },
  'jitsi-web': { x: 480, y: 130 },
  prosody:     { x: 480, y: 270 },
  jicofo:      { x: 640, y: 200 },
  jvb:         { x: 800, y: 180 },
  jibri:       { x: 800, y: 330 },
  database:    { x: 200, y: 370 },
  smtp:        { x: 370, y: 400 },
};

const FIXED_POS: Record<string, Pos> = {
  'endpoint-app':   { x: 50, y: 170 },
  'endpoint-jitsi': { x: 50, y: 260 },
  'endpoint-media': { x: 960, y: 130 },
  storage:          { x: 960, y: 330 },
};

const CONNECTIONS: { from: string; to: string; label?: string; dashed?: boolean }[] = [
  { from: 'endpoint-app', to: 'app', label: 'HTTPS :443' },
  { from: 'endpoint-jitsi', to: 'jitsi-web', label: 'HTTPS :443' },
  { from: 'app', to: 'database', label: 'TCP :5432' },
  { from: 'app', to: 'smtp', label: 'SMTP', dashed: true },
  { from: 'jitsi-web', to: 'prosody', label: 'BOSH :5280' },
  { from: 'prosody', to: 'jicofo', label: 'XMPP' },
  { from: 'prosody', to: 'jvb', label: 'XMPP' },
  { from: 'prosody', to: 'jibri', label: 'XMPP', dashed: true },
  { from: 'jicofo', to: 'jvb', label: 'Colibri :8080' },
  { from: 'endpoint-media', to: 'jvb', label: 'UDP :10000' },
  { from: 'jibri', to: 'storage', label: 'Upload', dashed: true },
];

function pos(id: string): Pos {
  return FIXED_POS[id] ?? LAYOUT[id] ?? { x: 400, y: 300 };
}

function formatMbps(mbps: number | null): string {
  if (mbps === null) return '—';
  if (mbps < 1) return `${(mbps * 1024).toFixed(0)} Kbps`;
  return `${mbps.toFixed(1)} Mbps`;
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

  const W = 1040;
  const H = 480;

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

  return (
    <div className="infra-map">
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

          {/* Zone backgrounds */}
          <rect x="10" y="75" width="130" height="240" rx="12" fill="#F0F4F8" opacity="0.5" />
          <text x="75" y="93" textAnchor="middle" className="infra-map__zone-label">{t('zonePublic')}</text>

          <rect x="150" y="75" width="530" height="370" rx="12" fill="#F8FAFE" opacity="0.4" />
          <text x="415" y="93" textAnchor="middle" className="infra-map__zone-label">{t('zoneCluster')}</text>

          <rect x="720" y="75" width="160" height="180" rx="12" fill="#F2FFF5" opacity="0.4" />
          <text x="800" y="93" textAnchor="middle" className="infra-map__zone-label">{t('zoneMedia')}</text>

          <rect x="720" y="275" width="160" height="120" rx="12" fill="#FFF8F0" opacity="0.4" />
          <text x="800" y="293" textAnchor="middle" className="infra-map__zone-label">{t('zoneRecording')}</text>

          <rect x="900" y="275" width="130" height="120" rx="12" fill="#F5F0FF" opacity="0.4" />
          <text x="965" y="293" textAnchor="middle" className="infra-map__zone-label">{t('zoneStorage')}</text>

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
                    <circle r="3" fill={c.label?.includes('UDP') ? '#008758' : '#0066CC'} opacity="0.8">
                      <animateMotion
                        dur={`${getAnimDur(key)}s`}
                        repeatCount="indefinite"
                        path={`M${f.x},${f.y} L${t2.x},${t2.y}`}
                      />
                    </circle>
                    <circle r="2" fill={c.label?.includes('UDP') ? '#008758' : '#0066CC'} opacity="0.5">
                      <animateMotion
                        dur={`${getAnimDur(key) + 0.7}s`}
                        repeatCount="indefinite"
                        path={`M${f.x},${f.y} L${t2.x},${t2.y}`}
                        begin={`${getAnimDur(key) * 0.4}s`}
                      />
                    </circle>
                  </>
                )}

                {c.label && hi && (
                  <>
                    <rect
                      x={(f.x + t2.x) / 2 - c.label.length * 3.2}
                      y={(f.y + t2.y) / 2 - 18}
                      width={c.label.length * 6.4}
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
                      {c.label}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* Public endpoints */}
          {data?.endpoints.filter(e => e.service !== 'jvb').map((ep, i) => {
            const p = { x: 50, y: 170 + i * 90 };
            const epId = `endpoint-${ep.service === 'app' ? 'app' : 'jitsi'}`;
            return (
              <g
                key={`ep-${ep.service}-${ep.port}`}
                onMouseEnter={() => setHovered(epId)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'default' }}
              >
                <rect x={p.x - 40} y={p.y - 22} width="80" height="44" rx="22" fill="#E3F2FD" stroke={isHighlighted(epId) ? '#0066CC' : '#90CAF9'} strokeWidth={isHighlighted(epId) ? 2 : 1} />
                <SvgIcon path={SERVICE_ICONS.globe!} x={p.x - 10} y={p.y - 10} size={20} fill="#0066CC" />
                <text x={p.x} y={p.y + 34} textAnchor="middle" className="infra-map__endpoint-label">
                  :{ep.port} {ep.protocol}
                </text>
              </g>
            );
          })}

          {/* Media endpoint (right) */}
          {data?.endpoints.filter(e => e.service === 'jvb').map((ep) => {
            const mp = FIXED_POS['endpoint-media']!;
            return (
              <g
                key={`ep-media-${ep.port}`}
                onMouseEnter={() => setHovered('endpoint-media')}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'default' }}
              >
                <rect x={mp.x - 40} y={mp.y - 22} width="80" height="44" rx="22" fill="#E8F5E9" stroke={isHighlighted('endpoint-media') ? '#008758' : '#A5D6A7'} strokeWidth={isHighlighted('endpoint-media') ? 2 : 1} />
                <SvgIcon path={SERVICE_ICONS.globe!} x={mp.x - 10} y={mp.y - 10} size={20} fill="#008758" />
                <text x={mp.x} y={mp.y + 34} textAnchor="middle" className="infra-map__endpoint-label">
                  UDP :{ep.port}
                </text>
              </g>
            );
          })}

          {/* Storage node */}
          {data && (() => {
            const sp = FIXED_POS.storage!;
            return (
              <g>
                <rect x={sp.x - 50} y={sp.y - 28} width="100" height="56" rx="10" fill="#F3E5F5" stroke="#9C27B0" strokeWidth="1.2" filter="url(#infraShadow)" />
                <SvgIcon path={SERVICE_ICONS.storage!} x={sp.x - 10} y={sp.y - 18} size={18} fill="#7B1FA2" />
                <text x={sp.x} y={sp.y + 4} textAnchor="middle" className="infra-map__node-label-sm">
                  {data.storage.type === 'not-configured' ? 'N/A' : data.storage.type}
                </text>
                <text x={sp.x} y={sp.y + 17} textAnchor="middle" className="infra-map__node-sublabel">
                  {data.storage.recordings.count} rec
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

            return (
              <g
                key={svc.id}
                onMouseEnter={() => setHovered(svc.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => { e.stopPropagation(); setSelected(svc.id === selected ? null : svc.id); }}
                style={{ cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                aria-label={`${svc.name}: ${svc.status}`}
              >
                {/* Pulse ring for active healthy services */}
                {svc.status === 'healthy' && data.traffic.totalParticipants > 0 && (
                  <circle cx={p.x} cy={p.y} r="42" fill="none" stroke={sc} strokeWidth="1.5" opacity="0">
                    <animate attributeName="r" values="35;52;35" dur="2.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.5;0;0.5" dur="2.5s" repeatCount="indefinite" />
                  </circle>
                )}

                {/* Scaling dashed ring */}
                {svc.status === 'scaling' && (
                  <circle cx={p.x} cy={p.y} r="42" fill="none" stroke="#0066CC" strokeWidth="2" strokeDasharray="8 5" opacity="0.6">
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

                {/* Card background */}
                <rect
                  x={p.x - halfW} y={p.y - halfH}
                  width={NODE_W} height={NODE_H}
                  rx="12"
                  fill={bg}
                  stroke={sc}
                  strokeWidth={hi ? 2.5 : 1.2}
                  filter="url(#infraShadow)"
                />

                {/* Status dot (animated blink when healthy + traffic) */}
                <circle cx={p.x - halfW + 14} cy={p.y - halfH + 14} r="4" fill={sc}>
                  {svc.status === 'healthy' && data.traffic.totalParticipants > 0 && (
                    <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
                  )}
                </circle>

                {/* Service icon */}
                <SvgIcon path={iconPath} x={p.x - halfW + 6} y={p.y - 6} size={16} fill={sc} opacity={0.6} />

                {/* Name */}
                <text x={p.x - halfW + 28} y={p.y - 4} className="infra-map__node-label">
                  {svc.name.length > 16 ? svc.name.substring(0, 15) + '…' : svc.name}
                </text>

                {/* Replicas text */}
                <text x={p.x - halfW + 28} y={p.y + 10} className="infra-map__node-sublabel">
                  {svc.replicas.running}/{svc.replicas.max} replicas
                </text>

                {/* Replica bars */}
                {Array.from({ length: Math.min(svc.replicas.max, 8) }).map((_, i) => {
                  const bx = p.x - halfW + 8 + i * 13;
                  const by = p.y + halfH - 10;
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
            const px = 220 + i * 260;
            const py = H - 28;
            const pc = pool.status === 'active' ? '#008758'
              : pool.status === 'scaling' ? '#A66300'
                : pool.status === 'scaled-to-zero' ? '#5A768A'
                  : '#CFD8DC';

            return (
              <g key={pool.name}>
                <rect x={px - 85} y={py - 16} width="170" height="32" rx="6" fill="#FAFAFA" stroke={pc} strokeWidth="1" />
                <SvgIcon path={SERVICE_ICONS.server!} x={px - 78} y={py - 8} size={16} fill={pc} />
                <text x={px - 55} y={py + 4} className="infra-map__pool-label">{pool.name}</text>
                <text x={px + 20} y={py + 4} className="infra-map__pool-count" fill={pc}>
                  {pool.nodeCount}/{pool.maxNodes}
                </text>
                {pool.status === 'scaled-to-zero' && (
                  <text x={px + 55} y={py + 4} fill="#5A768A" className="infra-map__pool-tag">idle</text>
                )}
                {pool.status === 'scaling' && (
                  <text x={px + 55} y={py + 4} fill="#A66300" className="infra-map__pool-tag">
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
              <rect x={W - 148} y="8" width="138" height="24" rx="12" fill="#E3F2FD" />
              <text x={W - 79} y="24" textAnchor="middle" className="infra-map__mode-badge">
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

      {/* Footer */}
      {data && (
        <div className="infra-map__footer">
          <div className="infra-map__legend">
            {Object.entries(STATUS_COLORS).map(([status, color]) => (
              <span key={status} className="infra-map__legend-item">
                <span className="infra-map__legend-dot" style={{ backgroundColor: color }} />
                {t(`statuses.${status}`)}
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

  return (
    <div className="infra-map__detail" onClick={(e) => e.stopPropagation()}>
      <div className="infra-map__detail-header" style={{ borderLeftColor: sc }}>
        <div>
          <h6 className="mb-0 fw-semibold d-flex align-items-center gap-2">
            <span className="rounded-circle d-inline-block" style={{ width: 10, height: 10, backgroundColor: sc }} />
            {service.name}
          </h6>
          <Badge style={{ backgroundColor: sc, fontSize: '0.72rem', marginTop: 4 }}>
            {t(`statuses.${service.status}`)}
          </Badge>
        </div>
        <button className="btn btn-sm btn-link text-muted p-0" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="infra-map__detail-body">
        <DRow label={t('replicas')} value={`${service.replicas.running} / ${service.replicas.desired} (max ${service.replicas.max})`} />
        <DRow label={t('cpu')} value={service.resources.cpuRequest} />
        <DRow label={t('memory')} value={service.resources.memRequest} />

        {service.ports.length > 0 && (
          <DRow label={t('ports')} value={service.ports.map((p) => `${p.port}/${p.protocol}`).join(', ')} />
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
          </>
        )}

        {service.id === 'jibri' && service.metadata.busyStatus != null && (
          <DRow label={t('busyStatus')} value={String(service.metadata.busyStatus)} />
        )}

        {service.id === 'database' && service.metadata.type != null && (
          <DRow label={t('type')} value={String(service.metadata.type)} />
        )}

        {Object.entries(service.metadata)
          .filter(([k]) => !['stressLevel', 'participants', 'conferences', 'videochannels', 'busy', 'busyStatus', 'type'].includes(k))
          .filter(([, v]) => v != null)
          .map(([k, v]) => <DRow key={k} label={k} value={String(v)} />)}
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

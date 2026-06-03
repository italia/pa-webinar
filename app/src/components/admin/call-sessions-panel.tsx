'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Collapse,
  Icon,
} from 'design-react-kit';

import VideoPlayer from './video-player';

interface Participant {
  name: string;
  joinedAt: string | null;
  leftAt: string | null;
}

interface Telemetry {
  bandwidthIn?: number;
  bandwidthOut?: number;
  rtt?: number;
  jitter?: number;
  packetLoss?: number;
  iceSuccessRate?: number;
}

interface Session {
  id: string;
  jitsiRoomName: string;
  startedAt: string;
  endedAt: string | null;
  duration: number | null;
  peakParticipants: number;
  participants: Participant[];
  recordingUrl: string | null;
  recordingFileSize: number | null;
  recordingDuration: number | null;
  recordingFilename: string | null;
  telemetry: Telemetry;
  createdAt: string;
}

interface CallSessionsPanelProps {
  eventId: string;
  eventSlug: string;
  moderatorToken: string;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export default function CallSessionsPanel({
  eventId: _eventId,
  eventSlug,
  moderatorToken,
}: CallSessionsPanelProps) {
  const t = useTranslations('admin.sessions');
  const fmt = useFormatter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/events/${eventSlug}/sessions?token=${moderatorToken}`,
      );
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions ?? []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [eventSlug, moderatorToken]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const handleDelete = useCallback(async (sessionId: string) => {
    if (!window.confirm(t('deleteConfirm'))) return;
    await fetch(`/api/events/${eventSlug}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${moderatorToken}` },
    });
    fetchSessions();
  }, [eventSlug, moderatorToken, t, fetchSessions]);

  if (loading) {
    return (
      <Card className="border-0 shadow-sm mb-4" style={{ borderRadius: 8 }}>
        <CardBody className="p-4 text-center text-muted">
          <div className="spinner-border spinner-border-sm me-2" role="status" />
          {t('loading')}
        </CardBody>
      </Card>
    );
  }

  if (sessions.length === 0) {
    return (
      <Card className="border-0 shadow-sm mb-4" style={{ borderRadius: 8 }}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
            <Icon icon="it-video" className="me-2" />
            {t('title')}
          </h5>
          <div className="text-muted" style={{ fontSize: '0.9rem' }}>
            {t('empty')}
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm mb-4" style={{ borderRadius: 8 }}>
      <CardBody className="p-4">
        <h5 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
          <Icon icon="it-video" className="me-2" />
          {t('title')} ({sessions.length})
        </h5>

        <div className="d-flex flex-column gap-3">
          {sessions.map((session) => {
            const isExpanded = expanded === session.id;
            const isPlaying = playing === session.id;
            const participantList = Array.isArray(session.participants) ? session.participants : [];

            return (
              <div key={session.id} className="border rounded" style={{ borderColor: '#e8e8e8' }}>
                <button
                  className="d-flex justify-content-between align-items-center w-100 p-3 border-0 bg-transparent text-start"
                  onClick={() => setExpanded(isExpanded ? null : session.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="d-flex align-items-center gap-3">
                    <div>
                      <div className="fw-semibold" style={{ fontSize: '0.9rem' }}>
                        {fmt.dateTime(new Date(session.startedAt), {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      <div className="d-flex gap-2 text-muted" style={{ fontSize: '0.78rem' }}>
                        <span>{formatDuration(session.duration)}</span>
                        <span>{session.peakParticipants} {t('participants')}</span>
                        {session.recordingUrl && (
                          <Badge color="success" pill style={{ fontSize: '0.68rem' }}>REC</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Icon
                    icon="it-expand"
                    size="sm"
                    style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                  />
                </button>

                <Collapse isOpen={isExpanded}>
                  <div className="px-3 pb-3" style={{ borderTop: '1px solid #e8e8e8' }}>
                    {/* Recording player */}
                    {session.recordingUrl && (
                      <div className="mt-3">
                        <div className="d-flex align-items-center gap-2 mb-2">
                          <Button
                            color="primary"
                            size="sm"
                            outline
                            onClick={() => setPlaying(isPlaying ? null : session.id)}
                          >
                            <Icon icon="it-video" size="sm" className="me-1" />
                            {isPlaying ? t('hidePlayer') : t('play')}
                          </Button>
                          <a
                            href={session.recordingUrl}
                            download
                            className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
                          >
                            <Icon icon="it-download" size="sm" />
                            {t('download')}
                          </a>
                          <Button
                            color="danger"
                            size="sm"
                            outline
                            onClick={() => handleDelete(session.id)}
                          >
                            <Icon icon="it-delete" size="sm" />
                          </Button>
                          <span className="text-muted ms-auto" style={{ fontSize: '0.78rem' }}>
                            {formatSize(session.recordingFileSize)}
                            {session.recordingDuration ? ` · ${formatDuration(session.recordingDuration)}` : ''}
                          </span>
                        </div>
                        {isPlaying && <VideoPlayer src={session.recordingUrl} />}
                      </div>
                    )}

                    {/* Participants */}
                    {participantList.length > 0 && (
                      <div className="mt-3">
                        <h6 className="fw-semibold mb-2" style={{ fontSize: '0.85rem' }}>
                          {t('participantList')} ({participantList.length})
                        </h6>
                        <div className="table-responsive">
                          <table className="table table-sm mb-0" style={{ fontSize: '0.82rem' }}>
                            <thead>
                              <tr>
                                <th className="border-0">{t('name')}</th>
                                <th className="border-0">{t('joined')}</th>
                                <th className="border-0">{t('left')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {participantList.map((p, i) => (
                                <tr key={i}>
                                  <td>{p.name}</td>
                                  <td>{p.joinedAt ? fmt.dateTime(new Date(p.joinedAt), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</td>
                                  <td>{p.leftAt ? fmt.dateTime(new Date(p.leftAt), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Telemetry */}
                    {session.telemetry && Object.keys(session.telemetry).length > 0 && (
                      <div className="mt-3">
                        <h6 className="fw-semibold mb-2" style={{ fontSize: '0.85rem' }}>
                          {t('telemetry')}
                        </h6>
                        <div className="d-flex flex-wrap gap-3" style={{ fontSize: '0.82rem' }}>
                          {session.telemetry.rtt != null && (
                            <span className="text-muted">RTT: {Math.round(session.telemetry.rtt)} ms</span>
                          )}
                          {session.telemetry.jitter != null && (
                            <span className="text-muted">Jitter: {Math.round(session.telemetry.jitter)} ms</span>
                          )}
                          {session.telemetry.packetLoss != null && (
                            <span className="text-muted">Loss: {(session.telemetry.packetLoss * 100).toFixed(1)}%</span>
                          )}
                          {session.telemetry.iceSuccessRate != null && (
                            <span className="text-muted">ICE: {session.telemetry.iceSuccessRate.toFixed(1)}%</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </Collapse>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

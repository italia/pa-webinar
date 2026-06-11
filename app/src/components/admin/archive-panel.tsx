'use client';

/**
 * Tab "Archivio" della gestione registrazione (ADR-013 Fase 3).
 *
 * Due funzioni, entrambe admin/moderatore-only (audio isolato
 * per-partecipante = PII sensibile, mai pubblico):
 *   1. Riascolto per-relatore: player video col mix + selettore audio
 *      per-partecipante (tracce isolate, allineate via offset).
 *   2. Archivio scaricabile: genera (on-demand) un MKV con video + N
 *      tracce audio nominate + sottotitoli, e ne offre il download.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import VideoPlayer, {
  type AudioTrack,
  type SubtitleTrack,
} from '@/components/events/video-player';
import { useToast } from '@/components/ui/toast';

interface TrackDto {
  id: string;
  participantId: string;
  displayName: string | null;
  offsetSec: number;
  audioUrl: string;
}

type ArchiveStatus = 'none' | 'pending' | 'running' | 'done' | 'failed';

interface TracksResponse {
  mixUrl: string;
  tracks: TrackDto[];
  subtitleVtt: string | null;
  subtitleLang: string | null;
  archive: { status: ArchiveStatus; url: string | null };
}

export default function ArchivePanel({ recordingId }: { recordingId: string }) {
  const t = useTranslations('admin.postprod');
  const toast = useToast();
  const [data, setData] = useState<TracksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const subtitleUrlRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/admin/postprod/recordings/${recordingId}/tracks`,
        { credentials: 'include' },
      );
      if (r.ok) setData((await r.json()) as TracksResponse);
    } finally {
      setLoading(false);
    }
  }, [recordingId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll mentre l'archivio è in coda/esecuzione.
  useEffect(() => {
    const s = data?.archive.status;
    if (s !== 'pending' && s !== 'running') return;
    const iv = setInterval(() => void load(), 8000);
    return () => clearInterval(iv);
  }, [data?.archive.status, load]);

  // Sottotitoli come Blob same-origin (evita CORS sul SAS Azure).
  const subtitleTracks: SubtitleTrack[] = useMemo(() => {
    if (subtitleUrlRef.current) {
      URL.revokeObjectURL(subtitleUrlRef.current);
      subtitleUrlRef.current = null;
    }
    if (!data?.subtitleVtt) return [];
    const url = URL.createObjectURL(
      new Blob([data.subtitleVtt], { type: 'text/vtt' }),
    );
    subtitleUrlRef.current = url;
    return [
      {
        language: data.subtitleLang ?? 'it',
        src: url,
        label: (data.subtitleLang ?? 'it').toUpperCase(),
        isDefault: true,
      },
    ];
  }, [data?.subtitleVtt, data?.subtitleLang]);

  useEffect(
    () => () => {
      if (subtitleUrlRef.current) URL.revokeObjectURL(subtitleUrlRef.current);
    },
    [],
  );

  const audioTracks: AudioTrack[] = useMemo(
    () =>
      (data?.tracks ?? []).map((tr) => ({
        language: tr.id,
        src: tr.audioUrl,
        label:
          tr.displayName ?? `${t('archiveTrackFallback')} ${tr.participantId.slice(0, 6)}`,
        offsetSec: tr.offsetSec,
        isSynthetic: false,
      })),
    [data?.tracks, t],
  );

  async function generate(): Promise<void> {
    setGenerating(true);
    try {
      const r = await fetch(
        `/api/admin/postprod/recordings/${recordingId}/archive`,
        { method: 'POST', credentials: 'include' },
      );
      if (r.ok) {
        toast.success(t('archiveGenerateOk'));
        await load();
      } else {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? t('archiveGenerateErr', { code: r.status }));
      }
    } catch {
      toast.error(t('archiveGenerateErr', { code: 0 }));
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return <p className="text-secondary mb-0">{t('manageLoading')}</p>;
  }

  const hasTracks = (data?.tracks.length ?? 0) > 0;
  const archive = data?.archive ?? { status: 'none' as ArchiveStatus, url: null };

  return (
    <div>
      <p className="text-secondary small mb-3">{t('archivePiiNote')}</p>

      {!hasTracks ? (
        <div>
          {/* Niente tracce per-partecipante (multitrack non attivo): invece
              di una tab vuota, offriamo la registrazione SORGENTE (riascolto
              + download) e spieghiamo perché l'archivio MKV non è disponibile. */}
          <div className="alert alert-secondary" role="status">{t('archiveNoTracks')}</div>
          {data?.mixUrl && (
            <>
              <h2 className="h6 fw-semibold mb-2">{t('archiveSourceTitle')}</h2>
              <p className="text-secondary small mb-2">{t('archiveSourceHint')}</p>
              <VideoPlayer
                src={data.mixUrl}
                title={t('archiveSourceTitle')}
                subtitleTracks={subtitleTracks}
              />
              <a
                href={data.mixUrl}
                className="btn btn-sm btn-outline-secondary mt-2"
                download
              >
                {t('archiveSourceDownload')}
              </a>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Player di riascolto per-relatore */}
          <h2 className="h6 fw-semibold mb-2">{t('archivePlayerTitle')}</h2>
          <p className="text-secondary small mb-2">{t('archiveAudioHint')}</p>
          {data && (
            <VideoPlayer
              src={data.mixUrl}
              title={t('archivePlayerTitle')}
              audioTracks={audioTracks}
              subtitleTracks={subtitleTracks}
            />
          )}

          {/* Archivio scaricabile */}
          <hr className="my-4" />
          <h2 className="h6 fw-semibold mb-2">{t('archiveTitle')}</h2>
          <p className="text-secondary small mb-3">{t('archiveIntro')}</p>

          <div className="d-flex flex-wrap align-items-center gap-3">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={generating || archive.status === 'pending' || archive.status === 'running'}
              onClick={() => void generate()}
            >
              {generating ? '…' : t('archiveGenerate')}
            </button>

            <span className="small text-secondary">
              {t('archiveStatusLabel')}:{' '}
              <strong>{t(`archiveStatus_${archive.status}`)}</strong>
            </span>

            {archive.status === 'done' && archive.url && (
              <a
                href={archive.url}
                className="btn btn-sm btn-outline-success"
                download
              >
                {t('archiveDownload')}
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}

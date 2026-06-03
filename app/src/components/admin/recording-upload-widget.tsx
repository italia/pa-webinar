'use client';

import { useCallback, useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import { BlockBlobClient } from '@azure/storage-blob';
import { Alert, Button, Label, Progress } from 'design-react-kit';

import { useRouter } from '@/i18n/navigation';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GiB
const ACCEPTED_MIME = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'];

type Phase = 'idle' | 'signing' | 'uploading' | 'attaching';

/**
 * Upload an MP4 / WebM / MOV onto an **existing** event as its
 * primary recording. Useful when Jibri wasn't active (external
 * MsTeams meeting mirrored to an eventi-dtd event, a recording
 * recovered from another system, a re-upload after manual editing).
 *
 * Flow mirrors /admin/publications/new but targets an existing event:
 *   1. GET  /api/admin/publications/upload-url?filename=…  → SAS URL
 *   2. BlockBlobClient.uploadData(file, …) direct to Azure (multi-block)
 *   3. PATCH /api/admin/publications/<eventId> with recordingUrl + size
 *      — the admin-authenticated endpoint flips recordingEnabled on
 *      and auto-publishes the recording.
 *
 * The widget is a single card; the caller decides whether to render
 * it (RecordingManagement shows it both when recording is disabled
 * and alongside the existing management UI once a blob is present).
 */
export default function RecordingUploadWidget({
  eventId,
  compact = false,
}: {
  eventId: string;
  compact?: boolean;
}) {
  const t = useTranslations('admin.recordingUpload');
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handlePick = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setError(null);
      const selected = e.target.files?.[0] ?? null;
      if (!selected) {
        setFile(null);
        return;
      }
      if (selected.size > MAX_FILE_SIZE) {
        setError(t('errors.fileTooLarge'));
        setFile(null);
        return;
      }
      if (!ACCEPTED_MIME.includes(selected.type) && !/\.(mp4|webm|mov|m4v)$/i.test(selected.name)) {
        setError(t('errors.unsupportedType'));
        setFile(null);
        return;
      }
      setFile(selected);
    },
    [t],
  );

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setError(null);
    try {
      setPhase('signing');
      const signRes = await fetch(
        `/api/admin/publications/upload-url?filename=${encodeURIComponent(file.name)}`,
      );
      if (!signRes.ok) {
        setError(t('errors.signFailed'));
        setPhase('idle');
        return;
      }
      const { uploadUrl, recordingUrl } = await signRes.json();

      setPhase('uploading');
      setProgress(0);
      const blob = new BlockBlobClient(uploadUrl);
      await blob.uploadData(file, {
        blockSize: 8 * 1024 * 1024,
        concurrency: 4,
        blobHTTPHeaders: { blobContentType: file.type || 'video/mp4' },
        onProgress: (ev) => {
          setProgress(Math.min(99, Math.floor((ev.loadedBytes / file.size) * 100)));
        },
      });
      setProgress(100);

      setPhase('attaching');
      const attachRes = await fetch(`/api/admin/publications/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordingUrl,
          recordingFileSize: file.size,
        }),
      });
      if (!attachRes.ok) {
        setError(t('errors.attachFailed'));
        setPhase('idle');
        return;
      }

      // Server-rendered ancestors (event management page) need to re-
      // fetch so they reflect recordingPublished + recordingUrl. Using
      // router.refresh avoids a full browser reload.
      router.refresh();
      setFile(null);
      setProgress(0);
      setPhase('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.uploadFailed'));
      setPhase('idle');
    }
  }, [file, eventId, router, t]);

  const busy = phase !== 'idle';
  const sizeMB = file ? (file.size / 1024 / 1024).toFixed(1) : null;

  return (
    <div
      className={compact ? 'mt-3' : 'mt-4 p-3 border rounded'}
      style={compact ? undefined : { borderColor: '#e8e8e8' }}
    >
      {!compact && (
        <h6 className="fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h6>
      )}
      <p className="text-muted mb-2" style={{ fontSize: '0.82rem' }}>
        {t('subtitle')}
      </p>

      {error && (
        <Alert color="danger" className="mb-2">
          {error}
        </Alert>
      )}

      <div className="d-flex gap-2 flex-wrap align-items-center">
        <Label htmlFor="recording-file" className="visually-hidden">
          {t('fileLabel')}
        </Label>
        <input
          id="recording-file"
          type="file"
          accept={ACCEPTED_MIME.join(',')}
          onChange={handlePick}
          disabled={busy}
          className="form-control"
          style={{ maxWidth: 320 }}
        />
        {file && (
          <span className="text-muted" style={{ fontSize: '0.82rem' }}>
            {file.name} · {sizeMB} MB
          </span>
        )}
        <Button
          color="primary"
          size="sm"
          disabled={!file || busy}
          onClick={handleUpload}
        >
          {phase === 'signing' && t('signing')}
          {phase === 'uploading' && t('uploading', { progress })}
          {phase === 'attaching' && t('attaching')}
          {phase === 'idle' && t('upload')}
        </Button>
      </div>
      {phase === 'uploading' && (
        <Progress value={progress} className="mt-2" />
      )}
      <small className="form-text text-muted d-block mt-2">
        {t('hint')}
      </small>
    </div>
  );
}

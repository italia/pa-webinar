'use client';

import { useCallback, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { BlockBlobClient } from '@azure/storage-blob';
import { Alert, Button, Card, CardBody, Input, Label, Progress } from 'design-react-kit';

import { useRouter } from '@/i18n/navigation';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GiB
const ACCEPTED_MIME = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'];

type UploadPhase = 'idle' | 'requesting-url' | 'uploading' | 'saving' | 'done';

interface UploadedBlob {
  recordingUrl: string;
  sizeBytes: number;
  filename: string;
}

export default function UploadPublicationForm() {
  const t = useTranslations('admin.publications.uploadPage');
  const tc = useTranslations('common');
  const router = useRouter();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<UploadedBlob | null>(null);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Metadata
  const [titleIt, setTitleIt] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [descriptionIt, setDescriptionIt] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [organizer, setOrganizer] = useState('');
  const [speakersIt, setSpeakersIt] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [libraryListed, setLibraryListed] = useState(true);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setUploaded(null);
    setUploadProgress(0);
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
    // Default the title to the filename stem so the admin only types
    // the full title when it differs from the source file.
    if (!titleIt) {
      const stem = selected.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
      setTitleIt(stem);
    }
  }, [t, titleIt]);

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setError(null);
    setPhase('requesting-url');
    try {
      const res = await fetch(
        `/api/admin/publications/upload-url?filename=${encodeURIComponent(file.name)}`,
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error ?? t('errors.signFailed'));
        setPhase('idle');
        return;
      }
      const { uploadUrl, recordingUrl } = await res.json();

      setPhase('uploading');
      setUploadProgress(0);

      // Use BlockBlobClient directly — it chunks files > 256 MiB into
      // blocks automatically, so MsTeams-sized (≈500 MB) recordings
      // upload without hitting Azure's single-PUT limit.
      const blob = new BlockBlobClient(uploadUrl);
      await blob.uploadData(file, {
        blockSize: 8 * 1024 * 1024,
        concurrency: 4,
        blobHTTPHeaders: { blobContentType: file.type || 'video/mp4' },
        onProgress: (ev) => {
          setUploadProgress(Math.min(99, Math.floor((ev.loadedBytes / file.size) * 100)));
        },
      });
      setUploadProgress(100);
      setUploaded({ recordingUrl, sizeBytes: file.size, filename: file.name });
      setPhase('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.uploadFailed'));
      setPhase('idle');
    }
  }, [file, t]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!uploaded) {
        setError(t('errors.uploadFirst'));
        return;
      }
      if (!titleIt.trim() || titleIt.trim().length < 3) {
        setError(t('errors.titleRequired'));
        return;
      }
      if (!startsAt) {
        setError(t('errors.dateRequired'));
        return;
      }

      setPhase('saving');
      try {
        const titleObj: Record<string, string> = { it: titleIt.trim() };
        if (titleEn.trim()) titleObj.en = titleEn.trim();

        const descObj: Record<string, string> = { it: descriptionIt.trim() };
        const speakersObj: Record<string, string> = {};
        if (speakersIt.trim()) speakersObj.it = speakersIt.trim();

        const startsAtIso = new Date(startsAt).toISOString();
        // Default endsAt to +1h so the detail page has a sensible
        // "duration" to show. Admins can tweak it from the event page.
        const endsAtIso = new Date(new Date(startsAt).getTime() + 3600_000).toISOString();

        const res = await fetch('/api/admin/publications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: titleObj,
            description: descObj,
            startsAt: startsAtIso,
            endsAt: endsAtIso,
            recordingUrl: uploaded.recordingUrl,
            recordingFileSize: uploaded.sizeBytes,
            coverImageUrl: coverImageUrl.trim() || undefined,
            youtubeUrl: youtubeUrl.trim() || undefined,
            speakersInfo: Object.keys(speakersObj).length > 0 ? speakersObj : undefined,
            organizerName: organizer.trim() || undefined,
            libraryListed,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          setError(errData.error ?? t('errors.saveFailed'));
          setPhase('idle');
          return;
        }
        setPhase('done');
        router.push('/admin/publications');
      } catch {
        setError(t('errors.saveFailed'));
        setPhase('idle');
      }
    },
    [uploaded, titleIt, titleEn, descriptionIt, startsAt, organizer, speakersIt, coverImageUrl, youtubeUrl, libraryListed, router, t],
  );

  const fileSizeMB = file ? (file.size / 1024 / 1024).toFixed(1) : null;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && (
        <Alert color="danger" className="mb-3">
          {error}
        </Alert>
      )}

      <Card className="border-0 shadow-sm mb-4">
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
            {t('step1Title')}
          </h5>
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_MIME.join(',')}
              onChange={handleFileChange}
              disabled={phase === 'uploading' || phase === 'saving'}
              style={{ maxWidth: 360 }}
              className="form-control"
            />
            {file && (
              <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                {file.name} · {fileSizeMB} MB
              </span>
            )}
            <Button
              type="button"
              color="primary"
              onClick={handleUpload}
              disabled={!file || phase === 'uploading' || phase === 'requesting-url' || phase === 'saving' || Boolean(uploaded)}
            >
              {phase === 'requesting-url' && t('signing')}
              {phase === 'uploading' && t('uploading', { progress: uploadProgress })}
              {(phase === 'idle' || phase === 'done' || phase === 'saving') && !uploaded && t('startUpload')}
              {uploaded && t('uploaded')}
            </Button>
          </div>
          {phase === 'uploading' && (
            <Progress value={uploadProgress} className="mt-3" />
          )}
          <small className="form-text text-muted d-block mt-2">
            {t('uploadHint')}
          </small>
        </CardBody>
      </Card>

      <Card className="border-0 shadow-sm mb-4" style={{ opacity: uploaded ? 1 : 0.5 }}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
            {t('step2Title')}
          </h5>

          <div className="row g-3">
            <div className="col-md-6">
              <Label htmlFor="pub-title-it">{t('titleIt')}</Label>
              <Input
                id="pub-title-it"
                type="text"
                value={titleIt}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setTitleIt(e.target.value)}
                disabled={!uploaded}
              />
            </div>
            <div className="col-md-6">
              <Label htmlFor="pub-title-en">{t('titleEn')}</Label>
              <Input
                id="pub-title-en"
                type="text"
                value={titleEn}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setTitleEn(e.target.value)}
                disabled={!uploaded}
              />
            </div>
            <div className="col-12">
              <Label htmlFor="pub-description">{t('description')}</Label>
              <textarea
                id="pub-description"
                className="form-control"
                rows={4}
                value={descriptionIt}
                onChange={(e) => setDescriptionIt(e.target.value)}
                disabled={!uploaded}
              />
            </div>
            <div className="col-md-6">
              <Label htmlFor="pub-date">{t('startsAt')}</Label>
              <input
                id="pub-date"
                type="datetime-local"
                className="form-control"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                disabled={!uploaded}
              />
            </div>
            <div className="col-md-6">
              <Label htmlFor="pub-organizer">{t('organizer')}</Label>
              <Input
                id="pub-organizer"
                type="text"
                value={organizer}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setOrganizer(e.target.value)}
                disabled={!uploaded}
              />
            </div>
            <div className="col-12">
              <Label htmlFor="pub-speakers">{t('speakers')}</Label>
              <Input
                id="pub-speakers"
                type="text"
                value={speakersIt}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSpeakersIt(e.target.value)}
                placeholder={t('speakersPlaceholder')}
                disabled={!uploaded}
              />
            </div>
            <div className="col-md-6">
              <Label htmlFor="pub-cover">{t('coverUrl')}</Label>
              <Input
                id="pub-cover"
                type="url"
                value={coverImageUrl}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCoverImageUrl(e.target.value)}
                placeholder={t('coverPlaceholder')}
                disabled={!uploaded}
              />
              <small className="form-text text-muted">{t('coverHint')}</small>
            </div>
            <div className="col-md-6">
              <Label htmlFor="pub-youtube">{t('youtubeUrl')}</Label>
              <Input
                id="pub-youtube"
                type="url"
                value={youtubeUrl}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                disabled={!uploaded}
              />
              <small className="form-text text-muted">{t('youtubeHint')}</small>
            </div>
            <div className="col-12">
              <div className="form-check">
                <input
                  id="pub-listed"
                  type="checkbox"
                  className="form-check-input"
                  checked={libraryListed}
                  onChange={(e) => setLibraryListed(e.target.checked)}
                  disabled={!uploaded}
                />
                <label htmlFor="pub-listed" className="form-check-label">
                  {t('libraryListed')}
                </label>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="d-flex gap-2">
        <Button
          color="primary"
          type="submit"
          disabled={!uploaded || phase === 'saving'}
        >
          {phase === 'saving' ? tc('saving') : t('save')}
        </Button>
        <Button
          color="secondary"
          outline
          type="button"
          onClick={() => router.push('/admin/publications')}
          disabled={phase === 'saving'}
        >
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}

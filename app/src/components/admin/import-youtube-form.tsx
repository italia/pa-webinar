'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Card, CardBody, Input, Label, Spinner } from 'design-react-kit';

import { useRouter } from '@/i18n/navigation';

interface OEmbedData {
  videoId: string;
  title: string | null;
  author: string | null;
  thumbnailUrl: string;
  thumbnails: {
    maxres: string;
    high: string;
    standard: string;
  };
  canonicalUrl: string;
}

export default function ImportYoutubeForm() {
  const t = useTranslations('admin.publications.importYoutubePage');
  const tc = useTranslations('common');
  const router = useRouter();

  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [preview, setPreview] = useState<OEmbedData | null>(null);

  const [titleIt, setTitleIt] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [descriptionIt, setDescriptionIt] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [organizer, setOrganizer] = useState('');
  const [speakersIt, setSpeakersIt] = useState('');
  const [coverThumb, setCoverThumb] = useState<keyof OEmbedData['thumbnails']>('high');
  const [libraryListed, setLibraryListed] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFetchPreview = useCallback(async () => {
    if (!url.trim()) return;
    setFetching(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/publications/import-youtube?url=${encodeURIComponent(url.trim())}`);
      if (!res.ok) {
        setError(t('errors.previewFailed'));
        return;
      }
      const data = (await res.json()) as OEmbedData;
      setPreview(data);
      if (!titleIt && data.title) setTitleIt(data.title);
      if (!organizer && data.author) setOrganizer(data.author);
    } catch {
      setError(t('errors.previewFailed'));
    } finally {
      setFetching(false);
    }
  }, [url, titleIt, organizer, t]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!preview) {
        setError(t('errors.previewFirst'));
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

      setSubmitting(true);
      setError(null);
      try {
        const startsAtIso = new Date(startsAt).toISOString();
        // Endpoint expects endsAt too — for an imported archive we pick
        // +1h as a reasonable default. Operators can tweak it afterwards
        // from the event detail page.
        const endsAtIso = new Date(new Date(startsAt).getTime() + 3600_000).toISOString();

        const titleObj: Record<string, string> = { it: titleIt.trim() };
        if (titleEn.trim()) titleObj.en = titleEn.trim();

        const descriptionObj: Record<string, string> = {
          it: descriptionIt.trim(),
        };
        const speakersObj: Record<string, string> = {};
        if (speakersIt.trim()) speakersObj.it = speakersIt.trim();

        const res = await fetch('/api/admin/publications/import-youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: titleObj,
            description: descriptionObj,
            startsAt: startsAtIso,
            endsAt: endsAtIso,
            youtubeUrl: preview.canonicalUrl,
            coverImageUrl: preview.thumbnails[coverThumb],
            speakersInfo: Object.keys(speakersObj).length > 0 ? speakersObj : undefined,
            organizerName: organizer.trim() || undefined,
            libraryListed,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? t('errors.saveFailed'));
          return;
        }
        router.push('/admin/publications');
      } finally {
        setSubmitting(false);
      }
    },
    [preview, titleIt, titleEn, descriptionIt, startsAt, organizer, speakersIt, coverThumb, libraryListed, router, t],
  );

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Card className="border-0 shadow-sm mb-4">
        <CardBody className="p-4">
          <Label htmlFor="yt-url" className="fw-semibold">
            {t('urlLabel')}
          </Label>
          <div className="d-flex gap-2 align-items-start">
            <Input
              id="yt-url"
              type="url"
              value={url}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
              placeholder={t('urlPlaceholder')}
              disabled={fetching}
            />
            <Button
              type="button"
              color="primary"
              onClick={handleFetchPreview}
              disabled={fetching || url.trim().length < 10}
              className="flex-shrink-0"
            >
              {fetching ? <Spinner active small /> : t('fetchPreview')}
            </Button>
          </div>
          <small className="form-text text-muted">{t('urlHint')}</small>
        </CardBody>
      </Card>

      {error && (
        <Alert color="danger" className="mb-3">
          {error}
        </Alert>
      )}

      {preview && (
        <>
          <Card className="border-0 shadow-sm mb-4">
            <CardBody className="p-4">
              <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
                {t('previewTitle')}
              </h5>
              <div className="row g-3">
                <div className="col-md-5">
                  <div
                    style={{
                      aspectRatio: '16/9',
                      backgroundImage: `url(${preview.thumbnails[coverThumb]})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      borderRadius: 8,
                    }}
                    aria-hidden="true"
                  />
                  <div className="mt-2 d-flex gap-2 flex-wrap">
                    {(['maxres', 'high', 'standard'] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        className={`btn btn-sm ${coverThumb === size ? 'btn-primary' : 'btn-outline-primary'}`}
                        onClick={() => setCoverThumb(size)}
                      >
                        {t(`thumb.${size}`)}
                      </button>
                    ))}
                  </div>
                  <small className="form-text text-muted">{t('thumb.hint')}</small>
                </div>
                <div className="col-md-7">
                  <div className="text-muted small mb-1">
                    {t('videoId')}: <code>{preview.videoId}</code>
                    {preview.author && (
                      <Badge color="info" pill className="ms-2" style={{ fontSize: '0.65rem' }}>
                        {preview.author}
                      </Badge>
                    )}
                  </div>
                  {preview.title && (
                    <div className="mb-2" style={{ fontSize: '0.9rem', color: '#17324D' }}>
                      {preview.title}
                    </div>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          <Card className="border-0 shadow-sm mb-4">
            <CardBody className="p-4">
              <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
                {t('metadataTitle')}
              </h5>

              <div className="row g-3">
                <div className="col-md-6">
                  <Label htmlFor="yt-title-it">{t('titleIt')}</Label>
                  <Input
                    id="yt-title-it"
                    type="text"
                    value={titleIt}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitleIt(e.target.value)}
                  />
                </div>
                <div className="col-md-6">
                  <Label htmlFor="yt-title-en">{t('titleEn')}</Label>
                  <Input
                    id="yt-title-en"
                    type="text"
                    value={titleEn}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitleEn(e.target.value)}
                  />
                </div>
                <div className="col-12">
                  <Label htmlFor="yt-description">{t('description')}</Label>
                  <textarea
                    id="yt-description"
                    className="form-control"
                    rows={4}
                    value={descriptionIt}
                    onChange={(e) => setDescriptionIt(e.target.value)}
                  />
                </div>
                <div className="col-md-6">
                  <Label htmlFor="yt-date">{t('startsAt')}</Label>
                  <input
                    id="yt-date"
                    type="datetime-local"
                    className="form-control"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                </div>
                <div className="col-md-6">
                  <Label htmlFor="yt-organizer">{t('organizer')}</Label>
                  <Input
                    id="yt-organizer"
                    type="text"
                    value={organizer}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOrganizer(e.target.value)}
                  />
                </div>
                <div className="col-12">
                  <Label htmlFor="yt-speakers">{t('speakers')}</Label>
                  <Input
                    id="yt-speakers"
                    type="text"
                    value={speakersIt}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSpeakersIt(e.target.value)}
                    placeholder={t('speakersPlaceholder')}
                  />
                </div>
                <div className="col-12">
                  <div className="form-check">
                    <input
                      id="yt-listed"
                      type="checkbox"
                      className="form-check-input"
                      checked={libraryListed}
                      onChange={(e) => setLibraryListed(e.target.checked)}
                    />
                    <label htmlFor="yt-listed" className="form-check-label">
                      {t('libraryListed')}
                    </label>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          <div className="d-flex gap-2">
            <Button color="primary" type="submit" disabled={submitting}>
              {submitting ? tc('saving') : t('save')}
            </Button>
            <Button
              color="secondary"
              outline
              type="button"
              onClick={() => router.push('/admin/publications')}
              disabled={submitting}
            >
              {tc('cancel')}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

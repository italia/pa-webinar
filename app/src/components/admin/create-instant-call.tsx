'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, FormGroup, Label, Alert, Spinner, Icon } from 'design-react-kit';

import { useRouter } from '@/i18n/navigation';

export default function CreateInstantCall() {
  const t = useTranslations('admin.instantCall');
  const tc = useTranslations('common');
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [moderatorName, setModeratorName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/events/instant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: { it: title.trim() },
          moderatorName: moderatorName.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? tc('error'));
        setLoading(false);
        return;
      }

      const data = await res.json();
      setShareLink(data.links.shareLink);
      router.push(`/eventi/${data.slug}/live?token=${data.moderatorToken}`);
    } catch {
      setError(tc('error'));
      setLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="p-4 rounded-3"
      style={{ backgroundColor: '#f8f9fa', border: '1px solid #e8e8e8' }}
    >
      <div className="d-flex align-items-center gap-2 mb-3">
        <div
          className="d-flex align-items-center justify-content-center rounded-2"
          style={{
            width: 40,
            height: 40,
            backgroundColor: 'rgba(0,135,88,0.1)',
            flexShrink: 0,
          }}
        >
          <Icon icon="it-video" size="sm" style={{ color: '#008758' }} />
        </div>
        <div>
          <h5 className="fw-semibold mb-0" style={{ color: '#17324D' }}>
            {t('title')}
          </h5>
          <p className="text-muted mb-0" style={{ fontSize: '0.85rem' }}>
            {t('subtitle')}
          </p>
        </div>
      </div>

      {error && (
        <Alert color="danger" className="mb-3">
          {error}
        </Alert>
      )}

      <FormGroup className="mb-3">
        <Label htmlFor="instant-title" className="fw-semibold" style={{ fontSize: '0.85rem' }}>
          {t('nameLabel')}
        </Label>
        <Input
          id="instant-title"
          type="text"
          value={title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          placeholder={t('namePlaceholder')}
          disabled={loading}
          maxLength={200}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') handleCreate();
          }}
        />
      </FormGroup>

      <FormGroup className="mb-3">
        <Label htmlFor="instant-moderator" className="fw-semibold" style={{ fontSize: '0.85rem' }}>
          {t('moderatorLabel')}
        </Label>
        <Input
          id="instant-moderator"
          type="text"
          value={moderatorName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setModeratorName(e.target.value)}
          placeholder={t('moderatorPlaceholder')}
          disabled={loading}
          maxLength={100}
        />
      </FormGroup>

      <div className="d-flex align-items-center gap-2">
        <Button
          color="primary"
          onClick={handleCreate}
          disabled={loading || !title.trim()}
          className="d-inline-flex align-items-center gap-2"
        >
          {loading ? (
            <>
              <Spinner active small />
              {t('creating')}
            </>
          ) : (
            <>
              <Icon icon="it-video" size="xs" color="white" />
              {t('create')}
            </>
          )}
        </Button>

        {shareLink && (
          <Button
            color="secondary"
            outline
            size="sm"
            onClick={handleCopyLink}
            className="d-inline-flex align-items-center gap-1"
          >
            <Icon icon="it-copy" size="xs" />
            {copied ? t('copied') : t('copyLink')}
          </Button>
        )}
      </div>

      <p className="text-muted mt-3 mb-0" style={{ fontSize: '0.78rem' }}>
        {t('hint')}
      </p>
    </div>
  );
}

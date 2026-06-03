'use client';

import { useState, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';

import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Icon,
  Input,
  FormGroup,
  Label,
  Badge,
  Spinner,
} from 'design-react-kit';

interface FileMaterial {
  id: string;
  title: string;
  fileName: string | null;
  fileSize: string | null;
  mimeType: string | null;
  visibility: string;
  createdAt: string;
}

interface FileManagementProps {
  eventId: string;
  moderatorToken: string;
  initialFiles?: FileMaterial[];
}

function formatFileSize(bytes: string | null): string {
  if (!bytes) return '—';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileManagement({
  eventId,
  moderatorToken,
  initialFiles = [],
}: FileManagementProps) {
  const t = useTranslations('admin.files');
  const tc = useTranslations('common');
  const confirm = useConfirm();

  const [files, setFiles] = useState<FileMaterial[]>(initialFiles);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadVisibility, setUploadVisibility] = useState('ALWAYS');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !uploadTitle) return;

    setUploading(true);
    setError('');

    try {
      const res = await fetch(`/api/events/${eventId}/files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({
          fileName: file.name,
          title: uploadTitle,
          mimeType: file.type,
          fileSize: file.size,
          visibility: uploadVisibility,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Upload failed');
      }

      const { material, uploadUrl } = await res.json();

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error('Failed to upload file to storage');
      }

      setFiles((prev) => [material, ...prev]);
      setShowUpload(false);
      setUploadTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setUploading(false);
    }
  }, [eventId, moderatorToken, uploadTitle, uploadVisibility]);

  const handleDelete = useCallback(
    async (materialId: string) => {
      const ok = await confirm({
        title: tc('delete'),
        message: t('deleteConfirm'),
        confirmLabel: tc('delete'),
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await fetch(
          `/api/events/${eventId}/files?materialId=${materialId}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${moderatorToken}` },
          },
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? 'Delete failed');
        }
        setFiles((prev) => prev.filter((f) => f.id !== materialId));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error');
      }
    },
    [eventId, moderatorToken, t, tc, confirm],
  );

  const visibilityLabel = (v: string) => {
    const map: Record<string, string> = {
      ALWAYS: t('visibilityAlways'),
      BEFORE: t('visibilityBefore'),
      DURING: t('visibilityDuring'),
      AFTER: t('visibilityAfter'),
    };
    return map[v] ?? v;
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardBody className="p-4">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h5 className="fw-semibold mb-0" style={{ color: 'var(--app-text)' }}>
            <Icon icon="it-files" size="sm" className="me-2" />
            {t('title')}
          </h5>
          <Button
            color="primary"
            outline
            size="sm"
            onClick={() => setShowUpload(!showUpload)}
            className="d-inline-flex align-items-center gap-1"
          >
            <Icon icon="it-upload" size="xs" />
            {t('upload')}
          </Button>
        </div>

        {error && (
          <Alert color="danger" className="mb-3">
            {error}
          </Alert>
        )}

        {showUpload && (
          <div
            className="p-3 rounded mb-3"
            style={{
              border: '2px dashed #0066CC',
              backgroundColor: '#f0f7ff',
            }}
          >
            <FormGroup className="mb-2">
              <Label htmlFor="file-input" className="small fw-semibold">
                {t('selectFile')}
              </Label>
              <input
                type="file"
                id="file-input"
                ref={fileInputRef}
                className="form-control form-control-sm"
              />
            </FormGroup>
            <FormGroup className="mb-2">
              <Input
                id="file-title"
                label={t('fileTitle')}
                value={uploadTitle}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setUploadTitle(e.target.value)
                }
                bsSize="sm"
              />
            </FormGroup>
            <FormGroup className="mb-3">
              <Label htmlFor="file-visibility" className="small">
                {t('visibility')}
              </Label>
              <select
                className="form-select form-select-sm"
                id="file-visibility"
                value={uploadVisibility}
                onChange={(e) => setUploadVisibility(e.target.value)}
              >
                <option value="ALWAYS">{t('visibilityAlways')}</option>
                <option value="BEFORE">{t('visibilityBefore')}</option>
                <option value="DURING">{t('visibilityDuring')}</option>
                <option value="AFTER">{t('visibilityAfter')}</option>
              </select>
            </FormGroup>
            <div className="d-flex gap-2">
              <Button
                color="primary"
                size="sm"
                onClick={handleUpload}
                disabled={uploading || !uploadTitle}
              >
                {uploading ? <Spinner active small className="me-1" /> : null}
                {uploading ? t('uploading') : t('uploadBtn')}
              </Button>
              <Button
                color="secondary"
                outline
                size="sm"
                onClick={() => setShowUpload(false)}
              >
                {tc('cancel')}
              </Button>
            </div>
          </div>
        )}

        {files.length === 0 ? (
          <p className="text-muted text-center py-3 mb-0">
            {t('noFiles')}
          </p>
        ) : (
          <div className="d-flex flex-column gap-2">
            {files.map((file) => (
              <div
                key={file.id}
                className="d-flex align-items-center justify-content-between p-3 rounded"
                style={{
                  backgroundColor: '#f8f9fa',
                  border: '1px solid #e8e8e8',
                }}
              >
                <div className="d-flex align-items-center gap-2">
                  <Icon icon="it-clip" size="sm" color="primary" />
                  <div>
                    <div className="fw-semibold" style={{ fontSize: '0.9rem' }}>
                      {file.title}
                    </div>
                    <div
                      className="text-muted d-flex gap-2"
                      style={{ fontSize: '0.75rem' }}
                    >
                      {file.fileName && <span>{file.fileName}</span>}
                      <span>{formatFileSize(file.fileSize)}</span>
                      <Badge
                        color="secondary"
                        style={{ fontSize: '0.65rem' }}
                      >
                        {visibilityLabel(file.visibility)}
                      </Badge>
                    </div>
                  </div>
                </div>
                <Button
                  color="danger"
                  outline
                  size="sm"
                  className="p-1"
                  onClick={() => handleDelete(file.id)}
                  title={tc('delete')}
                >
                  <Icon icon="it-delete" size="xs" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

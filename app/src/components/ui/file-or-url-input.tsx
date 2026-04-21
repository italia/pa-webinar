'use client';

/**
 * Reusable admin-form input for picking a resource that can be either
 * uploaded as a file or pasted as an external URL.
 *
 * The component is fully controlled: callers own the current URL in
 * `value` and receive updates via `onChange`. Nothing persists inside
 * the component — reload it and it reflects whatever URL its parent
 * form has in state.
 *
 * Upload mode calls POST /api/admin/assets/upload-url?type=... with a
 * multipart body containing the chosen file. On 2xx the response `url`
 * is handed to `onChange`.
 *
 * Icons: we inline SVGs rather than using <Icon /> from design-react-kit
 * because that component ships sprite refs that can hydrate differently
 * between server and client in some layouts (see MEMORY feedback on
 * design-react-kit Icon hydration mismatches).
 */

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { AssetUploadResponse } from '@/lib/validation/schemas';

export type FileOrUrlAssetType = 'image' | 'audio' | 'document';

export interface FileOrUrlInputProps {
  id: string;
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
  assetType: FileOrUrlAssetType;
  /** Override the native <input> accept attribute. */
  accept?: string;
  helpText?: string;
  disabled?: boolean;
  /** Kept for backwards-compat with earlier placeholder callers. */
  required?: boolean;
}

const DEFAULT_ACCEPT: Record<FileOrUrlAssetType, string> = {
  image: 'image/png,image/jpeg,image/webp,image/svg+xml,image/gif',
  audio: 'audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm',
  document:
    'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain',
};

function isValidUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

/** Tiny inline-SVG helper so we never ship the whole Bootstrap-Italia sprite. */
function InlineIcon({
  name,
  className,
}: {
  name: 'upload' | 'link' | 'delete' | 'file' | 'external';
  className?: string;
}) {
  const common = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
  switch (name) {
    case 'upload':
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      );
    case 'link':
      return (
        <svg {...common}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case 'delete':
      return (
        <svg {...common}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      );
    case 'file':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    case 'external':
      return (
        <svg {...common}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      );
  }
}

type Mode = 'upload' | 'url';

export default function FileOrUrlInput({
  id,
  label,
  value,
  onChange,
  assetType,
  accept,
  helpText,
  disabled,
  required,
}: FileOrUrlInputProps) {
  const t = useTranslations('admin.fileOrUrl');
  const reactId = useId();
  const fileInputId = `${id}-file-${reactId}`;
  const urlInputId = `${id}-url-${reactId}`;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>('upload');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState<string>(value ?? '');
  const [urlError, setUrlError] = useState<string | null>(null);

  const effectiveAccept = accept ?? DEFAULT_ACCEPT[assetType];
  const defaultHelp = useMemo(() => {
    if (helpText) return helpText;
    if (assetType === 'image') return t('helpImage');
    if (assetType === 'audio') return t('helpAudio');
    return t('helpDocument');
  }, [helpText, assetType, t]);

  const handleFileChosen = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(
          `/api/admin/assets/upload-url?type=${assetType}`,
          { method: 'POST', body: form },
        );
        if (!res.ok) {
          let message = t('errorGeneric');
          if (res.status === 413) message = t('errorSize');
          else if (res.status === 415) message = t('errorMime');
          else {
            try {
              const j = (await res.json()) as { error?: string };
              if (j?.error) message = j.error;
            } catch {
              /* ignore */
            }
          }
          setError(message);
          return;
        }
        const data = (await res.json()) as AssetUploadResponse;
        onChange(data.url);
      } catch {
        setError(t('errorGeneric'));
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [assetType, onChange, t],
  );

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFileChosen(file);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (disabled || uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFileChosen(file);
  };

  const commitUrl = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setUrlError(null);
      onChange(null);
      return;
    }
    if (!isValidUrl(trimmed)) {
      setUrlError(t('invalidUrl'));
      return;
    }
    setUrlError(null);
    onChange(trimmed);
  };

  const onUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setUrlDraft(raw);
    const trimmed = raw.trim();
    if (!trimmed) {
      setUrlError(null);
      onChange(null);
      return;
    }
    if (isValidUrl(trimmed)) {
      setUrlError(null);
      onChange(trimmed);
    } else {
      // Preserve the parent's previous committed value until the user
      // types a valid URL; only surface the error inline.
      setUrlError(t('invalidUrl'));
    }
  };

  const remove = () => {
    setError(null);
    setUrlDraft('');
    setUrlError(null);
    onChange(null);
  };

  const showPreview = !!value;

  return (
    <div className="file-or-url-input" data-testid={id}>
      <div className="d-block mb-2 fw-semibold">
        <label htmlFor={mode === 'upload' ? fileInputId : urlInputId}>
          {label}
          {required ? ' *' : ''}
        </label>
      </div>

      {/* Segmented control */}
      <div
        className="btn-group btn-group-sm mb-2"
        role="tablist"
        aria-label={label}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'upload'}
          className={`btn ${mode === 'upload' ? 'btn-primary' : 'btn-outline-primary'}`}
          onClick={() => setMode('upload')}
          disabled={disabled}
        >
          <InlineIcon name="upload" className="me-1" />
          {t('tabUpload')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'url'}
          className={`btn ${mode === 'url' ? 'btn-primary' : 'btn-outline-primary'}`}
          onClick={() => {
            setMode('url');
            setUrlDraft(value ?? '');
          }}
          disabled={disabled}
        >
          <InlineIcon name="link" className="me-1" />
          {t('tabUrl')}
        </button>
      </div>

      {mode === 'upload' && (
        <div
          className="border rounded p-3 bg-white"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={onDrop}
        >
          <label
            htmlFor={fileInputId}
            className="form-label small text-muted mb-2 d-block"
          >
            {t('uploadLabel')}
          </label>
          <input
            id={fileInputId}
            ref={fileInputRef}
            type="file"
            accept={effectiveAccept}
            onChange={onFileInputChange}
            disabled={disabled || uploading}
            className="form-control"
          />
          {uploading && (
            <div className="d-flex align-items-center gap-2 mt-2 text-primary small">
              <span
                className="spinner-border spinner-border-sm"
                role="status"
                aria-hidden="true"
              />
              {t('uploading')}
            </div>
          )}
          {defaultHelp && (
            <div className="form-text text-muted mt-2">{defaultHelp}</div>
          )}
          {error && (
            <div
              className="text-danger small mt-2"
              role="alert"
              aria-live="polite"
            >
              {error}
            </div>
          )}
        </div>
      )}

      {mode === 'url' && (
        <div className="border rounded p-3 bg-white">
          <label
            htmlFor={urlInputId}
            className="form-label small text-muted mb-2 d-block"
          >
            {t('urlLabel')}
          </label>
          <input
            id={urlInputId}
            type="url"
            className={`form-control${urlError ? ' is-invalid' : ''}`}
            placeholder={t('urlPlaceholder')}
            value={urlDraft}
            onChange={onUrlChange}
            onBlur={(e) => commitUrl(e.target.value)}
            disabled={disabled}
          />
          {urlError && (
            <div className="text-danger small mt-2" role="alert" aria-live="polite">
              {urlError}
            </div>
          )}
          {defaultHelp && !urlError && (
            <div className="form-text text-muted mt-2">{defaultHelp}</div>
          )}
        </div>
      )}

      {showPreview && (
        <div className="mt-3 p-2 border rounded bg-white d-flex align-items-center gap-3 flex-wrap">
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <div className="small text-muted mb-1">{t('preview')}</div>
            {assetType === 'image' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={value!}
                alt=""
                style={{
                  maxHeight: 96,
                  maxWidth: '100%',
                  borderRadius: 4,
                  objectFit: 'contain',
                }}
              />
            )}
            {assetType === 'audio' && (
              <audio controls src={value!} style={{ maxWidth: '100%' }} />
            )}
            {assetType === 'document' && (
              <a
                href={value!}
                target="_blank"
                rel="noopener noreferrer"
                className="d-inline-flex align-items-center gap-2 text-decoration-none"
              >
                <InlineIcon name="file" />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 360,
                    display: 'inline-block',
                  }}
                >
                  {filenameFromUrl(value!)}
                </span>
                <InlineIcon name="external" />
              </a>
            )}
          </div>
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            onClick={remove}
            disabled={disabled}
          >
            <InlineIcon name="delete" className="me-1" />
            {t('remove')}
          </button>
        </div>
      )}
    </div>
  );
}

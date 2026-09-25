'use client';

import { useState, useCallback, useEffect, useId, useRef, type FormEvent } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import useSWR from 'swr';
import { Button } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { useLivePush } from '@/hooks/use-live-state';
import {
  MATERIAL_FILE_MAX_BYTES,
  MATERIAL_FILE_MIME_TYPES,
  MATERIAL_FILES_PER_EVENT_MAX,
  MATERIAL_FILES_PER_EVENT_MAX_BYTES,
} from '@/lib/validation/materials';

import {
  checkMaterialFile,
  fetchMaterials,
  materialsListKey,
  uploadMaterialFile,
  type MaterialUploadError,
} from './material-request';

interface MaterialData {
  id: string;
  type: string;
  title: string;
  url: string;
  description: string | null;
  /** Peso in byte dei file caricati (type FILE); null per i link. */
  fileSize?: number | null;
  /** ALWAYS | BEFORE | DURING | AFTER. Il server filtra già per il pubblico;
   *  al moderatore, che vede tutto, serve a sapere cosa la sala NON vede. */
  visibility?: string;
  addedBy: string;
  createdAt: string;
}

interface MaterialPanelProps {
  eventSlug: string;
  token: string;
  isModerator: boolean;
}

type AddMode = 'link' | 'file';

/** I limiti in MB da mostrare nei testi, dalle stesse costanti del server. */
const MAX_MB = Math.round(MATERIAL_FILE_MAX_BYTES / (1024 * 1024));
const MAX_EVENT_MB = Math.round(MATERIAL_FILES_PER_EVENT_MAX_BYTES / (1024 * 1024));

export default function MaterialPanel({ eventSlug, token, isModerator }: MaterialPanelProps) {
  const t = useTranslations('materials');
  const tv = useTranslations('admin.materials');
  const format = useFormatter();

  // Etichetta per i materiali a visibilità limitata (null = sempre visibile).
  const visibilityLabel = (v: string | undefined): string | null => {
    if (v === 'BEFORE') return tv('visibilityBefore');
    if (v === 'DURING') return tv('visibilityDuring');
    if (v === 'AFTER') return tv('visibilityAfter');
    return null;
  };

  const fileSizeLabel = (bytes: number): string =>
    bytes >= 1024 * 1024
      ? format.number(bytes / (1024 * 1024), {
          style: 'unit',
          unit: 'megabyte',
          maximumFractionDigits: 1,
        })
      : format.number(Math.max(1, Math.round(bytes / 1024)), {
          style: 'unit',
          unit: 'kilobyte',
        });

  const pushLive = useLivePush();

  const { data, mutate } = useSWR<{ materials: MaterialData[]; uploadsEnabled?: boolean }>(
    // Il token parte per chiunque ne abbia uno (./material-request): al
    // moderatore allarga l'elenco, a tutti apre quello di un evento protetto
    // da password. I contrassegni qui sotto restano di chi conduce.
    materialsListKey(eventSlug, token),
    fetchMaterials,
    // Un materiale aggiunto o tolto arriva con l'avviso del canale della sala,
    // e così il cambio di stato dell'evento che cambia la fase (use-live-state).
    // Il giro periodico resta, più lento, per ciò che nessun avviso annuncia:
    // la fase che cambia con l'orario, senza un cambio di stato. Senza canale,
    // trenta secondi: i materiali cambiano due o tre volte per evento, e la
    // richiesta la ripete ogni partecipante.
    { refreshInterval: pushLive ? 120_000 : 30_000 },
  );

  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<AddMode>('link');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileHelpId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [titleMissing, setTitleMissing] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [listError, setListError] = useState('');
  // Esito di un'aggiunta o di una rimozione, per chi usa un lettore di schermo:
  // il modulo si chiude, e senza questo nulla direbbe che il file è entrato.
  const [announcement, setAnnouncement] = useState('');
  // Chiuso il modulo, il fuoco torna al pulsante che l'ha aperto invece di
  // cadere in cima alla pagina insieme al pulsante che lo chiudeva.
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const formWasOpen = useRef(false);
  useEffect(() => {
    if (formWasOpen.current && !showForm) addButtonRef.current?.focus();
    formWasOpen.current = showForm;
  }, [showForm]);

  const materials = data?.materials ?? [];
  // Il caricamento si offre solo se l'installazione ha uno storage per i file:
  // altrimenti il server risponderebbe 503 a ogni tentativo.
  const uploadsEnabled = data?.uploadsEnabled === true;
  const fileMode = uploadsEnabled && mode === 'file';

  const uploadErrorMessage = useCallback(
    (e: MaterialUploadError): string => {
      switch (e) {
        case 'fileTooLarge':
          return t('errors.fileTooLarge', { maxMb: MAX_MB });
        case 'fileTooLargeForServer':
          return t('errors.fileTooLargeForServer');
        case 'fileType':
          return t('errors.fileType');
        case 'uploadUnavailable':
          return t('errors.uploadUnavailable');
        case 'quotaExceeded':
          return t('errors.quotaExceeded', {
            maxFiles: MATERIAL_FILES_PER_EVENT_MAX,
            maxMb: MAX_EVENT_MB,
          });
        case 'uploadBusy':
          return t('errors.uploadBusy');
        default:
          return t('errors.uploadFailed');
      }
    },
    [t],
  );

  const resetForm = useCallback(() => {
    setTitle('');
    setUrl('');
    setDescription('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setError('');
    setTitleMissing(false);
  }, []);

  /** Un materiale è entrato: il modulo si chiude, la lista rilegge, lo si dice. */
  const materialAdded = useCallback(() => {
    resetForm();
    setShowForm(false);
    setListError('');
    setAnnouncement(t('materialAdded'));
    mutate();
  }, [resetForm, mutate, t]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError('');
      setTitleMissing(false);
      setAnnouncement('');

      if (fileMode) {
        if (!file) {
          setError(t('errors.fileMissing'));
          return;
        }
        const invalid = checkMaterialFile(file, MATERIAL_FILE_MIME_TYPES, MATERIAL_FILE_MAX_BYTES);
        if (invalid) {
          setError(uploadErrorMessage(invalid));
          return;
        }
        setSubmitting(true);
        try {
          const failed = await uploadMaterialFile(eventSlug, token, {
            file,
            title: title.trim(),
            description: description.trim(),
          });
          if (failed) {
            setError(uploadErrorMessage(failed));
            return;
          }
          materialAdded();
        } catch {
          setError(t('errors.uploadFailed'));
        } finally {
          setSubmitting(false);
        }
        return;
      }

      // Nel modo file il titolo è facoltativo, qui no: lo si dice e si torna
      // al campo, invece di un invio che non fa nulla.
      if (title.trim().length < 1) {
        setTitleMissing(true);
        setError(t('errors.titleMissing'));
        titleInputRef.current?.focus();
        return;
      }

      try {
        new URL(url.trim());
      } catch {
        setError(t('errors.urlInvalid'));
        return;
      }

      setSubmitting(true);
      try {
        const res = await fetch(`/api/events/${eventSlug}/materials`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: title.trim(),
            url: url.trim(),
            description: description.trim() || undefined,
          }),
        });

        if (!res.ok) {
          setError(t('errors.generic'));
          return;
        }

        materialAdded();
      } catch {
        setError(t('errors.generic'));
      } finally {
        setSubmitting(false);
      }
    },
    [fileMode, file, title, url, description, eventSlug, token, t, materialAdded, uploadErrorMessage],
  );

  const handleDelete = useCallback(
    async (materialId: string) => {
      if (!confirm(t('confirmDelete'))) return;
      setListError('');
      setAnnouncement('');

      try {
        const res = await fetch(`/api/events/${eventSlug}/materials/${materialId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        // 404: l'ha già tolto qualcun altro (un altro moderatore, l'area
        // admin). Il risultato chiesto c'è: non è un errore.
        if (res.ok || res.status === 404) setAnnouncement(t('materialDeleted'));
        else setListError(t('errors.deleteFailed'));
      } catch {
        setListError(t('errors.deleteFailed'));
      }
      mutate();
    },
    [eventSlug, token, t, mutate],
  );

  return (
    <div className="p-2">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="mb-0 fw-semibold" style={{ fontSize: '0.9rem' }}>
          {t('title')}
        </h6>
        {isModerator && !showForm && (
          <Button
            innerRef={addButtonRef}
            color="primary"
            outline
            size="xs"
            className="px-2 py-0"
            onClick={() => {
              setAnnouncement('');
              setShowForm(true);
            }}
          >
            + {t('addMaterial')}
          </Button>
        )}
      </div>

      {/* Add material form (moderator) */}
      {isModerator && showForm && (
        <form onSubmit={handleSubmit} className="border rounded p-2 mb-2">
          {uploadsEnabled && (
            <div className="btn-group w-100 mb-2" role="group" aria-label={t('modeLabel')}>
              {(['link', 'file'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`btn btn-xs py-1 ${mode === m ? 'btn-primary' : 'btn-outline-primary'}`}
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    // Il campo del file si smonta cambiando modo: un file scelto
                    // prima non deve partire senza che si veda.
                    setFile(null);
                    setError('');
                    setTitleMissing(false);
                  }}
                >
                  <Icon
                    icon={m === 'link' ? 'it-link' : 'it-upload'}
                    size="xs"
                    color={mode === m ? 'white' : 'primary'}
                    className="me-1"
                  />
                  {m === 'link' ? t('modeLink') : t('modeFile')}
                </button>
              ))}
            </div>
          )}
          <div className="mb-1">
            <input
              ref={titleInputRef}
              type="text"
              className={`form-control form-control-sm${titleMissing ? ' is-invalid' : ''}`}
              placeholder={fileMode ? t('titleOptional') : t('titleLabel')}
              aria-label={fileMode ? t('titleOptional') : t('titleLabel')}
              aria-invalid={titleMissing || undefined}
              aria-required={!fileMode}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleMissing) {
                  setTitleMissing(false);
                  setError('');
                }
              }}
              maxLength={300}
            />
          </div>
          {/* Chiavi distinte: il campo URL è controllato, quello del file no, e
              React non deve riusare lo stesso <input> passando dall'uno all'altro. */}
          {fileMode ? (
            <div key="file" className="mb-1">
              <input
                ref={fileInputRef}
                type="file"
                className="form-control form-control-sm"
                aria-label={t('fileLabel')}
                aria-describedby={fileHelpId}
                accept={MATERIAL_FILE_MIME_TYPES.join(',')}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError('');
                }}
              />
              <div id={fileHelpId} className="form-text" style={{ fontSize: '0.72rem' }}>
                {t('fileHelp', { maxMb: MAX_MB })}
              </div>
            </div>
          ) : (
            <div key="url" className="mb-1">
              <input
                type="url"
                className="form-control form-control-sm"
                placeholder={t('urlLabel')}
                aria-label={t('urlLabel')}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          )}
          <div className="mb-1">
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder={t('descriptionLabel')}
              aria-label={t('descriptionLabel')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>
          {error && (
            <div className="text-danger small mb-1" role="alert">
              {error}
            </div>
          )}
          <div className="d-flex gap-2">
            <Button color="primary" size="xs" type="submit" disabled={submitting}>
              {fileMode
                ? submitting
                  ? t('uploading')
                  : t('upload')
                : submitting
                  ? t('adding')
                  : t('add')}
            </Button>
            <Button
              color="secondary"
              outline
              size="xs"
              type="button"
              disabled={submitting}
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}

      {listError && (
        <div className="text-danger small mb-2" role="alert">
          {listError}
        </div>
      )}

      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>

      {/* Materials list */}
      {materials.length === 0 ? (
        <div className="text-center text-muted py-3" style={{ fontSize: '0.85rem' }}>
          {t('noMaterials')}
        </div>
      ) : (
        <div className="d-flex flex-column gap-2">
          {materials.map((m) => (
            <div key={m.id} className="border rounded p-2">
              <div className="d-flex justify-content-between align-items-start">
                <div style={{ minWidth: 0 }}>
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fw-semibold text-primary text-decoration-none d-inline-flex align-items-center gap-1"
                    style={{ fontSize: '0.85rem', wordBreak: 'break-word' }}
                  >
                    <Icon icon={m.type === 'FILE' ? 'it-download' : 'it-external-link'} size="xs" />
                    {m.title}
                  </a>
                  {m.type === 'FILE' && m.fileSize != null && (
                    <span className="text-muted ms-1" style={{ fontSize: '0.72rem' }}>
                      {fileSizeLabel(m.fileSize)}
                    </span>
                  )}
                  {m.description && (
                    <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                      {m.description}
                    </div>
                  )}
                  {isModerator && visibilityLabel(m.visibility) && (
                    <span className="badge bg-light text-dark border" style={{ fontSize: '0.68rem' }}>
                      {visibilityLabel(m.visibility)}
                    </span>
                  )}
                  <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                    {t('addedBy', { name: m.addedBy })} ·{' '}
                    {format.dateTime(new Date(m.createdAt), {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                {isModerator && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger border-0 flex-shrink-0 p-1"
                    onClick={() => handleDelete(m.id)}
                    aria-label={t('deleteMaterial')}
                  >
                    <Icon icon="it-close" size="xs" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useCallback, useEffect, useId, useRef, type FormEvent } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import useSWR from 'swr';
import { Button } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { useLivePush } from '@/hooks/use-live-state';
import { materialAuthorName } from '@/lib/events/material-author';
import {
  MATERIAL_KIND_ICON,
  MATERIAL_KIND_SHORT,
  materialKind,
  titleFromFileName,
} from '@/lib/materials/file-kind';
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
  /** Tipo verificato al caricamento (FILE): decide icona ed etichetta. */
  mimeType?: string | null;
  /** ALWAYS | BEFORE | DURING | AFTER. Il server filtra già per il pubblico;
   *  al moderatore, che vede tutto, serve a sapere cosa la sala NON vede. */
  visibility?: string;
  /** Il nome di chi l'ha aggiunto, o null quando la riga non ne porta uno
   *  (lib/events/material-author): allora si mostra una dicitura tradotta. */
  addedBy: string | null;
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

  // Quando il pubblico vede il materiale: chi conduce vede tutto l'elenco, e
  // ogni voce porta la propria fase. Anche il predefinito (ALWAYS, «in sala e
  // dopo l'evento»): prima dell'inizio il pubblico e i relatori non lo
  // vedono, e senza etichetta chi controlla la sala in anticipo non avrebbe
  // modo di accorgersene.
  const visibilityLabel = (v: string | undefined): string | null => {
    if (v === 'ALWAYS') return tv('visibilityAlways');
    if (v === 'BEFORE') return tv('visibilityBefore');
    if (v === 'DURING') return tv('visibilityDuring');
    if (v === 'AFTER') return tv('visibilityAfter');
    return null;
  };

  // «Aggiunto da …»: il nome quando la riga ne porta uno, altrimenti una
  // dicitura nella lingua di chi legge (mai una parola fissa del database).
  const authorLine = (addedBy: string | null): string => {
    const name = materialAuthorName(addedBy);
    return name ? t('addedBy', { name }) : t('addedByStaff');
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
  // Avanzamento del caricamento (0..1), null quando non si sta caricando.
  const [progress, setProgress] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Il titolo l'ha proposto il pannello dal nome del file (non l'ha scritto
  // chi carica): segue il file se lo si cambia o lo si toglie.
  const titleAutoRef = useRef(false);
  const fileInputId = useId();
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
    setProgress(null);
    titleAutoRef.current = false;
  }, []);

  /** Un file scelto o trascinato: si controlla subito, e il titolo si propone
   *  dal nome se chi carica non ne ha scritto uno. */
  const chooseFile = useCallback(
    (f: File | null) => {
      setError('');
      if (!f) {
        setFile(null);
        if (titleAutoRef.current) {
          setTitle('');
          titleAutoRef.current = false;
        }
        return;
      }
      const invalid = checkMaterialFile(f, MATERIAL_FILE_MIME_TYPES, MATERIAL_FILE_MAX_BYTES);
      if (invalid) {
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setError(uploadErrorMessage(invalid));
        return;
      }
      setFile(f);
      setTitle((cur) => {
        if (cur.trim() && !titleAutoRef.current) return cur;
        titleAutoRef.current = true;
        return titleFromFileName(f.name);
      });
    },
    [uploadErrorMessage],
  );

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
        setProgress(0);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          const failed = await uploadMaterialFile(eventSlug, token, {
            file,
            title: title.trim(),
            description: description.trim(),
          }, { onProgress: setProgress, signal: controller.signal });
          if (failed === 'aborted') {
            setAnnouncement(t('uploadCancelled'));
            // Se il server aveva gia' ricevuto tutto, il materiale puo' esserci
            // lo stesso: l'elenco lo dice.
            void mutate();
            return;
          }
          if (failed) {
            setError(uploadErrorMessage(failed));
            return;
          }
          materialAdded();
        } catch {
          setError(t('errors.uploadFailed'));
        } finally {
          abortRef.current = null;
          setSubmitting(false);
          setProgress(null);
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
    [fileMode, file, title, url, description, eventSlug, token, t, materialAdded, uploadErrorMessage, mutate],
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

  const percent = progress === null ? null : Math.round(progress * 100);
  const chosenKind = file
    ? materialKind({ type: 'FILE', mimeType: file.type, fileName: file.name })
    : null;

  return (
    <div className="material-panel">
      <div className="live-panel-header">
        <h6 className="live-panel-header__title">
          <Icon icon="it-clip" size="sm" aria-hidden="true" />
          {t('title')}
          {materials.length > 0 && (
            <span className="live-panel-header__count">{materials.length}</span>
          )}
        </h6>
        {isModerator && !showForm && (
          <Button
            innerRef={addButtonRef}
            color="primary"
            outline
            size="xs"
            className="px-2 py-1"
            onClick={() => {
              setAnnouncement('');
              setShowForm(true);
            }}
          >
            + {t('addMaterial')}
          </Button>
        )}
      </div>

      {/* Modulo di chi conduce: un link o un file */}
      {isModerator && showForm && (
        <form onSubmit={handleSubmit} className="material-panel__form">
          {uploadsEnabled && (
            <div className="material-panel__modes" role="group" aria-label={t('modeLabel')}>
              {(['link', 'file'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`material-panel__mode${mode === m ? ' is-active' : ''}`}
                  aria-pressed={mode === m}
                  disabled={submitting}
                  onClick={() => {
                    setMode(m);
                    // Il campo del file si smonta cambiando modo: un file scelto
                    // prima non deve partire senza che si veda (e il titolo
                    // proposto dal suo nome se ne va con lui).
                    chooseFile(null);
                    setError('');
                    setTitleMissing(false);
                  }}
                >
                  <Icon icon={m === 'link' ? 'it-link' : 'it-upload'} size="xs" aria-hidden="true" />
                  {m === 'link' ? t('modeLink') : t('modeFile')}
                </button>
              ))}
            </div>
          )}

          {/* Chiavi distinte: il campo URL è controllato, quello del file no, e
              React non deve riusare lo stesso <input> passando dall'uno all'altro. */}
          {fileMode ? (
            <div key="file" className="mb-2">
              {/* Il campo vero resta raggiungibile da tastiera (nascosto alla
                  vista, non al fuoco): l'area qui sotto e' la sua etichetta, un
                  clic la apre, e il fuoco sul campo la evidenzia. */}
              <input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                className="visually-hidden material-panel__file-input"
                aria-label={t('fileLabel')}
                aria-describedby={fileHelpId}
                accept={MATERIAL_FILE_MIME_TYPES.join(',')}
                onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <div className="material-panel__chosen">
                  <span className={`material-kind material-kind--${chosenKind}`} aria-hidden="true">
                    <Icon icon={MATERIAL_KIND_ICON[chosenKind ?? 'file']} size="sm" />
                  </span>
                  <span className="material-panel__chosen-name" title={file.name}>
                    {file.name}
                    <span className="material-panel__meta">{fileSizeLabel(file.size)}</span>
                  </span>
                  {!submitting && (
                    <button
                      type="button"
                      className="material-panel__icon-btn"
                      aria-label={t('removeFile')}
                      title={t('removeFile')}
                      onClick={() => chooseFile(null)}
                    >
                      <Icon icon="it-close" size="sm" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ) : (
                <label
                  htmlFor={fileInputId}
                  className={`material-panel__drop${dragOver ? ' is-over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    chooseFile(e.dataTransfer.files?.[0] ?? null);
                  }}
                >
                  <Icon icon="it-upload" size="sm" color="primary" aria-hidden="true" />
                  <span className="material-panel__drop-title">{t('dropzoneTitle')}</span>
                  <span className="material-panel__drop-choose">{t('dropzoneChoose')}</span>
                  <span className="material-panel__meta">{t('fileHelp', { maxMb: MAX_MB })}</span>
                </label>
              )}
              <span id={fileHelpId} className="visually-hidden">
                {t('fileHelp', { maxMb: MAX_MB })}
              </span>
            </div>
          ) : (
            <div key="url" className="mb-2">
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
          <div className="mb-2">
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
                titleAutoRef.current = false;
                if (titleMissing) {
                  setTitleMissing(false);
                  setError('');
                }
              }}
              maxLength={300}
            />
          </div>
          <div className="mb-2">
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
          {percent !== null && (
            <div className="material-panel__progress">
              <div
                className="progress"
                role="progressbar"
                aria-label={t('uploadProgress', { percent })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div className="progress-bar" style={{ width: `${percent}%` }} />
              </div>
              <span className="material-panel__meta">{t('uploadProgress', { percent })}</span>
            </div>
          )}
          {error && (
            <div className="material-panel__error" role="alert">
              {error}
            </div>
          )}
          <div className="d-flex gap-2">
            <Button color="primary" size="xs" type="submit" disabled={submitting} className="px-3">
              {fileMode
                ? submitting
                  ? t('uploading')
                  : t('upload')
                : submitting
                  ? t('adding')
                  : t('add')}
            </Button>
            {submitting && fileMode ? (
              <Button
                color="secondary"
                outline
                size="xs"
                type="button"
                className="px-3"
                // Inviato tutto, il server sta gia' salvando: annullare non
                // fermerebbe piu' nulla.
                disabled={progress !== null && progress >= 1}
                onClick={() => abortRef.current?.abort()}
              >
                {t('cancelUpload')}
              </Button>
            ) : (
              <Button
                color="secondary"
                outline
                size="xs"
                type="button"
                className="px-3"
                disabled={submitting}
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
              >
                {t('cancel')}
              </Button>
            )}
          </div>
        </form>
      )}

      {listError && (
        <div className="material-panel__error mb-2" role="alert">
          {listError}
        </div>
      )}

      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>

      {materials.length === 0 ? (
        <div className="live-panel-empty">
          <span className="live-panel-empty__icon" aria-hidden="true">
            <Icon icon="it-clip" size="lg" />
          </span>
          <p className="live-panel-empty__title">{t('noMaterials')}</p>
          <p className="live-panel-empty__hint">
            {isModerator ? t('emptyHintModerator') : t('emptyHintPublic')}
          </p>
        </div>
      ) : (
        <ul className="material-panel__list">
          {materials.map((m) => {
            const kind = materialKind(m);
            const meta = [
              kind !== 'link' ? MATERIAL_KIND_SHORT[kind] : null,
              m.type === 'FILE' && m.fileSize != null ? fileSizeLabel(m.fileSize) : null,
            ].filter(Boolean);
            return (
              <li key={m.id} className="material-item">
                <span className={`material-kind material-kind--${kind}`} aria-hidden="true">
                  <Icon icon={MATERIAL_KIND_ICON[kind]} size="sm" />
                </span>
                <div className="material-item__body">
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="material-item__title"
                  >
                    {m.title}
                    <span className="visually-hidden"> ({kind === 'link' ? t('open') : t('download')})</span>
                  </a>
                  {m.description && <div className="material-item__desc">{m.description}</div>}
                  <div className="material-panel__meta">
                    {meta.length > 0 && <>{meta.join(' · ')} · </>}
                    {authorLine(m.addedBy)} ·{' '}
                    {format.dateTime(new Date(m.createdAt), {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                  {isModerator && visibilityLabel(m.visibility) && (
                    <span className="material-item__badge">{visibilityLabel(m.visibility)}</span>
                  )}
                </div>
                <div className="material-item__actions">
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="material-panel__icon-btn"
                    aria-label={`${kind === 'link' ? t('open') : t('download')}: ${m.title}`}
                    title={kind === 'link' ? t('open') : t('download')}
                  >
                    <Icon icon={kind === 'link' ? 'it-external-link' : 'it-download'} size="sm" aria-hidden="true" />
                  </a>
                  {isModerator && (
                    <button
                      type="button"
                      className="material-panel__icon-btn material-panel__icon-btn--danger"
                      onClick={() => handleDelete(m.id)}
                      aria-label={t('deleteMaterial')}
                      title={t('deleteMaterial')}
                    >
                      <Icon icon="it-delete" size="sm" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

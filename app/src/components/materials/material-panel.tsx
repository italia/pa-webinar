'use client';

import { useState, useCallback, useEffect, useId, useRef, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import { Button } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { useLivePush } from '@/hooks/use-live-state';
import { MATERIAL_KIND_ICON, materialKind, titleFromFileName } from '@/lib/materials/file-kind';
import {
  MATERIAL_FILE_MAX_BYTES,
  MATERIAL_FILE_MIME_TYPES,
  MATERIAL_FILES_PER_EVENT_MAX,
  MATERIAL_FILES_PER_EVENT_MAX_BYTES,
} from '@/lib/validation/materials';

import MaterialItem, { MaterialVisibilitySelect, useMaterialFormat } from './material-item';
import {
  checkMaterialFile,
  fetchMaterials,
  markMaterialOpened,
  materialsListKey,
  uploadMaterialFile,
  type MaterialPatch,
  type MaterialUploadError,
  type RoomMaterial,
} from './material-request';

interface MaterialPanelProps {
  eventSlug: string;
  token: string;
  isModerator: boolean;
}

type AddMode = 'link' | 'file';

/** Quali voci mostra l'elenco: tutte, solo i file caricati, solo i link. */
type MaterialFilter = 'all' | 'file' | 'link';

/**
 * Da quante voci in su, se ci sono sia file sia link, l'elenco offre il filtro:
 * con poche voci basta scorrerle, e un filtro sarebbe solo rumore.
 */
const FILTER_MIN_ITEMS = 5;

/** Quanto resta armato «Elimina» in attesa della conferma, come nel resto della sala. */
const DELETE_ARM_MS = 4_000;

/** I limiti in MB da mostrare nei testi, dalle stesse costanti del server. */
const MAX_MB = Math.round(MATERIAL_FILE_MAX_BYTES / (1024 * 1024));
const MAX_EVENT_MB = Math.round(MATERIAL_FILES_PER_EVENT_MAX_BYTES / (1024 * 1024));

export default function MaterialPanel({ eventSlug, token, isModerator }: MaterialPanelProps) {
  const t = useTranslations('materials');
  const tf = useTranslations('materials.filter');
  const { fileSizeLabel } = useMaterialFormat();

  const pushLive = useLivePush();

  const { data, mutate } = useSWR<{ materials: RoomMaterial[]; uploadsEnabled?: boolean }>(
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
  // Quando il pubblico lo vede: il predefinito è quello del server.
  const [visibility, setVisibility] = useState<string>('ALWAYS');
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

  // «Elimina» armato (un solo materiale alla volta): il primo clic arma, il
  // secondo conferma; da solo si disarma dopo qualche secondo. Armato, lo si
  // annuncia: il cambio di nome del pulsante che ha il fuoco la maggior parte
  // dei lettori di schermo non lo legge.
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const armedAnnouncementRef = useRef('');
  useEffect(() => {
    if (!armedDelete) return;
    const timer = setTimeout(() => {
      setArmedDelete(null);
      // Disarmato, la richiesta di conferma non vale più: si toglie, e un
      // nuovo armo dello stesso materiale si annuncia di nuovo.
      setAnnouncement((cur) => (cur === armedAnnouncementRef.current ? '' : cur));
    }, DELETE_ARM_MS);
    return () => clearTimeout(timer);
  }, [armedDelete]);
  // Tolto un materiale, il fuoco non deve cadere in cima alla pagina con la
  // sua riga: va al titolo della voce seguente, altrimenti al pulsante per
  // aggiungere, altrimenti al titolo del pannello. Si sposta quando l'elenco
  // riletto non contiene più la voce tolta.
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterDeleteRef = useRef<{ deletedId: string; nextId: string | null } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Il link appena copiato: la sua icona dice «fatto» per un attimo.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedId) return;
    const timer = setTimeout(() => setCopiedId(null), 2_000);
    return () => clearTimeout(timer);
  }, [copiedId]);
  const [filter, setFilter] = useState<MaterialFilter>('all');

  const materials = data?.materials ?? [];

  useEffect(() => {
    const dopo = focusAfterDeleteRef.current;
    if (!dopo || !data || data.materials.some((x) => x.id === dopo.deletedId)) return;
    focusAfterDeleteRef.current = null;
    const riga = dopo.nextId
      ? Array.from(panelRef.current?.querySelectorAll<HTMLElement>('li[data-material-id]') ?? []).find(
          (li) => li.dataset.materialId === dopo.nextId,
        )
      : undefined;
    const titolo = riga?.querySelector<HTMLElement>('.material-item__title');
    if (titolo) {
      titolo.focus();
    } else if (addButtonRef.current) {
      addButtonRef.current.focus();
    } else if (headingRef.current) {
      // Il titolo non è un controllo: diventa raggiungibile solo per questo.
      headingRef.current.setAttribute('tabindex', '-1');
      headingRef.current.focus();
    }
  }, [data]);

  const fileCount = materials.filter((m) => m.type === 'FILE').length;
  const linkCount = materials.length - fileCount;
  // Il filtro c'è solo quando serve; quando sparisce (un genere è rimasto
  // senza voci) l'elenco torna completo, non resta filtrato su un vuoto.
  const showFilter = fileCount > 0 && linkCount > 0 && materials.length >= FILTER_MIN_ITEMS;
  const activeFilter: MaterialFilter = showFilter ? filter : 'all';
  const shown =
    activeFilter === 'all'
      ? materials
      : materials.filter((m) => (m.type === 'FILE') === (activeFilter === 'file'));
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
    setVisibility('ALWAYS');
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
            visibility,
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
            visibility,
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
    [fileMode, file, title, url, description, visibility, eventSlug, token, t, materialAdded, uploadErrorMessage, mutate],
  );

  const handleDelete = useCallback(
    async (materialId: string) => {
      setListError('');
      setAnnouncement('');

      try {
        const res = await fetch(`/api/events/${eventSlug}/materials/${materialId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        // 404: l'ha già tolto qualcun altro (un altro moderatore, l'area
        // admin). Il risultato chiesto c'è: non è un errore.
        if (res.ok || res.status === 404) {
          setAnnouncement(t('materialDeleted'));
        } else {
          // La riga resta, e il fuoco con lei.
          focusAfterDeleteRef.current = null;
          setListError(t('errors.deleteFailed'));
        }
      } catch {
        focusAfterDeleteRef.current = null;
        setListError(t('errors.deleteFailed'));
      }
      mutate();
    },
    [eventSlug, token, t, mutate],
  );

  /** Primo clic: arma e lo annuncia. Secondo, sullo stesso materiale: toglie. */
  const handleDeleteClick = useCallback(
    (m: RoomMaterial, nextId: string | null) => {
      if (armedDelete !== m.id) {
        const avviso = `${t('deleteMaterial')}: ${m.title}. ${t('confirmDelete')}`;
        armedAnnouncementRef.current = avviso;
        setAnnouncement(avviso);
        setArmedDelete(m.id);
        return;
      }
      setArmedDelete(null);
      focusAfterDeleteRef.current = { deletedId: m.id, nextId };
      void handleDelete(m.id);
    },
    [armedDelete, handleDelete, t],
  );

  /** Salva una correzione: null se è andata, altrimenti il messaggio per il modulo. */
  const handleSave = useCallback(
    async (materialId: string, patch: MaterialPatch): Promise<string | null> => {
      setListError('');
      setAnnouncement('');
      try {
        const res = await fetch(`/api/events/${eventSlug}/materials/${materialId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(patch),
        });
        if (res.ok) {
          setEditingId(null);
          setAnnouncement(t('materialUpdated'));
          void mutate();
          return null;
        }
        if (res.status === 404) {
          // Tolto da qualcun altro mentre lo si correggeva: il modulo se ne va
          // con la riga, e l'errore resta sopra l'elenco.
          setEditingId(null);
          setListError(t('errors.updateFailed'));
          void mutate();
          return null;
        }
        return t('errors.updateFailed');
      } catch {
        return t('errors.updateFailed');
      }
    },
    [eventSlug, token, t, mutate],
  );

  const handleCopy = useCallback(
    async (m: RoomMaterial) => {
      setListError('');
      setAnnouncement('');
      try {
        await navigator.clipboard.writeText(m.url);
        setCopiedId(m.id);
        setAnnouncement(t('linkCopied'));
      } catch {
        // Contesto non sicuro o permesso negato: lo si dice, l'indirizzo resta
        // raggiungibile dal link stesso.
        setListError(t('errors.copyFailed'));
      }
    },
    [t],
  );

  const percent = progress === null ? null : Math.round(progress * 100);
  const chosenKind = file
    ? materialKind({ type: 'FILE', mimeType: file.type, fileName: file.name })
    : null;

  return (
    <div className="material-panel" ref={panelRef}>
      <div className="live-panel-header">
        <h6 className="live-panel-header__title" ref={headingRef}>
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
          <MaterialVisibilitySelect value={visibility} onChange={setVisibility} disabled={submitting} />
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
        <>
          {showFilter && (
            <div className="material-panel__filters" role="group" aria-label={tf('label')}>
              {(
                [
                  ['all', tf('all'), materials.length],
                  ['file', tf('files'), fileCount],
                  ['link', tf('links'), linkCount],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  className={`material-panel__filter${activeFilter === key ? ' is-active' : ''}`}
                  aria-pressed={activeFilter === key}
                  onClick={() => setFilter(key)}
                >
                  {label}
                  <span className="material-panel__filter-count">{count}</span>
                </button>
              ))}
            </div>
          )}
          <ul className="material-panel__list">
            {shown.map((m, i) => (
              <MaterialItem
                key={m.id}
                material={m}
                isModerator={isModerator}
                onOpen={() => markMaterialOpened(eventSlug, m.id, token || undefined)}
                deleteArmed={armedDelete === m.id}
                onDeleteClick={() => handleDeleteClick(m, shown[i + 1]?.id ?? null)}
                copied={copiedId === m.id}
                onCopy={() => void handleCopy(m)}
                editing={editingId === m.id}
                onEdit={() => {
                  setArmedDelete(null);
                  setAnnouncement('');
                  setEditingId(m.id);
                }}
                onCancelEdit={() => setEditingId(null)}
                onSave={(patch) => handleSave(m.id, patch)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

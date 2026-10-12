'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { materialAuthorName } from '@/lib/events/material-author';
import {
  MATERIAL_KIND_ICON,
  MATERIAL_KIND_SHORT,
  materialHost,
  materialKind,
} from '@/lib/materials/file-kind';
import { MATERIAL_VISIBILITIES } from '@/lib/validation/materials';

import {
  materialOpenHandlers,
  materialPatch,
  type MaterialPatch,
  type RoomMaterial,
} from './material-request';

/**
 * Come si leggono peso, ora e fase di un materiale, nella lingua di chi
 * guarda. Condiviso fra la riga dell'elenco e il modulo di caricamento.
 */
export function useMaterialFormat() {
  const tv = useTranslations('admin.materials');
  const format = useFormatter();

  const fileSizeLabel = useCallback(
    (bytes: number): string =>
      bytes >= 1024 * 1024
        ? format.number(bytes / (1024 * 1024), {
            style: 'unit',
            unit: 'megabyte',
            maximumFractionDigits: 1,
          })
        : format.number(Math.max(1, Math.round(bytes / 1024)), {
            style: 'unit',
            unit: 'kilobyte',
          }),
    [format],
  );

  // Solo l'ora per ciò che è arrivato oggi (il caso della diretta); anche il
  // giorno per ciò che era stato preparato prima, che altrimenti sembrerebbe
  // aggiunto adesso.
  const whenLabel = useCallback(
    (iso: string): string => {
      const d = new Date(iso);
      const giorno = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;
      const oggi = format.dateTime(d, giorno) === format.dateTime(new Date(), giorno);
      return format.dateTime(
        d,
        oggi
          ? { hour: '2-digit', minute: '2-digit' }
          : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
      );
    },
    [format],
  );

  // Quando il pubblico vede il materiale: chi conduce vede tutto l'elenco, e
  // ogni voce porta la propria fase. Anche il predefinito (ALWAYS, «in sala e
  // dopo l'evento»): prima dell'inizio il pubblico e i relatori non lo
  // vedono, e senza etichetta chi controlla la sala in anticipo non avrebbe
  // modo di accorgersene.
  const visibilityLabel = useCallback(
    (v: string | undefined): string | null => {
      if (v === 'ALWAYS') return tv('visibilityAlways');
      if (v === 'BEFORE') return tv('visibilityBefore');
      if (v === 'DURING') return tv('visibilityDuring');
      if (v === 'AFTER') return tv('visibilityAfter');
      return null;
    },
    [tv],
  );

  return { fileSizeLabel, whenLabel, visibilityLabel };
}

/** La scelta della fase in cui il pubblico vede il materiale, con la sua etichetta. */
export function MaterialVisibilitySelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const tv = useTranslations('admin.materials');
  const { visibilityLabel } = useMaterialFormat();
  const id = useId();
  return (
    <div className="material-panel__field">
      <label htmlFor={id} className="material-panel__label">
        {tv('visibilityLabel')}
      </label>
      <select
        id={id}
        className="form-select form-select-sm"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {MATERIAL_VISIBILITIES.map((v) => (
          <option key={v} value={v}>
            {visibilityLabel(v)}
          </option>
        ))}
      </select>
    </div>
  );
}

interface MaterialItemProps {
  material: RoomMaterial;
  isModerator: boolean;
  /** Il link è stato aperto (clic o clic centrale): per il conteggio. */
  onOpen: () => void;
  /** Il pannello tiene armato un solo «Elimina» alla volta. */
  deleteArmed: boolean;
  onDeleteClick: () => void;
  /** «Copiato» appena riuscito, per un attimo sull'icona. */
  copied: boolean;
  onCopy: () => void;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  /** Salva le modifiche: il messaggio d'errore da mostrare nel modulo, o null. */
  onSave: (patch: MaterialPatch) => Promise<string | null>;
}

/**
 * Una voce dell'elenco dei materiali della sala: genere, titolo, descrizione,
 * dove porta (tipo e peso del file, o il sito del link), chi l'ha aggiunta e
 * quando. A chi conduce anche la fase in cui il pubblico la vede, quante
 * volte è stata aperta e gli strumenti per copiarla, correggerla o toglierla.
 */
export default function MaterialItem({
  material: m,
  isModerator,
  onOpen,
  deleteArmed,
  onDeleteClick,
  copied,
  onCopy,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
}: MaterialItemProps) {
  const t = useTranslations('materials');
  const tv = useTranslations('admin.materials');
  const tc = useTranslations('common');
  const { fileSizeLabel, whenLabel, visibilityLabel } = useMaterialFormat();

  // Chiusa la modifica, il fuoco torna al pulsante che l'ha aperta invece di
  // cadere in cima alla pagina insieme al modulo.
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButtonRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const kind = materialKind(m);
  const isLink = kind === 'link';
  const actionLabel = isLink ? t('open') : t('download');
  const meta = isLink
    ? materialHost(m.url)
    : [MATERIAL_KIND_SHORT[kind], m.fileSize != null ? fileSizeLabel(m.fileSize) : null]
        .filter(Boolean)
        .join(' · ');
  const name = materialAuthorName(m.addedBy);
  const author = name ? t('addedBy', { name }) : t('addedByStaff');
  const phase = isModerator ? visibilityLabel(m.visibility) : null;
  const open = materialOpenHandlers(onOpen);

  return (
    <li className={`material-item${editing ? ' is-editing' : ''}`} data-material-id={m.id}>
      <div className="material-item__main">
        <span className={`material-kind material-kind--${kind}`} aria-hidden="true">
          <Icon icon={MATERIAL_KIND_ICON[kind]} size="sm" />
        </span>
        {editing ? (
          <MaterialEditForm material={m} onCancel={onCancelEdit} onSave={onSave} />
        ) : (
          <>
            <div className="material-item__body">
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="material-item__title"
                {...open}
              >
                {m.title}
                <span className="visually-hidden"> ({actionLabel})</span>
              </a>
              {m.description && <p className="material-item__desc">{m.description}</p>}
              {meta && (
                <div className="material-item__meta" title={isLink ? m.url : undefined}>
                  {meta}
                </div>
              )}
              <div className="material-item__byline">
                {author} · <time dateTime={m.createdAt}>{whenLabel(m.createdAt)}</time>
              </div>
            </div>
            <a
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              className="material-panel__icon-btn material-item__open"
              aria-label={`${actionLabel}: ${m.title}`}
              title={actionLabel}
              {...open}
            >
              <Icon icon={isLink ? 'it-external-link' : 'it-download'} size="sm" aria-hidden="true" />
            </a>
          </>
        )}
      </div>

      {isModerator && !editing && (
        <div className="material-item__tools">
          {phase && <span className="material-item__badge">{phase}</span>}
          {typeof m.openCount === 'number' && (
            <span className="material-item__count">
              {isLink
                ? t('openCount', { count: m.openCount })
                : t('downloadCount', { count: m.openCount })}
            </span>
          )}
          <span className="material-item__tools-spacer" />
          {isLink && (
            <button
              type="button"
              className={`material-panel__icon-btn${copied ? ' is-done' : ''}`}
              onClick={onCopy}
              aria-label={`${t('copyLink')}: ${m.title}`}
              title={t('copyLink')}
            >
              <Icon icon={copied ? 'it-check' : 'it-copy'} size="sm" aria-hidden="true" />
            </button>
          )}
          <button
            ref={editButtonRef}
            type="button"
            className="material-panel__icon-btn"
            onClick={onEdit}
            aria-label={`${tv('editButton')}: ${m.title}`}
            title={tv('editButton')}
          >
            <Icon icon="it-pencil" size="sm" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`material-panel__icon-btn material-panel__icon-btn--danger${
              deleteArmed ? ' is-armed' : ''
            }`}
            onClick={onDeleteClick}
            aria-label={
              deleteArmed
                ? `${t('deleteMaterial')}: ${m.title} — ${tc('confirm')}`
                : `${t('deleteMaterial')}: ${m.title}`
            }
            title={t('deleteMaterial')}
          >
            <Icon icon="it-delete" size="sm" aria-hidden="true" />
            {deleteArmed && <span>{tc('confirm')}</span>}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * La correzione di un materiale al suo posto nell'elenco: titolo, descrizione
 * e fase, con gli stessi limiti dell'aggiunta. Esc annulla.
 */
function MaterialEditForm({
  material,
  onCancel,
  onSave,
}: {
  material: RoomMaterial;
  onCancel: () => void;
  onSave: (patch: MaterialPatch) => Promise<string | null>;
}) {
  const t = useTranslations('materials');
  const tv = useTranslations('admin.materials');
  const [title, setTitle] = useState(material.title);
  const [description, setDescription] = useState(material.description ?? '');
  const [visibility, setVisibility] = useState(material.visibility ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [titleMissing, setTitleMissing] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title.trim()) {
      setTitleMissing(true);
      setError(t('errors.editTitleMissing'));
      titleRef.current?.focus();
      return;
    }
    const patch = materialPatch(material, { title, description, visibility });
    if (!patch) {
      onCancel();
      return;
    }
    setSaving(true);
    try {
      const failed = await onSave(patch);
      if (failed) setError(failed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="material-item__edit"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !saving) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <input
        ref={titleRef}
        type="text"
        className={`form-control form-control-sm${titleMissing ? ' is-invalid' : ''}`}
        placeholder={t('titleLabel')}
        aria-label={t('titleLabel')}
        aria-invalid={titleMissing || undefined}
        aria-required
        value={title}
        maxLength={300}
        onChange={(e) => {
          setTitle(e.target.value);
          if (titleMissing) {
            setTitleMissing(false);
            setError('');
          }
        }}
      />
      <input
        type="text"
        className="form-control form-control-sm"
        placeholder={t('descriptionLabel')}
        aria-label={t('descriptionLabel')}
        value={description}
        maxLength={500}
        onChange={(e) => setDescription(e.target.value)}
      />
      <MaterialVisibilitySelect value={visibility} onChange={setVisibility} disabled={saving} />
      {error && (
        <div className="material-panel__error" role="alert">
          {error}
        </div>
      )}
      <div className="d-flex gap-2">
        <Button color="primary" size="xs" type="submit" disabled={saving} className="px-3">
          {tv('saveButton')}
        </Button>
        <Button
          color="secondary"
          outline
          size="xs"
          type="button"
          className="px-3"
          disabled={saving}
          onClick={onCancel}
        >
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

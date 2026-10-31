'use client';

/**
 * La foto di una persona dell'evento nel wizard: la persona la manda a chi
 * organizza, che la carica qui. Si sceglie un file, si ritaglia sempre in un
 * quadrato con il cerchio in cui la mostra la pagina pubblica, e il ritaglio
 * va al server (/api/admin/person-photos), che lo ricodifica e restituisce
 * l'id da salvare sulla persona. Niente indirizzi di altri siti: solo file.
 *
 * Il caricamento chiede una sessione dello staff: chi modifica l'evento con
 * il solo link di conduzione vede la foto ma non la cambia (`readOnly`).
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import PersonPhoto from '@/components/events/person-photo';
import ImageCropDialog, { type Ritaglio } from '@/components/ui/image-crop-dialog';
import { PERSON_PHOTO_SIDE, personPhotoPath } from '@/lib/events/person-photo';

const TIPI = ['image/jpeg', 'image/png', 'image/webp'];

const RITAGLIO: Ritaglio = {
  rapporto: 1,
  larghezza: PERSON_PHOTO_SIDE,
  forma: 'cerchio',
  nome: 'foto',
};

/**
 * La foto di una persona in un cerchio, o le sue iniziali. Accanto al nome è
 * decorativa: chi legge lo schermo trova già il nome lì vicino. Una foto che
 * l'indirizzo non serve (con il solo link di conduzione, quella di chi non è
 * nella pagina pubblica) lascia le iniziali.
 */
export function PersonAvatar({
  name,
  photoId,
  size = 40,
  alt = '',
}: {
  name: string;
  photoId: string | null | undefined;
  size?: number;
  /** Il testo alternativo quando la foto non è accanto al nome. */
  alt?: string;
}) {
  const stile = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  return (
    <PersonPhoto
      src={photoId ? personPhotoPath(photoId) : null}
      name={name}
      size={size}
      alt={alt}
      className="person-avatar"
      initialsClassName="person-avatar person-avatar--iniziali"
      style={stile}
    />
  );
}

export default function PersonPhotoField({
  id,
  name,
  photoId,
  onChange,
  readOnly = false,
  compact = false,
  onBusy,
}: {
  id: string;
  /** Il nome della persona: iniziali, testo alternativo, etichette. */
  name: string;
  photoId: string | null | undefined;
  onChange: (photoId: string | null) => void;
  /** Senza sessione dello staff: la foto si vede, non si cambia. */
  readOnly?: boolean;
  /** Nella riga di una persona già in elenco: solo i pulsanti (la foto è
   *  accanto al nome). */
  compact?: boolean;
  /** Mentre la foto va al server (true) e quando ha finito (false): chi usa
   *  il campo può aspettarla prima di salvare la persona. */
  onBusy?: (inCaricamento: boolean) => void;
}) {
  const t = useTranslations('admin.wizard.step3');
  const inputRef = useRef<HTMLInputElement>(null);
  const helpId = useId();
  const [scelto, setScelto] = useState<File | null>(null);
  const [inviando, setInviando] = useState(false);
  const [messaggio, setMessaggio] = useState<{
    tipo: 'ok' | 'errore';
    testo: string;
  } | null>(null);
  const nome = name.trim();
  // Il caricamento dura qualche istante: alla fine vale il modulo di quel
  // momento, non quello di quando si e' scelto il file (chi compila puo'
  // aver scritto altro nel frattempo). Una riga tolta non riceve la foto.
  const avvisa = useRef(onChange);
  const montato = useRef(true);
  useEffect(() => {
    avvisa.current = onChange;
  }, [onChange]);
  useEffect(() => {
    montato.current = true;
    return () => {
      montato.current = false;
    };
  }, []);
  // Il caricamento in corso, a chi usa il campo: finisce anche se il campo
  // esce dal modulo prima della risposta.
  const occupato = useRef(onBusy);
  useEffect(() => {
    occupato.current = onBusy;
  }, [onBusy]);
  useEffect(() => {
    if (!inviando) return;
    const avvisaOccupato = occupato.current;
    avvisaOccupato?.(true);
    return () => avvisaOccupato?.(false);
  }, [inviando]);

  if (readOnly) {
    if (compact) return null;
    return (
      <div className="person-photo-field">
        <PersonAvatar
          name={nome}
          photoId={photoId}
          size={64}
          alt={nome ? t('personPhotoAlt', { name: nome }) : t('personPhoto')}
        />
        <div className="person-photo-field__body">
          <span className="person-photo-field__title">{t('personPhoto')}</span>
          <small className="text-secondary">{t('personPhotoStaffOnly')}</small>
        </div>
      </div>
    );
  }

  const scegli = (file: File | undefined) => {
    if (!file) return;
    setMessaggio(null);
    if (!TIPI.includes(file.type)) {
      setMessaggio({ tipo: 'errore', testo: t('personPhotoInvalid') });
      return;
    }
    setScelto(file);
  };

  const carica = async (ritagliata: File) => {
    setScelto(null);
    setInviando(true);
    setMessaggio(null);
    try {
      const res = await fetch('/api/admin/person-photos', {
        method: 'POST',
        headers: { 'Content-Type': ritagliata.type || 'image/jpeg' },
        body: ritagliata,
      });
      const body = res.status === 201 ? ((await res.json()) as { id?: string }) : null;
      if (!montato.current) return;
      if (body?.id) {
        avvisa.current(body.id);
        setMessaggio({ tipo: 'ok', testo: t('personPhotoDone') });
        return;
      }
      const codice =
        res.status === 413
          ? 'personPhotoTooLarge'
          : res.status === 422
            ? 'personPhotoInvalid'
            : 'personPhotoFailed';
      setMessaggio({ tipo: 'errore', testo: t(codice) });
    } catch {
      if (montato.current)
        setMessaggio({ tipo: 'errore', testo: t('personPhotoFailed') });
    } finally {
      if (montato.current) setInviando(false);
    }
  };

  const conNome = (
    chiave: 'personPhotoAddFor' | 'personPhotoChangeFor' | 'personPhotoRemoveFor'
  ) => (compact && nome ? t(chiave, { name: nome }) : undefined);

  const pulsanti = (
    <div
      className={`person-photo-field__actions${compact ? ' person-photo-field__actions--riga' : ''}`}
    >
      <input
        ref={inputRef}
        id={`${id}-file`}
        type="file"
        accept={TIPI.join(',')}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          scegli(e.target.files?.[0]);
          // Lo stesso file si può scegliere di nuovo (dopo un ritaglio annullato).
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className={compact ? 'btn btn-link' : 'btn btn-sm btn-outline-primary'}
        onClick={() => inputRef.current?.click()}
        disabled={inviando}
        aria-label={conNome(photoId ? 'personPhotoChangeFor' : 'personPhotoAddFor')}
        aria-describedby={compact ? undefined : helpId}
      >
        {photoId ? t('personPhotoChange') : t('personPhotoAdd')}
      </button>
      {photoId && (
        <button
          type="button"
          className={
            compact ? 'btn btn-link text-danger' : 'btn btn-sm btn-link text-danger px-1'
          }
          onClick={() => {
            setMessaggio(null);
            onChange(null);
          }}
          disabled={inviando}
          aria-label={conNome('personPhotoRemoveFor')}
        >
          {t('personPhotoRemove')}
        </button>
      )}
      <span role="status" aria-live="polite" className="person-photo-field__stato">
        {inviando ? (
          <span className="small text-secondary">{t('personPhotoUploading')}</span>
        ) : messaggio ? (
          <span
            className={`small person-photo-field__msg person-photo-field__msg--${messaggio.tipo}`}
          >
            {messaggio.testo}
          </span>
        ) : null}
      </span>
    </div>
  );

  return (
    <>
      {compact ? (
        pulsanti
      ) : (
        // Il titolo sta sopra, a filo come quello del logo dell'ente
        // accanto: i due campi sono allo stesso livello, e un titolo rientrato
        // dietro la foto sembrava una sottosezione.
        <div>
          <span className="campo-file__etichetta d-block">{t('personPhoto')}</span>
          <div className="person-photo-field">
            <PersonAvatar
              name={nome}
              photoId={photoId}
              size={64}
              alt={nome ? t('personPhotoAlt', { name: nome }) : t('personPhoto')}
            />
            <div className="person-photo-field__body">
              <small id={helpId} className="text-secondary">
                {t('personPhotoHelp')}
              </small>
              {pulsanti}
            </div>
          </div>
        </div>
      )}
      {scelto && (
        <ImageCropDialog
          file={scelto}
          ritaglio={RITAGLIO}
          onConferma={(f) => void carica(f)}
          onAnnulla={() => setScelto(null)}
        />
      )}
    </>
  );
}

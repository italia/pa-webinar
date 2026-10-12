'use client';

/**
 * La foto profilo in sala d'attesa: facoltativa, la vedono gli altri al posto
 * delle iniziali (riquadro della chiamata, partecipanti), anche agli eventi
 * successivi con la stessa email. Compare solo a chi ha un'email dietro al
 * token e ha provato che e' sua (iscritti che hanno aperto, da questo
 * browser, il link dell'email): lo dice il server. Chi si e' iscritto dal
 * modulo e non ha ancora aperto l'email riceve l'invito a farlo.
 *
 * Il browser ritaglia la foto al centro e la ricomprime in JPEG 256x256 prima
 * di mandarla: il file resta piccolo e perde i metadati (data, luogo).
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { avatarColor, avatarInitials } from '@/lib/chat/avatar';

const LATO = 256;
const MAX_BYTES = 150_000;

/** La foto ritagliata al centro e ricompressa: JPEG, LATO x LATO. */
async function preparaFoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const lato = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = LATO;
  canvas.height = LATO;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(
    bitmap,
    (bitmap.width - lato) / 2,
    (bitmap.height - lato) / 2,
    lato,
    lato,
    0,
    0,
    LATO,
    LATO,
  );
  bitmap.close();
  for (const qualita of [0.85, 0.7, 0.5]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', qualita));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error('too-large');
}

export default function ProfilePhotoField({
  eventSlug,
  token,
  name,
}: {
  eventSlug: string;
  token: string;
  /** Per le iniziali dell'anteprima, finche' la foto non c'e'. */
  name: string;
}) {
  const t = useTranslations('waiting.photo');
  const tc = useTranslations('common');
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stato, setStato] = useState<{
    canUpload: boolean;
    needsEmailProof: boolean;
    url: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [messaggio, setMessaggio] = useState<{ tipo: 'ok' | 'errore'; testo: string } | null>(null);
  const [armata, setArmata] = useState(false);
  useEffect(() => {
    if (!armata) return;
    const timer = setTimeout(() => setArmata(false), 4000);
    return () => clearTimeout(timer);
  }, [armata]);

  const url = `/api/events/${eventSlug}/profile-photo`;

  useEffect(() => {
    let vivo = true;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: { canUpload?: boolean; needsEmailProof?: boolean; photo?: { url: string } | null } | null) => {
          if (vivo && d) {
            setStato({
              canUpload: !!d.canUpload,
              needsEmailProof: !!d.needsEmailProof,
              url: d.photo?.url ?? null,
            });
          }
        },
      )
      .catch(() => {
        /* senza risposta la sezione semplicemente non compare */
      });
    return () => {
      vivo = false;
    };
  }, [url, token]);

  const scegli = useCallback(
    async (file: File) => {
      setMessaggio(null);
      setBusy(true);
      try {
        let foto: Blob;
        try {
          foto = await preparaFoto(file);
        } catch (err) {
          setMessaggio({
            tipo: 'errore',
            testo: err instanceof Error && err.message === 'too-large' ? t('errors.tooLarge') : t('errors.invalid'),
          });
          return;
        }
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
          body: foto,
        });
        if (!res.ok) {
          setMessaggio({
            tipo: 'errore',
            testo: res.status === 413 ? t('errors.tooLarge') : res.status === 422 ? t('errors.invalid') : tc('errorGeneric'),
          });
          return;
        }
        const d = (await res.json()) as { photo: { url: string } };
        setStato({ canUpload: true, needsEmailProof: false, url: d.photo.url });
        setMessaggio({ tipo: 'ok', testo: t('saved') });
      } catch {
        setMessaggio({ tipo: 'errore', testo: tc('errorGeneric') });
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [url, token, t, tc],
  );

  const togli = useCallback(async () => {
    setMessaggio(null);
    setBusy(true);
    try {
      const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        setMessaggio({ tipo: 'errore', testo: tc('errorGeneric') });
        return;
      }
      setStato({ canUpload: true, needsEmailProof: false, url: null });
      setMessaggio({ tipo: 'ok', testo: t('removed') });
    } catch {
      setMessaggio({ tipo: 'errore', testo: tc('errorGeneric') });
    } finally {
      setBusy(false);
    }
  }, [url, token, t, tc]);

  const nome = name.trim() || '?';
  if (stato?.needsEmailProof) {
    return (
      <div className="profile-photo">
        <span className="profile-photo__preview" style={{ backgroundColor: avatarColor(nome) }} aria-hidden="true">
          {avatarInitials(nome)}
        </span>
        <div className="profile-photo__body">
          <span className="profile-photo__title">{t('title')}</span>
          <span className="profile-photo__help">{t('verifyHint')}</span>
        </div>
      </div>
    );
  }
  if (!stato?.canUpload) return null;

  return (
    <div className="profile-photo">
      <span
        className="profile-photo__preview"
        style={stato.url ? undefined : { backgroundColor: avatarColor(nome) }}
        aria-hidden="true"
      >
        {stato.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={stato.url} alt="" width={56} height={56} />
        ) : (
          avatarInitials(nome)
        )}
      </span>
      <div className="profile-photo__body">
        <span className="profile-photo__title">{t('title')}</span>
        <span className="profile-photo__help" id={`${inputId}-help`}>
          {t('help')}
        </span>
        <div className="profile-photo__actions">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="visually-hidden"
            aria-describedby={`${inputId}-help`}
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void scegli(file);
            }}
          />
          <label htmlFor={inputId} className={`profile-photo__pick${busy ? ' is-busy' : ''}`}>
            {busy ? t('saving') : stato.url ? t('change') : t('choose')}
          </label>
          {stato.url && (
            <button
              type="button"
              className={`poll-action poll-action--delete${armata ? ' is-armed' : ''}`}
              disabled={busy}
              onClick={() => {
                if (!armata) {
                  setArmata(true);
                  return;
                }
                setArmata(false);
                void togli();
              }}
            >
              {armata ? tc('confirm') : t('remove')}
            </button>
          )}
        </div>
        {messaggio && (
          <span
            className={`profile-photo__msg profile-photo__msg--${messaggio.tipo}`}
            role={messaggio.tipo === 'errore' ? 'alert' : 'status'}
          >
            {messaggio.testo}
          </span>
        )}
      </div>
    </div>
  );
}

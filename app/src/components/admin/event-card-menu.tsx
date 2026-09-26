'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { Link, percorso, useRouter } from '@/i18n/navigation';
import { duplicaComeProssima, impostaStatoEvento } from '@/lib/events/event-actions';
import { localizedPath } from '@/lib/utils/localized-url';

/**
 * Le azioni frequenti su un evento, direttamente dalla sua scheda
 * nell'elenco: senza, pubblicare, duplicare o eliminare voleva dire entrare
 * nell'evento e tornare indietro.
 *
 * E' un pulsante che apre un elenco di comandi, non un menu applicativo: i
 * ruoli `menu`/`menuitem` promettono la navigazione con le frecce, e un
 * lettore di schermo la annuncerebbe senza che esista. Qui si scorre col Tab,
 * Esc chiude e riporta il focus sul pulsante.
 */
export interface EventCardMenuEvent {
  id: string;
  slug: string;
  title: string;
  status: string;
  eventType: string;
  moderatorToken: string;
}

export default function EventCardMenu({ event }: { event: EventCardMenuEvent }) {
  const t = useTranslations('admin.eventsList.menu');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Posizione rispetto alla finestra, non alla scheda: la scheda taglia cio'
  // che esce dai suoi bordi, e un elenco lungo su una scheda corta perdeva le
  // prime voci.
  const [posizione, setPosizione] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const chiudi = useCallback((rimettiFocus: boolean) => {
    setOpen(false);
    if (rimettiFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const fuori = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) chiudi(false);
    };
    const tasto = (e: KeyboardEvent) => {
      if (e.key === 'Escape') chiudi(true);
    };
    // Ancorato alla finestra, l'elenco non segue la pagina che scorre: si
    // chiude, come fanno i menu del sistema.
    const via = () => chiudi(false);
    document.addEventListener('mousedown', fuori);
    document.addEventListener('keydown', tasto);
    window.addEventListener('scroll', via, true);
    window.addEventListener('resize', via);
    return () => {
      document.removeEventListener('mousedown', fuori);
      document.removeEventListener('keydown', tasto);
      window.removeEventListener('scroll', via, true);
      window.removeEventListener('resize', via);
    };
  }, [open, chiudi]);

  const apriChiudi = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) {
      const right = Math.max(8, window.innerWidth - r.right);
      // Sotto se c'e' posto, altrimenti sopra: l'elenco completo e' alto
      // circa 320px.
      setPosizione(
        window.innerHeight - r.bottom > 340
          ? { top: r.bottom + 4, right }
          : { bottom: window.innerHeight - r.top + 4, right },
      );
    }
    setOpen(true);
  };

  const autorizzato = { Authorization: `Bearer ${event.moderatorToken}` };
  const pubblico = event.status === 'PUBLISHED' || event.status === 'LIVE';
  const pubblicabile = event.status === 'DRAFT' || event.status === 'PUBLISHED';
  const istantanea = event.eventType === 'INSTANT';

  const esegui = useCallback(
    async (azione: () => Promise<void>) => {
      chiudi(true);
      setBusy(true);
      try {
        await azione();
      } catch {
        toast.error(t('failed'));
      } finally {
        setBusy(false);
      }
    },
    [chiudi, toast, t],
  );

  const copiaLink = () =>
    esegui(async () => {
      // L'indirizzo pubblico nella lingua della pagina, cosi' come lo vedra'
      // chi lo riceve.
      const href = `${window.location.origin}${localizedPath(`/events/${event.slug}`, locale)}`;
      await navigator.clipboard.writeText(href);
      toast.success(t('linkCopied'));
    });

  const cambiaPubblicazione = () =>
    esegui(async () => {
      const verso = event.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
      if (verso === 'DRAFT') {
        const ok = await confirm({
          title: t('unpublishTitle'),
          message: t('unpublishMessage', { title: event.title }),
          confirmLabel: t('unpublish'),
        });
        if (!ok) return;
      }
      await impostaStatoEvento(event.id, event.moderatorToken, verso);
      toast.success(verso === 'PUBLISHED' ? t('published') : t('unpublished'));
      router.refresh();
    });

  const duplica = () =>
    esegui(async () => {
      const creato = await duplicaComeProssima(event.id);
      // La copia nasce in bozza: si apre subito la modifica, dove va
      // confermata.
      router.push(
        percorso(
          `/admin/events/${creato.id}/edit?token=${encodeURIComponent(creato.moderatorToken)}`,
        ),
      );
    });

  const elimina = () =>
    esegui(async () => {
      const ok = await confirm({
        title: t('deleteTitle'),
        message: t('deleteMessage', { title: event.title }),
        confirmLabel: t('delete'),
        danger: true,
      });
      if (!ok) return;
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'DELETE',
        headers: autorizzato,
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(t('deleted'));
      router.refresh();
    });

  const voce = 'dropdown-item d-flex align-items-center gap-2 py-2 px-3';

  return (
    <div ref={wrapRef} className="position-relative">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t('actionsFor', { title: event.title })}
        disabled={busy}
        onClick={apriChiudi}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <ul
          id={listId}
          className="list-unstyled bg-white shadow rounded py-1 mb-0"
          style={{
            position: 'fixed',
            ...posizione,
            minWidth: 230,
            zIndex: 1040,
            border: '1px solid #d9dadb',
          }}
        >
          <li>
            <Link
              className={voce}
              href={percorso(`/admin/events/${event.id}?token=${event.moderatorToken}`)}
            >
              {t('manage')}
            </Link>
          </li>
          {!istantanea && (
            <li>
              <Link
                className={voce}
                href={percorso(`/admin/events/${event.id}/edit?token=${event.moderatorToken}`)}
              >
                {t('edit')}
              </Link>
            </li>
          )}
          {pubblico && !istantanea && (
            <>
              <li>
                <Link className={voce} href={percorso(`/events/${event.slug}`)} target="_blank">
                  {t('openPublic')}
                  <span className="visually-hidden"> {t('newTab')}</span>
                </Link>
              </li>
              <li>
                <button type="button" className={voce} onClick={copiaLink}>
                  {t('copyLink')}
                </button>
              </li>
            </>
          )}
          {pubblicabile && !istantanea && (
            <li>
              <button type="button" className={voce} onClick={cambiaPubblicazione}>
                {event.status === 'PUBLISHED' ? t('unpublish') : t('publish')}
              </button>
            </li>
          )}
          {!istantanea && (
            <li>
              <button type="button" className={voce} onClick={duplica}>
                {t('duplicate')}
              </button>
            </li>
          )}
          {event.status !== 'LIVE' && (
            <>
              <li role="separator" className="dropdown-divider my-1" />
              <li>
                <button type="button" className={`${voce} text-danger`} onClick={elimina}>
                  {t('delete')}
                </button>
              </li>
            </>
          )}
        </ul>
      )}
    </div>
  );
}

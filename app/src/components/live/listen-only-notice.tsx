'use client';

import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';

/**
 * Chi e' entrato in solo ascolto (senza consenso alla registrazione) lo sa, e
 * sa come cambiare idea: acconsentire qui lo fa rientrare nella conferenza
 * con microfono e videocamera che l'evento concede (un token nuovo). Finche'
 * non acconsente, nemmeno un moderatore che gli da' la parola puo' aprirglieli
 * (mod_pa_media_lock): la richiesta di parlare passa da qui.
 */
export default function ListenOnlyNotice({
  onAcconsenti,
  inCorso,
  errore,
}: {
  onAcconsenti: () => void;
  inCorso: boolean;
  errore: boolean;
}) {
  const t = useTranslations('live.listenOnly');
  return (
    <div className="live-listen-only" role="region" aria-label={t('title')}>
      <Icon
        icon="it-hearing"
        size="sm"
        className="flex-shrink-0 live-listen-only__icona"
      />
      <p className="mb-0 flex-grow-1">
        <strong>{t('title')}</strong> {t('body')}
      </p>
      <button
        type="button"
        className="btn btn-primary btn-sm flex-shrink-0"
        onClick={onAcconsenti}
        disabled={inCorso}
      >
        {inCorso ? t('joining') : t('consent')}
      </button>
      {errore && (
        <p className="mb-0 w-100 small text-danger" role="alert">
          {t('error')}
        </p>
      )}
    </div>
  );
}

// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';

import TestoEnteFascia from '@/components/live/testo-ente-fascia';
import { Icon } from '@/components/ui/icon';
import { testoConsensoEvento, type VoceNelVideo } from '@/lib/live/consent-rule';
import { chiaveConsenso, type Destinazione } from '@/lib/recording/destination';

/**
 * Chi e' entrato in solo ascolto (senza consenso alla registrazione) lo sa, e
 * sa come cambiare idea: acconsentire qui lo fa rientrare nella conferenza
 * con microfono e videocamera che l'evento concede (un token nuovo). Finche'
 * non acconsente, nemmeno un moderatore che gli da' la parola puo' aprirglieli
 * (mod_pa_media_lock): la richiesta di parlare passa da qui. Il clic e' un
 * consenso: sopra il pulsante c'e' il testo della casella, che dice dove va il
 * video.
 */
export default function ListenOnlyNotice({
  testoConsenso,
  destinazione,
  voce,
  onAcconsenti,
  inCorso,
  errore,
  testoCambiato = false,
}: {
  /** Il testo dell'ente sulla registrazione: il consenso qui vale per quello. */
  testoConsenso?: string | null;
  /** La destinazione in vigore: il testo a cui si acconsente. */
  destinazione: Destinazione;
  voce: VoceNelVideo;
  onAcconsenti: () => void;
  inCorso: boolean;
  errore: boolean;
  /** Il consenso e' arrivato su un testo non piu' in vigore: va riletto. */
  testoCambiato?: boolean;
}) {
  const t = useTranslations('live.listenOnly');
  const tc = useTranslations('live.consents');
  const tGdpr = useTranslations('gdpr.consent');
  const idTesto = useId();
  const testoEvento = testoConsensoEvento(testoConsenso, voce);
  return (
    <div className="live-listen-only" role="region" aria-label={t('title')}>
      <Icon
        icon="it-hearing"
        size="sm"
        className="flex-shrink-0 live-listen-only__icona"
      />
      <p className="mb-0 flex-grow-1">
        <strong>{t('title')}</strong> {t('body')}
        {testoEvento && <TestoEnteFascia testo={testoEvento} />}
        <span id={idTesto} className="d-block small mt-1">
          {tGdpr(chiaveConsenso(destinazione, voce))}
        </span>
      </p>
      <button
        type="button"
        className="btn btn-primary btn-sm flex-shrink-0"
        onClick={onAcconsenti}
        disabled={inCorso}
        aria-describedby={idTesto}
      >
        {inCorso ? t('joining') : t('consent')}
      </button>
      {errore && (
        <p className="mb-0 w-100 small text-danger" role="alert">
          {t('error')}
        </p>
      )}
      {testoCambiato && (
        <p className="mb-0 w-100 small text-danger" role="alert">
          {tc('textChanged')}
        </p>
      )}
    </div>
  );
}

// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';

/**
 * Chi e' entrato senza consenso alla registrazione lo sa, anche se ha soltanto
 * dimenticato la casella: in sala partecipa come tutti, e nella registrazione
 * non c'e'. Acconsentire qui lo fa rientrare nella conferenza con un token nuovo.
 */
export default function VoiceExcludedNotice({
  testoConsenso,
  onAcconsenti,
  inCorso,
  errore,
}: {
  /** Il testo dell'ente sulla registrazione: il consenso qui vale per quello. */
  testoConsenso?: string | null;
  onAcconsenti: () => void;
  inCorso: boolean;
  errore: boolean;
}) {
  const t = useTranslations('live.voiceExcluded');
  const tl = useTranslations('live.listenOnly');
  return (
    <div className="live-listen-only" role="region" aria-label={t('title')}>
      <Icon
        icon="it-hearing"
        size="sm"
        className="flex-shrink-0 live-listen-only__icona"
      />
      <p className="mb-0 flex-grow-1">
        <strong>{t('title')}</strong> {t('body')}
        {testoConsenso?.trim() && (
          <span className="d-block small mt-1">{testoConsenso}</span>
        )}
      </p>
      <button
        type="button"
        className="btn btn-primary btn-sm flex-shrink-0"
        onClick={onAcconsenti}
        disabled={inCorso}
      >
        {inCorso ? tl('joining') : t('consent')}
      </button>
      {errore && (
        <p className="mb-0 w-100 small text-danger" role="alert">
          {tl('error')}
        </p>
      )}
    </div>
  );
}

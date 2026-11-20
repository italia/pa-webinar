// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

/**
 * Cancellare una sola iscrizione dalla pagina dei propri dati, senza toccare le
 * altre. Prima la pagina dice cosa si cancella e cosa resta; poi la persona chiede
 * il codice e lo scrive (POST /api/gdpr/registrations/cancel).
 */
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

import { CampoCodice, useCodiceDiConferma } from './confirmation-code';

export default function RegistrationCancel({
  token,
  registrationId,
  locale,
  onCancellata,
}: {
  token: string;
  registrationId: string;
  locale: string;
  /** Le prove dei consensi rimaste senza nome, da dire nella scheda. */
  onCancellata: (proveRimaste: number) => void;
}) {
  const t = useTranslations('gdpr.export');
  const tc = useTranslations('common');
  const id = useId();
  const [aperta, setAperta] = useState(false);
  const codice = useCodiceDiConferma('/api/gdpr/registrations/cancel');
  const corpo = { token, registrationId, locale };
  const chiudi = () => {
    setAperta(false);
    codice.ricomincia();
  };

  const conferma = async (c: string) => {
    const esito = await codice.conferma(corpo, c);
    if (!esito.ok) return;
    const prove = esito.corpo?.consentProofsKept;
    onCancellata(typeof prove === 'number' ? prove : 0);
  };

  return (
    <section className="mb-3" aria-labelledby={`${id}-titolo`}>
      <h4 id={`${id}-titolo`} className="h6 text-secondary mb-2">
        {t('cancelTitle')}
      </h4>
      {!aperta ? (
        <>
          <p className="mb-2" style={{ fontSize: '0.9rem' }}>
            {t('cancelIntro')}
          </p>
          <Button color="danger" outline size="sm" onClick={() => setAperta(true)}>
            {t('cancelButton')}
          </Button>
        </>
      ) : (
        <div className="border rounded p-3" role="group" aria-labelledby={`${id}-titolo`}>
          <p className="mb-2" style={{ fontSize: '0.9rem' }}>
            {t('cancelDeletes')}
          </p>
          <p className="mb-2" style={{ fontSize: '0.9rem' }}>
            {t('cancelKeeps')}
          </p>
          <p className="text-muted small mb-2">{t('codeWhy')}</p>
          {codice.fase === 'pronto' ? (
            <div className="d-flex flex-wrap gap-2">
              <Button
                color="danger"
                size="sm"
                disabled={codice.inCorso}
                onClick={() => void codice.chiedi(corpo)}
              >
                {t('codeSend')}
              </Button>
              <Button
                color="secondary"
                outline
                size="sm"
                disabled={codice.inCorso}
                onClick={chiudi}
              >
                {tc('cancel')}
              </Button>
            </div>
          ) : (
            <CampoCodice
              minuti={codice.minuti}
              inCorso={codice.inCorso}
              etichettaConferma={t('codeConfirmCancel')}
              coloreConferma="danger"
              onConferma={(c) => void conferma(c)}
              onAnnulla={chiudi}
            />
          )}
          {codice.errore && (
            <p className="text-danger small mt-2 mb-0" role="alert">
              {codice.errore}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

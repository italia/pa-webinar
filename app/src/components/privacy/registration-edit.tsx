// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

/**
 * Correggere nome ed ente di un'iscrizione dalla pagina dei propri dati, per
 * quell'iscrizione o per tutte quelle dell'indirizzo (con la voce di rubrica).
 * La pagina dice prima cosa cambia; la correzione si conferma con il codice
 * mandato all'indirizzo (POST /api/gdpr/registrations/edit).
 */
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from 'design-react-kit';

import { CampoCodice, useCodiceDiConferma, type ChiaveErrore } from './confirmation-code';

export type AmbitoVista = 'registration' | 'address';

export interface DatiCorretti {
  displayName: string;
  organization: string | null;
  scope: AmbitoVista;
}

export default function RegistrationEdit({
  token,
  registrationId,
  displayName,
  organization,
  quanteIscrizioni,
  locale,
  onCorretta,
}: {
  token: string;
  registrationId: string;
  displayName: string;
  organization: string | null;
  /** Le iscrizioni dell'indirizzo: con piu' di una si sceglie a quali vale. */
  quanteIscrizioni: number;
  locale: string;
  onCorretta: (dati: DatiCorretti) => void;
}) {
  const t = useTranslations('gdpr.export');
  const tc = useTranslations('common');
  const id = useId();
  const [aperta, setAperta] = useState(false);
  const [nome, setNome] = useState(displayName);
  const [ente, setEnte] = useState(organization ?? '');
  const [ambito, setAmbito] = useState<AmbitoVista>('registration');
  const [erroriCampi, setErroriCampi] = useState<Record<string, ChiaveErrore>>({});
  const [fatta, setFatta] = useState(false);
  const codice = useCodiceDiConferma('/api/gdpr/registrations/edit');

  const corpo = () => ({
    token,
    registrationId,
    scope: ambito,
    displayName: nome,
    organization: ente.trim() ? ente : null,
    locale,
  });
  const chiudi = () => {
    setAperta(false);
    setErroriCampi({});
    codice.ricomincia();
  };

  const chiediCodice = async () => {
    setErroriCampi({});
    setFatta(false);
    const esito = await codice.chiedi(corpo());
    if (esito.campi) setErroriCampi(esito.campi);
  };
  const conferma = async (c: string) => {
    const esito = await codice.conferma(corpo(), c);
    if (esito.campi) {
      setErroriCampi(esito.campi);
      codice.ricomincia();
      return;
    }
    if (!esito.ok) return;
    onCorretta({
      displayName: String(esito.corpo?.displayName ?? nome.trim()),
      organization: (esito.corpo?.organization as string | null | undefined) ?? null,
      scope: ambito,
    });
    setFatta(true);
    chiudi();
  };

  if (!aperta) {
    return (
      <div className="mb-3">
        {fatta && (
          <Alert color="success" className="mb-2" role="status">
            {t('editDone')}
          </Alert>
        )}
        <Button
          color="primary"
          outline
          size="sm"
          onClick={() => {
            setNome(displayName);
            setEnte(organization ?? '');
            setFatta(false);
            setAperta(true);
          }}
        >
          {t('editButton')}
        </Button>
      </div>
    );
  }

  const bloccato = codice.fase === 'inviato';
  return (
    <section className="border rounded p-3 mb-3" aria-labelledby={`${id}-titolo`}>
      <h4 id={`${id}-titolo`} className="h6 mb-2">
        {t('editButton')}
      </h4>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!bloccato) void chiediCodice();
        }}
      >
        <label htmlFor={`${id}-nome`} className="form-label fw-semibold">
          {t('fieldName')}
        </label>
        <input
          id={`${id}-nome`}
          className="form-control mb-1"
          value={nome}
          maxLength={100}
          required
          disabled={bloccato}
          aria-invalid={!!erroriCampi.displayName}
          aria-describedby={
            erroriCampi.displayName ? `${id}-nome-errore` : undefined
          }
          onChange={(e) => setNome(e.target.value)}
        />
        {erroriCampi.displayName && (
          <p id={`${id}-nome-errore`} className="text-danger small mb-2">
            {t(erroriCampi.displayName)}
          </p>
        )}
        <label htmlFor={`${id}-ente`} className="form-label fw-semibold mt-2">
          {t('fieldOrganization')}
        </label>
        <input
          id={`${id}-ente`}
          className="form-control mb-1"
          value={ente}
          maxLength={200}
          disabled={bloccato}
          aria-invalid={!!erroriCampi.organization}
          aria-describedby={
            erroriCampi.organization ? `${id}-ente-errore` : undefined
          }
          onChange={(e) => setEnte(e.target.value)}
        />
        {erroriCampi.organization && (
          <p id={`${id}-ente-errore`} className="text-danger small mb-2">
            {t(erroriCampi.organization)}
          </p>
        )}
        {quanteIscrizioni > 1 && (
          <fieldset className="mt-2" disabled={bloccato}>
            <legend className="fs-6 fw-semibold mb-1">{t('editScopeLegend')}</legend>
            <div className="form-check">
              <input
                id={`${id}-una`}
                className="form-check-input"
                type="radio"
                name={`${id}-ambito`}
                checked={ambito === 'registration'}
                onChange={() => setAmbito('registration')}
              />
              <label htmlFor={`${id}-una`} className="form-check-label">
                {t('editScopeOne')}
              </label>
            </div>
            <div className="form-check">
              <input
                id={`${id}-tutte`}
                className="form-check-input"
                type="radio"
                name={`${id}-ambito`}
                checked={ambito === 'address'}
                onChange={() => setAmbito('address')}
              />
              <label htmlFor={`${id}-tutte`} className="form-check-label">
                {t('editScopeAll', { count: quanteIscrizioni })}
              </label>
            </div>
          </fieldset>
        )}
        <p className="text-muted small mt-2 mb-2">{t('editEffect')}</p>
        <p className="text-muted small mb-2">{t('codeWhy')}</p>
        {!bloccato && (
          <div className="d-flex flex-wrap gap-2">
            <Button color="primary" size="sm" type="submit" disabled={codice.inCorso}>
              {t('codeSend')}
            </Button>
            <Button
              color="secondary"
              outline
              size="sm"
              type="button"
              disabled={codice.inCorso}
              onClick={chiudi}
            >
              {tc('cancel')}
            </Button>
          </div>
        )}
      </form>
      {bloccato && (
        <CampoCodice
          minuti={codice.minuti}
          inCorso={codice.inCorso}
          etichettaConferma={t('codeConfirmEdit')}
          onConferma={(c) => void conferma(c)}
          onAnnulla={chiudi}
        />
      )}
      {codice.errore && (
        <p className="text-danger small mt-2 mb-0" role="alert">
          {codice.errore}
        </p>
      )}
    </section>
  );
}

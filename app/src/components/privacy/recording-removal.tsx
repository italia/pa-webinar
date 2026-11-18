// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

/**
 * «Non voglio comparire in questa registrazione», nella pagina dei propri dati,
 * per un'iscrizione a un evento che ha una registrazione: la richiesta va al
 * titolare, che toglie la persona dalla registrazione. Prima di inviarla la
 * pagina dice cosa succede e cosa non raggiunge; dopo, lo stato.
 */
import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Alert, Button } from 'design-react-kit';

export interface RichiestaRimozioneVista {
  status: 'OPEN' | 'IN_PROGRESS' | 'PROCESSING' | 'CLOSED' | 'REJECTED';
  createdAt: string;
  closedAt: string | null;
}

export interface RimozioneVista {
  available: boolean;
  requests: RichiestaRimozioneVista[];
}

const aperta = (s: RichiestaRimozioneVista['status']) =>
  s === 'OPEN' || s === 'IN_PROGRESS' || s === 'PROCESSING';

export default function RecordingRemoval({
  token,
  registrationId,
  rimozione,
}: {
  token: string;
  registrationId: string;
  rimozione: RimozioneVista;
}) {
  const t = useTranslations('gdpr.export');
  const format = useFormatter();
  const id = useId();
  const [richieste, setRichieste] = useState(rimozione.requests);
  const [conferma, setConferma] = useState(false);
  const [invio, setInvio] = useState(false);
  const [esito, setEsito] = useState<'inviata' | 'errore' | null>(null);

  if (!rimozione.available && richieste.length === 0) return null;
  const data = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long' });
  const giaAperta = richieste.some((r) => aperta(r.status));

  async function invia() {
    setInvio(true);
    setEsito(null);
    try {
      const res = await fetch('/api/gdpr/recording-removal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, registrationId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setRichieste((r) => [
        ...r,
        { status: 'OPEN', createdAt: new Date().toISOString(), closedAt: null },
      ]);
      setEsito('inviata');
      setConferma(false);
    } catch {
      setEsito('errore');
    } finally {
      setInvio(false);
    }
  }

  return (
    <section className="mb-3" aria-labelledby={`${id}-titolo`}>
      <h4 id={`${id}-titolo`} className="h6 text-secondary mb-2">
        {t('removalTitle')}
      </h4>
      {rimozione.available && (
        <p className="mb-2" style={{ fontSize: '0.9rem' }}>
          {t('removalIntro')}
        </p>
      )}
      {richieste.length > 0 && (
        <ul className="list-unstyled mb-2" style={{ fontSize: '0.9rem' }}>
          {richieste.map((r, i) => (
            <li key={i}>
              {r.status === 'CLOSED' && r.closedAt
                ? t('removalStatusClosed', {
                    date: data(r.createdAt),
                    closed: data(r.closedAt),
                  })
                : r.status === 'REJECTED'
                  ? t('removalStatusRejected', { date: data(r.createdAt) })
                  : t('removalStatusOpen', { date: data(r.createdAt) })}
            </li>
          ))}
        </ul>
      )}
      {esito === 'inviata' && (
        <Alert color="success" className="mb-2" role="status">
          {t('removalSent')}
        </Alert>
      )}
      {esito === 'errore' && (
        <Alert color="danger" className="mb-2">
          {t('removalError')}
        </Alert>
      )}
      {rimozione.available && !giaAperta && !conferma && (
        <Button color="danger" outline size="sm" onClick={() => setConferma(true)}>
          {t('removalButton')}
        </Button>
      )}
      {conferma && (
        <div
          className="border rounded p-3"
          role="group"
          aria-labelledby={`${id}-conferma`}
        >
          <p id={`${id}-conferma`} className="fw-semibold mb-1">
            {t('removalConfirmTitle')}
          </p>
          <p className="mb-3" style={{ fontSize: '0.9rem' }}>
            {t('removalConfirmBody')}
          </p>
          <div className="d-flex gap-2">
            <Button
              color="danger"
              size="sm"
              disabled={invio}
              onClick={() => void invia()}
            >
              {t('removalConfirm')}
            </Button>
            <Button
              color="secondary"
              outline
              size="sm"
              disabled={invio}
              onClick={() => setConferma(false)}
            >
              {t('removalCancel')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

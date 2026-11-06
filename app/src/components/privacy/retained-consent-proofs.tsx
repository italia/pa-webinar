// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Button, Card, CardBody } from 'design-react-kit';

import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

export interface ProvaConservataVista {
  id: string;
  eventId: string;
  kind: 'recording' | 'transcription';
  /** Il nome conservato: null dopo una cancellazione, o se non si legge piu'. */
  name: string | null;
  givenAt: string;
  withdrawnAt: string | null;
  event: { title: unknown; startsAt: string };
}

/**
 * Le prove dei consensi restate dopo la cancellazione dell'iscrizione, nella
 * pagina dei propri dati: un consenso si ritira anche quando l'iscrizione non
 * esiste piu', con la stessa conferma di quelli delle iscrizioni. Il ritiro di
 * una prova vale per lo stesso consenso su tutto l'evento, e quello della
 * registrazione ritira anche la trascrizione.
 */
export default function RetainedConsentProofs({
  token,
  prove,
}: {
  token: string;
  prove: readonly ProvaConservataVista[];
}) {
  const t = useTranslations('gdpr.export');
  const tl = useTranslations('live.consents');
  const tc = useTranslations('common');
  const format = useFormatter();
  const locale = useLocale();
  const [righe, setRighe] = useState(prove);
  const [conferma, setConferma] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const data = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long' });

  const ritira = async (prova: ProvaConservataVista) => {
    setInCorso(true);
    setErrore(null);
    try {
      const res = await fetch('/api/gdpr/consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, proofId: prova.id, consent: prova.kind }),
      });
      // Il token dura un'ora: riprovare non serve, ci vuole un link nuovo.
      if (res.status === 401) return setErrore(t('linkInvalid'));
      if (res.status === 429) return setErrore(t('rateLimited'));
      if (!res.ok) return setErrore(tl('error'));
      const adesso = new Date().toISOString();
      setRighe((prima) =>
        prima.map((r) =>
          r.eventId === prova.eventId &&
          !r.withdrawnAt &&
          (r.kind === prova.kind || prova.kind === 'recording')
            ? { ...r, withdrawnAt: adesso }
            : r
        )
      );
      setConferma(null);
    } catch {
      setErrore(tl('error'));
    } finally {
      setInCorso(false);
    }
  };

  return (
    <Card
      className="shadow-sm border-0 mb-4"
      style={{ borderRadius: 8, border: '1px solid #e8e8e8' }}
    >
      <CardBody className="p-4">
        <h2 className="h5 mb-1">{t('proofsTitle')}</h2>
        <p className="text-muted mb-3" style={{ fontSize: '0.9rem' }}>
          {t('proofsIntro')}
        </p>
        <ul className="list-unstyled mb-0" style={{ fontSize: '0.9rem' }}>
          {righe.map((p) => (
            <li key={p.id} className="mb-3">
              <div className="fw-semibold">
                {getLocalized(p.event.title as LocalizedField, locale)}
              </div>
              <div>{tl(`${p.kind}.title`)}</div>
              {p.name && (
                <div>
                  {t('fieldName')}: {p.name}
                </div>
              )}
              <div className="text-muted">
                {t('proofGivenOn', { date: data(p.givenAt) })}
                {p.withdrawnAt && (
                  <> · {t('consentWithdrawnOn', { date: data(p.withdrawnAt) })}</>
                )}
              </div>
              {!p.withdrawnAt &&
                (conferma === p.id ? (
                  <div
                    className="d-flex flex-wrap align-items-center gap-2 mt-1"
                    role="group"
                    aria-label={tl('confirmTitle')}
                  >
                    <span className="fw-semibold">{tl('confirmTitle')}</span>
                    <Button
                      color="danger"
                      size="sm"
                      disabled={inCorso}
                      onClick={() => void ritira(p)}
                    >
                      {tl('confirm')}
                    </Button>
                    <Button
                      color="secondary"
                      outline
                      size="sm"
                      disabled={inCorso}
                      onClick={() => setConferma(null)}
                    >
                      {tc('cancel')}
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="mt-1"
                    color="primary"
                    outline
                    size="sm"
                    onClick={() => setConferma(p.id)}
                  >
                    {tl('withdraw')}
                  </Button>
                ))}
            </li>
          ))}
        </ul>
        {errore && (
          <p className="text-danger small mt-2 mb-0" role="alert">
            {errore}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

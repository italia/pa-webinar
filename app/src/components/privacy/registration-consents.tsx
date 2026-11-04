'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

export interface StatoConsensoVista {
  dato: boolean;
  ritiratoIl: string | null;
}

export interface ConsensiVista {
  recording: StatoConsensoVista | null;
  transcription: StatoConsensoVista | null;
  futureCommunications: StatoConsensoVista | null;
}

type Chiave = keyof ConsensiVista;

/**
 * I consensi di un'iscrizione nella pagina dei propri dati: si ritirano uno
 * per uno, con una conferma che dice cosa cambia, senza cancellare
 * l'iscrizione. Registrazione e trascrizione si possono ridare in sala finche'
 * l'evento e' aperto.
 */
export default function RegistrationConsents({
  token,
  registrationId,
  consensi,
}: {
  token: string;
  registrationId: string;
  consensi: ConsensiVista;
}) {
  const t = useTranslations('gdpr.export');
  const tl = useTranslations('live.consents');
  const tc = useTranslations('common');
  const format = useFormatter();
  const [stati, setStati] = useState(consensi);
  const [conferma, setConferma] = useState<Chiave | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const voci: Array<{ chiave: Chiave; titolo: string; effetto: string; nota?: string }> =
    [
      {
        chiave: 'recording',
        titolo: tl('recording.title'),
        effetto: tl('recording.withdraw.soloAscolto'),
        nota: tl('recording.alreadyRecorded'),
      },
      {
        chiave: 'transcription',
        titolo: tl('transcription.title'),
        effetto: tl('transcription.withdrawEffect'),
      },
      {
        chiave: 'futureCommunications',
        titolo: t('consentFuture'),
        effetto: t('consentFutureEffect'),
      },
    ];
  const visibili = voci.filter((v) => stati[v.chiave] !== null);
  if (visibili.length === 0) return null;

  const ritira = async (chiave: Chiave) => {
    setInCorso(true);
    setErrore(null);
    try {
      const res = await fetch('/api/gdpr/consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, registrationId, consent: chiave }),
      });
      // Il token dura un'ora: riprovare non serve, ci vuole un link nuovo.
      if (res.status === 401) return setErrore(t('linkInvalid'));
      if (res.status === 429) return setErrore(t('rateLimited'));
      if (!res.ok) return setErrore(tl('error'));
      const adesso = new Date().toISOString();
      setStati((prima) => ({
        ...prima,
        [chiave]: { dato: false, ritiratoIl: adesso },
        // Senza registrazione non c'e' trascrizione: si ritira insieme.
        ...(chiave === 'recording' && prima.transcription?.dato
          ? { transcription: { dato: false, ritiratoIl: adesso } }
          : {}),
      }));
      setConferma(null);
    } catch {
      setErrore(tl('error'));
    } finally {
      setInCorso(false);
    }
  };

  return (
    <section className="mb-3" aria-label={tl('title')}>
      <h4 className="h6 text-secondary mb-2">{tl('title')}</h4>
      <p className="text-muted mb-2" style={{ fontSize: '0.9rem' }}>
        {t('consentsIntro')}
      </p>
      <ul className="list-unstyled mb-2" style={{ fontSize: '0.9rem' }}>
        {visibili.map(({ chiave, titolo, effetto, nota }) => {
          const stato = stati[chiave]!;
          return (
            <li key={chiave} className="mb-3">
              <div className="fw-semibold">{titolo}</div>
              <div className="text-muted">
                {stato.dato
                  ? tl('given')
                  : stato.ritiratoIl
                    ? t('consentWithdrawnOn', {
                        date: format.dateTime(new Date(stato.ritiratoIl), {
                          dateStyle: 'long',
                        }),
                      })
                    : tl('notGiven')}
              </div>
              {stato.dato && nota && <div className="text-muted">{nota}</div>}
              {stato.dato &&
                (conferma === chiave ? (
                  <div
                    className="d-flex flex-wrap align-items-center gap-2 mt-1"
                    role="group"
                    aria-label={tl('confirmTitle')}
                  >
                    <span className="w-100 text-muted">{effetto}</span>
                    <span className="fw-semibold">{tl('confirmTitle')}</span>
                    <Button
                      color="danger"
                      size="sm"
                      disabled={inCorso}
                      onClick={() => void ritira(chiave)}
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
                    onClick={() => setConferma(chiave)}
                  >
                    {tl('withdraw')}
                  </Button>
                ))}
            </li>
          );
        })}
      </ul>
      {errore && (
        <p className="text-danger small mb-2" role="alert">
          {errore}
        </p>
      )}
      <p className="text-muted small mb-0">{t('consentNoteInRoom')}</p>
    </section>
  );
}

// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

/**
 * Il nickname di un'iscrizione dalla pagina dei propri dati: sceglierlo dove
 * l'evento li consente, cambiarlo o toglierlo. Le regole le controlla il server,
 * come in sala (lib/live/nickname); la modifica si conferma con il codice mandato
 * all'indirizzo (POST /api/gdpr/registrations/nickname).
 */
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from 'design-react-kit';

import {
  CampoCodice,
  useCodiceDiConferma,
  type RifiutoNickname,
} from './confirmation-code';

/** I motivi di rifiuto che hanno un testo sotto `live.nickname.errors`. */
const MOTIVI = ['length', 'format', 'scripts', 'reserved', 'host', 'taken'] as const;

export default function RegistrationNickname({
  token,
  registrationId,
  nickname,
  modificabile,
  locale,
  onCambiato,
}: {
  token: string;
  registrationId: string;
  /** Il nickname in uso, o null. */
  nickname: string | null;
  /** L'evento accetta nickname nuovi: senza, si puo' solo togliere quello che c'e'. */
  modificabile: boolean;
  locale: string;
  onCambiato: (nickname: string | null) => void;
}) {
  const t = useTranslations('gdpr.export');
  const tn = useTranslations('live.nickname');
  const tc = useTranslations('common');
  const id = useId();
  const [aperta, setAperta] = useState(false);
  const [valore, setValore] = useState(nickname ?? '');
  // Il valore mandato con il codice: null per toglierlo.
  const [inviato, setInviato] = useState<string | null>(null);
  const [rifiuto, setRifiuto] = useState<RifiutoNickname | null>(null);
  const [fatto, setFatto] = useState<'salvato' | 'tolto' | null>(null);
  const codice = useCodiceDiConferma('/api/gdpr/registrations/nickname');

  if (!nickname && !modificabile) return null;

  const corpo = (n: string | null) => ({ token, registrationId, nickname: n, locale });
  const chiudi = () => {
    setAperta(false);
    setRifiuto(null);
    codice.ricomincia();
  };
  const testoRifiuto = (r: RifiutoNickname): string => {
    if (r.codice === 'NICKNAMES_DISABLED') return tn('errors.disabled');
    const motivo = MOTIVI.find((m) => m === r.motivo);
    return motivo ? tn(`errors.${motivo}`) : tn('errors.rete');
  };

  const chiedi = async (n: string | null) => {
    setRifiuto(null);
    setFatto(null);
    setInviato(n);
    const esito = await codice.chiedi(corpo(n));
    if (esito.rifiuto) setRifiuto(esito.rifiuto);
    // Niente da cambiare: la rotta risponde subito, senza codice.
    if (esito.ok) chiudi();
  };
  const conferma = async (c: string) => {
    const esito = await codice.conferma(corpo(inviato), c);
    if (esito.rifiuto) {
      setRifiuto(esito.rifiuto);
      codice.ricomincia();
      return;
    }
    if (!esito.ok) return;
    const salvato = (esito.corpo?.nickname as string | null | undefined) ?? null;
    onCambiato(salvato);
    setFatto(salvato ? 'salvato' : 'tolto');
    chiudi();
  };

  const titolo = nickname ? t('nicknameChange') : t('nicknameChoose');
  if (!aperta) {
    return (
      <div className="mb-3">
        {fatto && (
          <Alert color="success" className="mb-2" role="status">
            {fatto === 'salvato' ? t('nicknameDone') : tn('doneRemoved')}
          </Alert>
        )}
        <Button
          color="primary"
          outline
          size="sm"
          onClick={() => {
            setValore(nickname ?? '');
            setFatto(null);
            setAperta(true);
          }}
        >
          {modificabile ? titolo : tn('remove')}
        </Button>
      </div>
    );
  }

  const bloccato = codice.fase === 'inviato';
  return (
    <section className="border rounded p-3 mb-3" aria-labelledby={`${id}-titolo`}>
      <h4 id={`${id}-titolo`} className="h6 mb-2">
        {modificabile ? titolo : tn('remove')}
      </h4>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!bloccato && modificabile) void chiedi(valore);
        }}
      >
        {modificabile && (
          <>
            <label htmlFor={`${id}-nickname`} className="form-label fw-semibold">
              {t('fieldNickname')}
            </label>
            <input
              id={`${id}-nickname`}
              className="form-control mb-1"
              value={valore}
              maxLength={100}
              required
              disabled={bloccato}
              autoComplete="off"
              aria-invalid={!!rifiuto}
              aria-describedby={`${id}-nickname-aiuto${rifiuto ? ` ${id}-nickname-errore` : ''}`}
              onChange={(e) => {
                setValore(e.target.value);
                setRifiuto(null);
              }}
            />
            <p id={`${id}-nickname-aiuto`} className="text-muted small mb-1">
              {tn('help')}
            </p>
          </>
        )}
        {rifiuto && (
          <div
            id={`${id}-nickname-errore`}
            className="text-danger small mb-2"
            role="alert"
          >
            {testoRifiuto(rifiuto)}
            {rifiuto.suggerimento && modificabile && !bloccato && (
              <Button
                className="ms-2"
                color="primary"
                outline
                size="xs"
                type="button"
                onClick={() => {
                  setValore(rifiuto.suggerimento!);
                  setRifiuto(null);
                }}
              >
                {tn('useSuggestion', { suggestion: rifiuto.suggerimento })}
              </Button>
            )}
          </div>
        )}
        <p className="text-muted small mt-2 mb-2">{t('nicknameEffect')}</p>
        <p className="text-muted small mb-2">{t('codeWhy')}</p>
        {!bloccato && (
          <div className="d-flex flex-wrap gap-2">
            {modificabile && (
              <Button color="primary" size="sm" type="submit" disabled={codice.inCorso}>
                {t('codeSend')}
              </Button>
            )}
            {nickname && (
              <Button
                color="danger"
                outline
                size="sm"
                type="button"
                disabled={codice.inCorso}
                onClick={() => void chiedi(null)}
              >
                {tn('remove')}
              </Button>
            )}
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
          etichettaConferma={inviato === null ? tn('remove') : t('codeConfirmNickname')}
          coloreConferma={inviato === null ? 'danger' : 'primary'}
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

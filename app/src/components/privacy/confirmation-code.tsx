// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

/**
 * Le modifiche a un'iscrizione dalla pagina dei propri dati si confermano con un
 * codice mandato all'indirizzo (lib/gdpr/confirmation-code): la stessa richiesta
 * va due volte alla rotta, la prima senza codice (il server lo manda e risponde
 * 202 con `issuedAt`), la seconda con il codice scritto dalla persona.
 *
 * `useCodiceDiConferma` tiene i due tempi e traduce gli errori; `CampoCodice`
 * e' il campo del codice con i pulsanti per confermare o lasciar perdere.
 */
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

export type FaseCodice = 'pronto' | 'inviato';

export interface EsitoRichiesta {
  ok: boolean;
  /** Il corpo della risposta riuscita. */
  corpo?: Record<string, unknown>;
  /** Gli errori dei campi (422): il campo e la chiave del testo sotto `gdpr.export`. */
  campi?: Record<string, ChiaveErrore>;
  /** Un rifiuto del nickname (lib/live/nickname): chi chiama lo spiega. */
  rifiuto?: RifiutoNickname;
}

/** I codici con cui la rotta del nickname lo rifiuta, con motivo e alternativa. */
const CODICI_RIFIUTO = [
  'NICKNAME_INVALID',
  'NICKNAME_TAKEN',
  'NICKNAMES_DISABLED',
] as const;
export interface RifiutoNickname {
  codice: (typeof CODICI_RIFIUTO)[number];
  motivo?: string;
  suggerimento?: string;
}

/** I testi degli errori dei campi che la rotta della correzione puo' dare. */
const CHIAVI_ERRORE = [
  'editNameInvalid',
  'editOrganizationTooLong',
  'editOrganizationRequired',
] as const;
export type ChiaveErrore = (typeof CHIAVI_ERRORE)[number];

function erroriDeiCampi(dettagli: unknown): Record<string, ChiaveErrore> {
  const campi: Record<string, ChiaveErrore> = {};
  for (const d of Array.isArray(dettagli) ? dettagli : []) {
    const { path, message } = (d ?? {}) as { path?: unknown[]; message?: unknown };
    const chiave =
      typeof message === 'string' ? message.replace(/^gdpr\.export\./, '') : '';
    if (
      typeof path?.[0] === 'string' &&
      (CHIAVI_ERRORE as readonly string[]).includes(chiave)
    ) {
      campi[path[0]] = chiave as ChiaveErrore;
    }
  }
  return campi;
}

export function useCodiceDiConferma(url: string) {
  const t = useTranslations('gdpr.export');
  const [fase, setFase] = useState<FaseCodice>('pronto');
  const [emessoIl, setEmessoIl] = useState<number | null>(null);
  const [minuti, setMinuti] = useState(15);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const chiama = async (corpo: Record<string, unknown>): Promise<EsitoRichiesta> => {
    setInCorso(true);
    setErrore(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 202) {
        setEmessoIl(typeof json.issuedAt === 'number' ? json.issuedAt : null);
        if (typeof json.expiresInMinutes === 'number') setMinuti(json.expiresInMinutes);
        setFase('inviato');
        return { ok: false };
      }
      if (res.ok) return { ok: true, corpo: json };
      const codice = (CODICI_RIFIUTO as readonly string[]).find((c) => c === json.code);
      if ((res.status === 409 || res.status === 422) && codice) {
        return {
          ok: false,
          rifiuto: {
            codice: codice as RifiutoNickname['codice'],
            ...(typeof json.reason === 'string' ? { motivo: json.reason } : {}),
            ...(typeof json.suggestion === 'string'
              ? { suggerimento: json.suggestion }
              : {}),
          },
        };
      }
      // Il token della pagina dura un'ora: ci vuole un link nuovo.
      if (res.status === 401) setErrore(t('linkInvalid'));
      else if (res.status === 429) setErrore(t('rateLimited'));
      else if (res.status === 403) setErrore(t('codeInvalid'));
      else if (res.status === 422) {
        const campi = erroriDeiCampi(json.details);
        // Un errore che non riguarda un campo (una richiesta malformata) si dice
        // comunque: la pagina non resta muta.
        if (Object.keys(campi).length > 0) return { ok: false, campi };
        setErrore(t('error'));
      } else setErrore(t('error'));
      return { ok: false };
    } catch {
      setErrore(t('error'));
      return { ok: false };
    } finally {
      setInCorso(false);
    }
  };

  return {
    fase,
    minuti,
    inCorso,
    errore,
    /** Chiede il codice per questa richiesta. */
    chiedi: (corpo: Record<string, unknown>) => chiama(corpo),
    /** Manda la stessa richiesta con il codice. */
    conferma: (corpo: Record<string, unknown>, codice: string) =>
      chiama({ ...corpo, code: codice, issuedAt: emessoIl }),
    ricomincia: () => {
      setFase('pronto');
      setEmessoIl(null);
      setErrore(null);
    },
  };
}

export function CampoCodice({
  minuti,
  inCorso,
  etichettaConferma,
  coloreConferma = 'primary',
  onConferma,
  onAnnulla,
}: {
  minuti: number;
  inCorso: boolean;
  etichettaConferma: string;
  coloreConferma?: 'primary' | 'danger';
  onConferma: (codice: string) => void;
  onAnnulla: () => void;
}) {
  const t = useTranslations('gdpr.export');
  const tc = useTranslations('common');
  const id = useId();
  const [codice, setCodice] = useState('');
  const valido = /^\d{6}$/.test(codice);
  return (
    <form
      className="mt-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) onConferma(codice);
      }}
    >
      <p className="mb-2" role="status">
        {t('codeSent', { minutes: minuti })}
      </p>
      <label htmlFor={`${id}-codice`} className="form-label fw-semibold">
        {t('codeLabel')}
      </label>
      <input
        id={`${id}-codice`}
        className="form-control mb-2"
        style={{ maxWidth: '12rem', letterSpacing: '0.3em' }}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={codice}
        onChange={(e) => setCodice(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
      <div className="d-flex flex-wrap gap-2">
        <Button
          color={coloreConferma}
          size="sm"
          type="submit"
          disabled={inCorso || !valido}
        >
          {etichettaConferma}
        </Button>
        <Button
          color="secondary"
          outline
          size="sm"
          type="button"
          disabled={inCorso}
          onClick={onAnnulla}
        >
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}

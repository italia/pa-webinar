'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Quante persone si aspettano: una stima che dimensiona la sala, non un
 * limite alle iscrizioni. Si chiede una volta, nelle domande del formato;
 * dopo si cambia qui, nei dettagli tecnici, accanto a cio' che ne dipende.
 */
export default function CampoPartecipanti({
  value,
  onChange,
  errore,
}: {
  value: number;
  onChange: (n: number) => void;
  errore?: boolean;
}) {
  const t = useTranslations('admin.wizard.step1');
  const tAdmin = useTranslations('admin');
  // Il testo del campo mentre lo si scrive (null fuori dal campo).
  const [testo, setTesto] = useState<string | null>(null);

  return (
    <div className="mb-3">
      <label className="form-label" htmlFor="ev-max">
        {tAdmin('form.expectedParticipants')}
      </label>
      <div className="d-flex align-items-center gap-3">
        <input
          id="ev-max-range"
          type="range"
          min={2}
          max={5000}
          step={1}
          className="form-range flex-grow-1"
          value={Math.min(5000, Math.max(2, value || 150))}
          onChange={(e) => onChange(Number(e.target.value) || 2)}
          aria-label={tAdmin('form.expectedParticipants')}
        />
        <input
          id="ev-max"
          type="number"
          min={2}
          max={5000}
          className={`form-control ${errore ? 'is-invalid' : ''}`}
          style={{ maxWidth: 96 }}
          // Mentre si scrive il campo tiene il testo cosi' com'e' (anche
          // vuoto); il valore si riporta nei limiti all'uscita, non a ogni
          // tasto: scrivendo «150» il primo «1» diventerebbe 2.
          value={testo ?? value}
          onChange={(e) => {
            setTesto(e.target.value);
            const raw = Number(e.target.value);
            if (e.target.value.trim() === '' || !Number.isFinite(raw)) return;
            onChange(Math.floor(raw));
          }}
          onBlur={() => {
            setTesto(null);
            const clamped = Math.min(5000, Math.max(2, value || 2));
            if (clamped !== value) onChange(clamped);
          }}
          aria-describedby={errore ? 'ev-max-aiuto ev-max-errore' : 'ev-max-aiuto'}
        />
      </div>
      {errore && (
        <div id="ev-max-errore" className="invalid-feedback d-block">
          {t('validation.maxParticipants')}
        </div>
      )}
      <small id="ev-max-aiuto" className="form-text text-muted">
        {t('maxParticipantsHelp')}
      </small>
    </div>
  );
}

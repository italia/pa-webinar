// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useTranslations } from 'next-intl';

import {
  NESSUNA_CANCELLAZIONE,
  RETENTION_OPTIONS,
} from '@/lib/recording/retention-options';

/**
 * La scelta della durata della registrazione (`recordingDeleteAfterDays`), nel
 * wizard e nei modelli: le stesse voci del pannello della registrazione. Null =
 * nessuna cancellazione automatica.
 */
export default function RecordingRetentionSelect({
  id,
  value,
  onChange,
  describedBy,
}: {
  id: string;
  value: number | null;
  onChange: (giorni: number | null) => void;
  describedBy?: string;
}) {
  const t = useTranslations('recording');
  return (
    <select
      id={id}
      className="form-select"
      value={value ?? NESSUNA_CANCELLAZIONE}
      onChange={(e) => {
        const giorni = Number(e.target.value);
        onChange(giorni === NESSUNA_CANCELLAZIONE ? null : giorni);
      }}
      aria-describedby={describedBy}
    >
      {RETENTION_OPTIONS.map((opzione) => (
        <option key={opzione.value} value={opzione.value}>
          {t(opzione.labelKey)}
        </option>
      ))}
    </select>
  );
}

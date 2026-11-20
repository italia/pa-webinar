// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

/**
 * Sotto la descrizione, nel passo «Evento»: se la descrizione sembra gia'
 * contenere un programma, lo si dice (nella pagina comparirebbe due volte, e
 * senza orari ne' persone) e si porta al passo «Programma». Il programma si
 * prepara solo li': qui nient'altro.
 */

import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';

import { descrizioneConProgramma } from './programme-plan';

interface Props {
  /** La descrizione nella lingua principale. */
  descrizione: string;
  /** Apre il passo «Programma». */
  onVai: () => void;
}

export default function ProgrammeCard({ descrizione, onVai }: Props) {
  const tp = useTranslations('admin.wizard.programme');
  if (!descrizioneConProgramma(descrizione)) return null;
  return (
    <p className="wizard-iscrizione__avviso mb-4" role="note">
      <Icon icon="it-warning-circle" size="sm" />
      <span>
        {tp('descriptionHasProgramme')}{' '}
        <button type="button" className="btn btn-link p-0 align-baseline" onClick={onVai}>
          {tp('goToProgramme')}
        </button>
      </span>
    </p>
  );
}

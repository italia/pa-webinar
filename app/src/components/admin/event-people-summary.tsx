// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Chi conduce e chi parla, in testa alla gestione dell'evento, sotto gli
 * enti organizzatori. La pagina pubblica mostra solo le persone che si e'
 * scelto di presentare («Mostra nella pagina pubblica»), e gli inviti mai:
 * chi ha appena creato l'evento e lo apre per controllarlo deve ritrovarci
 * tutte le persone che ha inserito, senza cercarle fra le schede. I gruppi e
 * le parole sono quelli del riepilogo del wizard, dove le ha appena viste. Il
 * dettaglio (email, link, inviti uno per uno) resta nella scheda «Persone»,
 * a cui porta il pulsante in fondo.
 */

export interface PersonaConcessa {
  id: string;
  name: string;
  role: 'MODERATOR' | 'SPEAKER';
  /** Conduce con il segno di organizzatore: sta fra chi organizza. */
  organizer: boolean;
  revokedAt: string | null;
}

interface EventPeopleSummaryProps {
  /** Il moderatore principale (il link di conduzione dell'evento). */
  moderatorName: string | null;
  eventModerators: PersonaConcessa[];
  /** Gli inviti da mostrare; 0 per chi non vede la loro sezione. */
  invitationCount: number;
  /** Apre la scheda «Persone». */
  onPeople: () => void;
  style?: CSSProperties;
}

export default function EventPeopleSummary({
  moderatorName,
  eventModerators,
  invitationCount,
  onPeople,
  style,
}: EventPeopleSummaryProps) {
  const t = useTranslations('admin');
  const ts = useTranslations('admin.wizard.step5.summary');
  const attive = eventModerators
    .filter((m) => !m.revokedAt)
    .map((m) => ({ ...m, name: m.name.trim() }))
    .filter((m) => m.name);
  const principale = moderatorName?.trim() ?? '';
  const gruppi: Array<[string, string]> = [
    [ts('primaryOrganizer'), principale],
    [
      ts('organizersPeople'),
      nomi(attive.filter((m) => m.role === 'MODERATOR' && m.organizer)),
    ],
    [
      ts('moderators'),
      nomi(attive.filter((m) => m.role === 'MODERATOR' && !m.organizer)),
    ],
    [ts('speakers'), nomi(attive.filter((m) => m.role === 'SPEAKER'))],
    [ts('invitations'), invitationCount > 0 ? String(invitationCount) : ''],
  ];
  const righe = gruppi.filter(([, valore]) => valore);
  if (righe.length === 0) return null;

  return (
    <div className="mt-1" style={style} data-testid="event-people-summary">
      <dl className="mb-0">
        {righe.map(([etichetta, valore]) => (
          <div key={etichetta} className="d-flex flex-wrap gap-2">
            <dt className="fw-semibold">{etichetta}:</dt>
            <dd className="mb-0">{valore}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className="btn btn-link p-0 align-baseline"
        style={{ fontSize: 'inherit' }}
        onClick={onPeople}
      >
        {t('eventDetail.peopleTabLink', { tab: t('eventDetail.tabs.people') })}
      </button>
    </div>
  );
}

function nomi(persone: Array<{ name: string }>): string {
  return persone.map((p) => p.name).join(', ');
}

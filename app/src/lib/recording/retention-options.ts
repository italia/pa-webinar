// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Le scelte per la durata della registrazione di un evento
 * (`Event.recordingDeleteAfterDays`, e il suo valore di partenza nei modelli):
 * le stesse nel pannello della registrazione, nel wizard e nei modelli. I giorni
 * contano dalla pubblicazione finche' il video e' pubblicato, altrimenti dalla
 * fine dell'evento (lib/gdpr/cleanup-selection). `NESSUNA_CANCELLAZIONE` e' la
 * scelta senza durata, che si salva come null. Le etichette sono le chiavi del
 * catalogo `recording`.
 */
export const NESSUNA_CANCELLAZIONE = -1;

export const RETENTION_OPTIONS = [
  { value: 1, labelKey: 'retention.24h' },
  { value: 7, labelKey: 'retention.7d' },
  { value: 30, labelKey: 'retention.30d' },
  { value: 90, labelKey: 'retention.90d' },
  { value: 365, labelKey: 'retention.1y' },
  { value: NESSUNA_CANCELLAZIONE, labelKey: 'retention.forever' },
] as const;

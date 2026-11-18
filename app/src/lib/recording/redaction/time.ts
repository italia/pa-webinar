// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * I tempi dell'editor di rimozione, come li mostra il player: ore, minuti,
 * secondi e un decimo. Logica pura, usata anche dal browser.
 */

/** 75.25 → "1:15.3"; 3725 → "1:02:05.0". */
export function formatTempo(secondi: number): string {
  const decimi = Math.max(0, Math.round(secondi * 10));
  const s = Math.floor(decimi / 10);
  const ore = Math.floor(s / 3600);
  const minuti = Math.floor((s % 3600) / 60);
  const resto = `${String(s % 60).padStart(2, '0')}.${decimi % 10}`;
  return ore > 0
    ? `${ore}:${String(minuti).padStart(2, '0')}:${resto}`
    : `${minuti}:${resto}`;
}

/** "1:15.3" → 75.3, "90" → 90, "1:02:05" → 3725; null se non e' un tempo. */
export function leggiTempo(testo: string): number | null {
  const pulito = testo.trim().replace(',', '.');
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(pulito)) return null;
  const [intero, decimale = ''] = pulito.split('.');
  const parti = intero!.split(':').map(Number);
  if (parti.slice(1).some((p) => p >= 60)) return null;
  const secondi = parti.reduce((tot, p) => tot * 60 + p, 0);
  return decimale ? secondi + Number(`0.${decimale}`) : secondi;
}

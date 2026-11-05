/**
 * Dove e quanto grandi vedere i sottotitoli: una scelta di chi guarda,
 * ricordata nel suo browser (come quella di vederli o no, in
 * toolbar-button.ts).
 */

export const DIMENSIONI_SOTTOTITOLI = ['piccoli', 'medi', 'grandi'] as const;
export type DimensioneSottotitoli = (typeof DIMENSIONI_SOTTOTITOLI)[number];

export interface PreferenzeSottotitoli {
  posizione: 'basso' | 'alto';
  dimensione: DimensioneSottotitoli;
}

const CHIAVE = 'pawebinar.captions.layout';
const PREDEFINITE: PreferenzeSottotitoli = { posizione: 'basso', dimensione: 'medi' };

export function leggiPreferenzeSottotitoli(): PreferenzeSottotitoli {
  try {
    const grezzo = JSON.parse(
      window.localStorage.getItem(CHIAVE) ?? 'null'
    ) as Partial<PreferenzeSottotitoli> | null;
    return {
      posizione: grezzo?.posizione === 'alto' ? 'alto' : 'basso',
      dimensione: DIMENSIONI_SOTTOTITOLI.includes(
        grezzo?.dimensione as DimensioneSottotitoli
      )
        ? (grezzo?.dimensione as DimensioneSottotitoli)
        : PREDEFINITE.dimensione,
    };
  } catch {
    return { ...PREDEFINITE };
  }
}

export function scriviPreferenzeSottotitoli(p: PreferenzeSottotitoli): void {
  try {
    window.localStorage.setItem(CHIAVE, JSON.stringify(p));
  } catch {
    // Archiviazione non disponibile (finestra privata): resta la scelta della sessione.
  }
}

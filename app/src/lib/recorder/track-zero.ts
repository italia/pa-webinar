/**
 * Lo zero comune delle tracce di una registrazione multitraccia.
 *
 * Le tracce di un'esecuzione del recorder hanno gli offset relativi al suo
 * primo fotogramma. Se il pod del recorder viene ricreato a diretta in corso,
 * la seconda esecuzione manda il suo manifest con uno zero suo, più tardi:
 * sovrascrivere lo zero della registrazione spostava le tracce della prima
 * e lasciava le nuove fuori posto. Qui si tiene lo zero più vecchio e si
 * riportano le altre tracce su quello.
 *
 * LOGICA PURA: la rotta d'ingest la applica dentro la sua transazione.
 */

export interface ZeroUnito {
  /** Lo zero della registrazione dopo questo manifest. */
  zero: Date;
  /** Da aggiungere agli offset delle tracce gia' salvate. */
  spostaEsistentiMs: number;
  /** Da aggiungere agli offset delle tracce di questo manifest. */
  spostaNuoveMs: number;
}

export function unisciZero(opts: {
  /** Lo zero gia' salvato sulla registrazione, se c'e'. */
  esistente: Date | null;
  /** Se la registrazione ha gia' tracce salvate con quello zero. */
  conTracce: boolean;
  /** Lo zero del manifest in arrivo (epoch ms). */
  arrivoMs: number;
}): ZeroUnito {
  const { esistente, conTracce, arrivoMs } = opts;
  // Senza tracce precedenti lo zero salvato non vale per nessuna traccia: si
  // prende il nuovo.
  if (!esistente || !conTracce) {
    return { zero: new Date(arrivoMs), spostaEsistentiMs: 0, spostaNuoveMs: 0 };
  }
  const esistenteMs = esistente.getTime();
  if (arrivoMs >= esistenteMs) {
    return {
      zero: esistente,
      spostaEsistentiMs: 0,
      spostaNuoveMs: arrivoMs - esistenteMs,
    };
  }
  return {
    zero: new Date(arrivoMs),
    spostaEsistentiMs: esistenteMs - arrivoMs,
    spostaNuoveMs: 0,
  };
}

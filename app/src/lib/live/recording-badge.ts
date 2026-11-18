// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { RegolaConsenso } from './consent-rule';

/**
 * Come una persona e' nella registrazione, nell'elenco dei partecipanti:
 *  - `video`: chi conduce o interviene, sempre nel video con nome e immagine;
 *  - `voce`: chi partecipa con il consenso, di cui si registra solo la voce;
 *  - `nessuna`: chi partecipa senza consenso, nemmeno la voce.
 * La decide il server (GET /api/events/{slug}/seats) dal posto e dal segno del
 * token (`RoomOccupant`); la propria la sala la conosce dal suo token.
 */
export type PresenzaNellaRegistrazione = 'video' | 'voce' | 'nessuna';

/**
 * Per chi l'elenco mostra la presenza nella registrazione:
 *  - `tutti`: ogni riga, dove chi partecipa sceglie se la sua voce entra (il
 *    consenso si chiede a chi puo' parlare), e nella chiamata rapida mentre si
 *    registra;
 *  - `mani`: solo chi chiede la parola, dove il pubblico non parla e riceve
 *    soltanto un avviso: un segno su ogni riga riempirebbe l'elenco;
 *  - `nessuno`: dove non si registra, dove chi non acconsente resta in solo
 *    ascolto (lo dice gia' il suo segno), o dove chi partecipa non entra mai nel
 *    video, nemmeno con la voce (`voceDallaTrascrizione`): non c'e' un consenso
 *    alla registrazione da mostrare.
 * Chi modera vede le righe di tutti, chi partecipa solo la propria.
 */
export type ElencoRegistrazione = 'tutti' | 'mani' | 'nessuno';

export function elencoRegistrazione(i: {
  regola: RegolaConsenso;
  istantanea: boolean;
  /** La registrazione e' in corso (conta solo nelle chiamate rapide). */
  inCorso: boolean;
}): ElencoRegistrazione {
  if (!i.regola.registra || i.regola.soloAscolto || i.regola.voceDallaTrascrizione) return 'nessuno';
  if (i.istantanea) return i.inCorso ? 'tutti' : 'nessuno';
  return i.regola.richiesto ? 'tutti' : 'mani';
}

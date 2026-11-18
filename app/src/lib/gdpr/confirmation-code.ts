// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { createHash, createHmac, timingSafeEqual } from 'crypto';

import { requireAppSecret } from '@/lib/auth/app-secret';

/**
 * Il codice di conferma delle modifiche a un'iscrizione dalla pagina dei propri
 * dati: correggere nome ed ente, cancellare l'iscrizione.
 *
 * La pagina si apre con il link dell'email, firmato e valido un'ora ma non a uso
 * singolo, e riceve un token per agire che vale quanto il link: chi lo ha visto
 * (una cronologia su un computer condiviso, un'email inoltrata) puo' leggere i
 * dati e ritirare un consenso per tutta l'ora. Per cancellare o riscrivere dati
 * non basta: la cancellazione completa chiede gia' un link a parte, e queste
 * azioni chiedono una prova fresca della casella. La pagina chiede il codice, il
 * server lo manda all'indirizzo dell'iscrizione, la persona lo scrive nella
 * stessa pagina.
 *
 * Il codice non si salva: e' un HMAC con `APP_SECRET` di azione, impronta
 * dell'indirizzo, iscrizione (o tutto l'indirizzo), impronta dei valori nuovi e
 * ora di emissione, ridotto a sei cifre. Vale solo per quella richiesta: con un
 * nome diverso, per un'altra iscrizione o un'altra azione non torna. Dura
 * `DURATA_CODICE_MINUTI`. Rifatto con gli stessi dati entro la durata ripete la
 * stessa modifica, che non cambia niente, o non trova piu' l'iscrizione
 * cancellata: in pratica vale una volta. I tentativi sono limitati per indirizzo
 * e per IP dalle rotte (api/gdpr/registrations).
 */

export const DURATA_CODICE_MINUTI = 15;
const DURATA_CODICE_SECONDI = DURATA_CODICE_MINUTI * 60;

export type AzioneConfermata = 'edit' | 'cancel';

export interface RichiestaConfermata {
  azione: AzioneConfermata;
  emailHash: string;
  /** L'iscrizione toccata, o `address:` per tutte quelle dell'indirizzo. */
  oggetto: string;
  /** L'impronta dei valori nuovi (`improntaValori`); vuota per la cancellazione. */
  impronta: string;
}

/** L'impronta dei valori di una correzione: il codice vale solo per quelli. */
export function improntaValori(valori: Record<string, string | null>): string {
  const ordinati = Object.keys(valori)
    .sort()
    .map((k) => [k, valori[k] ?? null]);
  return createHash('sha256').update(JSON.stringify(ordinati)).digest('hex');
}

function cifre(r: RichiestaConfermata, emessoIl: number): string {
  const mac = createHmac('sha256', requireAppSecret())
    .update(
      [
        'gdpr-confirmation-code',
        r.azione,
        r.emailHash,
        r.oggetto,
        r.impronta,
        emessoIl,
      ].join('\n')
    )
    .digest();
  return String(mac.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

/** Il codice e il momento di emissione, in secondi: la pagina lo rimanda. */
export function emettiCodice(
  r: RichiestaConfermata,
  adesso: Date = new Date()
): { codice: string; emessoIl: number } {
  const emessoIl = Math.floor(adesso.getTime() / 1000);
  return { codice: cifre(r, emessoIl), emessoIl };
}

export function verificaCodice(
  r: RichiestaConfermata,
  emessoIl: number,
  codice: string,
  adesso: Date = new Date()
): boolean {
  if (!Number.isSafeInteger(emessoIl) || !/^\d{6}$/.test(codice)) return false;
  const eta = Math.floor(adesso.getTime() / 1000) - emessoIl;
  if (eta < 0 || eta > DURATA_CODICE_SECONDI) return false;
  return timingSafeEqual(Buffer.from(cifre(r, emessoIl)), Buffer.from(codice));
}

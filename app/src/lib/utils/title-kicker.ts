// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

export interface KickerParts {
  kicker: string | null;
  main: string;
}

export function splitTitleKicker(title: string, enabled: boolean): KickerParts {
  if (!enabled) return { kicker: null, main: title };
  const idx = title.indexOf('|');
  if (idx === -1) return { kicker: null, main: title };
  const kicker = title.slice(0, idx).trim();
  const main = title.slice(idx + 1).trim();
  if (!kicker || !main) return { kicker: null, main: title };
  return { kicker, main };
}

/**
 * Il titolo diviso nei due campi del modulo, sopratitolo e titolo. Come la
 * pagina: con il sopratitolo spento il titolo resta intero. A differenza di
 * `splitTitleKicker` tiene il sopratitolo anche quando il titolo dopo «|»
 * e' ancora vuoto (lo si sta scrivendo).
 */
export function dividiTitolo(
  titolo: string,
  acceso: boolean,
): { sopra: string; titolo: string } {
  const idx = acceso ? titolo.indexOf('|') : -1;
  const sopra = idx === -1 ? '' : titolo.slice(0, idx).trim();
  if (!sopra) return { sopra: '', titolo };
  return { sopra, titolo: titolo.slice(idx + 1).trim() };
}

/**
 * Il titolo salvato dai due campi: «Sopratitolo | Titolo», o il solo titolo.
 * Senza titolo non si salva niente: un sopratitolo da solo la pagina lo
 * mostrerebbe come titolo, con il «|» in fondo (e una lingua cosi' non
 * sarebbe piu' vuota: niente ripiego ne' traduzione). Finche' il titolo
 * manca, il sopratitolo resta in scrittura nel wizard.
 */
export function componiTitolo(sopra: string, titolo: string): string {
  if (!titolo.trim()) return '';
  const s = sopra.trim();
  return s ? `${s} | ${titolo}` : titolo;
}

/**
 * Resolve the effective kicker-enabled flag for an event, honouring the
 * per-event override (null = inherit) on top of the site-wide default.
 * Centralised here so every render path (pages, listings, live, emails)
 * applies the same precedence.
 */
export function resolveKickerEnabled(
  event: { parseTitleKicker?: boolean | null },
  siteDefault: boolean,
): boolean {
  return event.parseTitleKicker ?? siteDefault;
}

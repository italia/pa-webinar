/**
 * Quanto vale il link di accesso dello staff (ADR-014). Sta qui, e non nel
 * modulo che lo emette, perche' lo legge anche la pagina di login: il testo
 * che promette la durata e la durata vera devono venire dallo stesso numero.
 */
export const DURATA_LINK_MINUTI = 20;

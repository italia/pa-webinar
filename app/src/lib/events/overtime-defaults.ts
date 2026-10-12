/**
 * Valori predefiniti del fuori orario, gli stessi dei default delle colonne di
 * `SiteSetting` in `prisma/schema.prisma`. Un modulo senza dipendenze, perché
 * li leggono anche i componenti client (modulo delle impostazioni, sala).
 */

/** Tetto in minuti dopo `endsAt` per una sala ancora occupata. */
export const OVERTIME_CAP_DEFAULT_MINUTES = 60;

/** Minuti di sala vuota dopo cui una sala oltre `endsAt` si chiude. */
export const OVERTIME_EMPTY_DEFAULT_MINUTES = 20;

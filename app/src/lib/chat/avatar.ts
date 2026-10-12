/**
 * Avatar a iniziali delle persone in sala (chat, domande, anteprime): stesso
 * nome, stesso colore, ovunque compaia. Colori del design system con contrasto
 * sufficiente per il testo bianco.
 */

const AVATAR_COLORS = [
  '#0066CC', '#008758', '#A66300', '#D9364F',
  '#6A50D3', '#00A8B3', '#B23683', '#73348C',
];

/** Colore stabile per una chiave (nome o chiave opaca del mittente). */
export function avatarColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? '#0066CC';
}

/** Fino a due iniziali, in maiuscolo: «Laura Conti» → «LC». */
export function avatarInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

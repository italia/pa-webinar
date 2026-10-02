/**
 * Un indirizzo scritto senza schema («www.comune.it», «www.comune.it:8080/x»)
 * diventa https://…: nei pannelli lo si scrive cosi', e senza schema non e'
 * un URL. Restano come sono un indirizzo che lo schema ce l'ha gia'
 * (`https://`, `data:`, `mailto:`, `tel:`), un percorso del sito («/privacy»)
 * e un'ancora («#contatti»): dove il campo vuole un URL assoluto, il percorso
 * resta rifiutato dalla validazione.
 *
 * Senza dipendenze, perche' lo usano sia la validazione sul server sia i
 * campi del browser.
 */
const CON_SCHEMA = /^[a-z][a-z0-9+.-]*:\/\//i;
const SCHEMI_SENZA_BARRE = /^(data|mailto|tel):/i;

export function withScheme(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!s || s.startsWith('/') || s.startsWith('#') || CON_SCHEMA.test(s) || SCHEMI_SENZA_BARRE.test(s)) {
    return s;
  }
  return `https://${s}`;
}

/**
 * Colori delle etichette (tag) leggibili. Il colore di un'etichetta lo sceglie
 * chi amministra: usato tale e quale come testo sulla sua tinta chiara, o
 * come fondo sotto il testo bianco, spesso non arriva al contrasto minimo
 * (WCAG 1.4.3, 4,5:1). Qui lo stesso colore si scurisce quanto basta.
 */

type Rgb = [number, number, number];

/**
 * Contrasto cercato: 4,5:1 più un margine. La tinta si calcola sul bianco,
 * ma i filtri stanno su pannelli grigio chiaro, dove il fondo è più scuro.
 */
const CONTRASTO_MINIMO = 5.2;

function rgb(hex: string): Rgb | null {
  const pulito = hex.trim().replace(/^#/, '');
  const pieno =
    pulito.length === 3
      ? pulito
          .split('')
          .map((c) => c + c)
          .join('')
      : pulito;
  if (!/^[0-9a-f]{6}$/i.test(pieno)) return null;
  return [0, 2, 4].map((i) => parseInt(pieno.slice(i, i + 2), 16)) as Rgb;
}

function esadecimale(c: Rgb): string {
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function lineare(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminanza([r, g, b]: Rgb): number {
  return 0.2126 * lineare(r) + 0.7152 * lineare(g) + 0.0722 * lineare(b);
}

function contrasto(a: Rgb, b: Rgb): number {
  const la = luminanza(a);
  const lb = luminanza(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function scurito(c: Rgb, quanto: number): Rgb {
  return c.map((v) => v * (1 - quanto)) as Rgb;
}

/** Il primo colore, dal più vicino all'originale, che regge il confronto. */
function scurisciFinché(c: Rgb, regge: (x: Rgb) => boolean): Rgb {
  for (let passo = 0; passo <= 20; passo++) {
    const x = scurito(c, passo * 0.05);
    if (regge(x)) return x;
  }
  return [0, 0, 0];
}

/** `#rrggbb` con trasparenza, come `rgba()`. Un colore non valido resta com'è. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const c = rgb(hex);
  if (!c) return hex;
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

/**
 * Il colore del testo di un'etichetta disegnata sulla sua tinta (il colore
 * all'opacità `alpha` sopra il bianco).
 */
export function inchiostroEtichetta(color: string, alpha: number): string {
  const c = rgb(color);
  if (!c) return color;
  const fondo = c.map((v) => v * alpha + 255 * (1 - alpha)) as Rgb;
  return esadecimale(scurisciFinché(c, (x) => contrasto(x, fondo) >= CONTRASTO_MINIMO));
}

/** Il fondo di un'etichetta piena (selezionata), sotto un testo bianco. */
export function fondoEtichettaPiena(color: string): string {
  const c = rgb(color);
  if (!c) return color;
  return esadecimale(
    scurisciFinché(c, (x) => contrasto(x, [255, 255, 255]) >= CONTRASTO_MINIMO)
  );
}

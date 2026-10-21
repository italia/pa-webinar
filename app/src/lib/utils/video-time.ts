/**
 * Un istante di un video come lo legge chi guarda: m:ss, o h:mm:ss oltre
 * l'ora. Lo stesso nel lettore e accanto al video (le slide), così i tempi
 * coincidono. Un valore che non è un numero, o negativo, vale zero.
 */
export function formatVideoTime(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const due = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${due(m)}:${due(r)}` : `${m}:${due(r)}`;
}

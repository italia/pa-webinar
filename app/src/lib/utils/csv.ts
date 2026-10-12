/**
 * Una cella CSV sicura da aprire in un foglio di calcolo: un valore che
 * comincia come una formula (=, +, -, @, tabulazione, a capo) si neutralizza
 * con un apice, e le virgolette si raddoppiano. Il separatore e' il punto e
 * virgola, quello che i fogli di calcolo con impostazioni europee si aspettano.
 */
export const CSV_SEPARATOR = ';';

export function csvCell(v: string): string {
  const sicuro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r;]/.test(sicuro) ? `"${sicuro.replace(/"/g, '""')}"` : sicuro;
}

/** Righe gia' pronte (intestazione compresa) in un testo CSV. */
export function csvText(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(CSV_SEPARATOR)).join('\r\n') + '\r\n';
}

/**
 * Copia un testo negli appunti e dice se ci e' riuscita.
 *
 * Dire «copiato» quando non e' vero e' peggio che non dire niente: chi
 * incolla si ritrova quello che aveva negli appunti da prima (magari un
 * altro link della stessa pagina). Il ripiego con `execCommand` non lancia
 * quando fallisce, RESTITUISCE falso: per questo si guarda il valore di
 * ritorno invece di fidarsi del try.
 */
export async function copiaNegliAppunti(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (typeof document === 'undefined') return false;
    // Il ripiego sposta il fuoco su un campo d'appoggio: lo si riporta dove
    // era, altrimenti chi usa la tastiera o un lettore di schermo ripartirebbe
    // dall'inizio della pagina.
    const prima =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    // Safari su iOS non seleziona con select() un campo in sola lettura.
    ta.setSelectionRange(0, text.length);
    let riuscita = false;
    try {
      riuscita = document.execCommand('copy');
    } catch {
      riuscita = false;
    }
    ta.remove();
    prima?.focus();
    return riuscita;
  }
}

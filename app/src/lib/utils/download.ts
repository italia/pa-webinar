/**
 * Salva come file il corpo di una risposta gia' ricevuta (un CSV chiesto con
 * le credenziali della pagina: il token non finisce in un indirizzo). Il
 * collegamento si aggiunge alla pagina per il clic e l'indirizzo del blob si
 * revoca al giro dopo: revocarlo subito puo' interrompere il download in
 * alcuni browser.
 */
export async function salvaRisposta(res: Response, nomeFile: string): Promise<void> {
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * L'indirizzo dell'inventario dei servizi (`SERVICE_INVENTORY_URL`), o null se
 * non e' impostato: la pagina, il piè di pagina e la home lo leggono da qui,
 * cosi' un valore di soli spazi non mostra il link senza la pagina.
 */
export function serviceInventoryUrl(): string | null {
  const url = process.env.SERVICE_INVENTORY_URL?.trim();
  return url ? url : null;
}

/**
 * Il testo di partenza di una traduzione automatica di titolo e descrizione,
 * e la sua impronta.
 *
 * L'impronta dice da quale testo viene una proposta di traduzione
 * (Event.textTranslations.sourceHash): il wizard la ricalcola sul testo del
 * modulo e offre le proposte solo se coincide, la pagina dell'evento sul
 * testo salvato. Si calcola con Web Crypto, che c'e' sia nel browser sia in
 * Node, cosi' il valore e' lo stesso dalle due parti.
 */

export interface TestoSorgente {
  sourceLanguage: string;
  title: string;
  description: string;
}

/** Il testo di partenza nella lingua `lingua`, dai campi multilingue. */
export function testoSorgente(
  lingua: string,
  titoli: Record<string, string> | null | undefined,
  descrizioni: Record<string, string> | null | undefined
): TestoSorgente {
  return {
    sourceLanguage: lingua,
    title: (titoli?.[lingua] ?? '').trim(),
    description: (descrizioni?.[lingua] ?? '').trim(),
  };
}

/**
 * L'impronta SHA-256 (esadecimale) del testo di partenza. Null dove il
 * browser non offre Web Crypto (una pagina servita in chiaro fuori da
 * localhost): li' le proposte salvate non si possono confrontare.
 */
export async function improntaSorgente(sorgente: TestoSorgente): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const dati = new TextEncoder().encode(
    JSON.stringify([
      sorgente.sourceLanguage,
      sorgente.title.trim(),
      sorgente.description.trim(),
    ])
  );
  const digest = await subtle.digest('SHA-256', dati);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
    ''
  );
}

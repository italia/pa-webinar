/**
 * L'umore della piazza: ognuno può dire come arriva, e accanto al laboratorio
 * un cartello conta quanti per ciascuno. Si vedono solo i conteggi, non chi;
 * l'umore vive quanto la presenza in piazza (il server non lo conserva oltre
 * il ping).
 */
export const UMORI = ['felice', 'curioso', 'assonnato', 'carico'] as const;
export type Umore = (typeof UMORI)[number];

export const UMORE_GLIFO: Record<Umore, string> = {
  felice: '😊',
  curioso: '🤔',
  assonnato: '😴',
  carico: '🚀',
};

export function eUmore(v: unknown): v is Umore {
  return typeof v === 'string' && (UMORI as readonly string[]).includes(v);
}

/** Quanti per ciascun umore. */
export function contaUmori(umori: readonly (Umore | null | undefined)[]): Record<Umore, number> {
  const conti: Record<Umore, number> = { felice: 0, curioso: 0, assonnato: 0, carico: 0 };
  for (const u of umori) if (u) conti[u] += 1;
  return conti;
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { copiaNegliAppunti } from '@/lib/utils/clipboard';

export type EsitoCopia = 'copiato' | 'fallito' | null;

/**
 * Copia con l'esito da mostrare per un attimo («Copiato!» o «Copia non
 * riuscita»). Un nuovo clic azzera il timer del precedente: altrimenti la
 * conferma del secondo sparirebbe allo scadere del primo.
 */
export function useCopia(): {
  esito: EsitoCopia;
  copia: (text: string) => Promise<boolean>;
} {
  const [esito, setEsito] = useState<EsitoCopia>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copia = useCallback(async (text: string) => {
    const riuscita = await copiaNegliAppunti(text);
    if (timer.current) clearTimeout(timer.current);
    setEsito(riuscita ? 'copiato' : 'fallito');
    timer.current = setTimeout(() => setEsito(null), riuscita ? 2000 : 4000);
    return riuscita;
  }, []);

  return { esito, copia };
}

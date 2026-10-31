'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Una tendina (menu a discesa) come quelle del design system: si apre e
 * chiude dal suo pulsante, si chiude con Esc (il fuoco torna al pulsante) e
 * con un clic fuori.
 */
export function useTendina<C extends HTMLElement = HTMLDivElement>() {
  const [aperta, setAperta] = useState(false);
  const contenitore = useRef<C>(null);
  const pulsante = useRef<HTMLButtonElement>(null);
  const chiudi = useCallback(() => setAperta(false), []);

  useEffect(() => {
    if (!aperta) return;
    const fuori = (e: MouseEvent) => {
      if (contenitore.current && !contenitore.current.contains(e.target as Node))
        setAperta(false);
    };
    const tasto = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setAperta(false);
      pulsante.current?.focus();
    };
    // Il fuoco che esce dalla tendina (Tab verso la voce successiva della
    // barra) la chiude: due tendine aperte si coprirebbero.
    const nodo = contenitore.current;
    const uscita = (e: FocusEvent) => {
      const verso = e.relatedTarget as Node | null;
      if (verso && nodo && !nodo.contains(verso)) setAperta(false);
    };
    document.addEventListener('mousedown', fuori);
    document.addEventListener('keydown', tasto);
    nodo?.addEventListener('focusout', uscita);
    return () => {
      document.removeEventListener('mousedown', fuori);
      document.removeEventListener('keydown', tasto);
      nodo?.removeEventListener('focusout', uscita);
    };
  }, [aperta]);

  return { aperta, setAperta, chiudi, contenitore, pulsante };
}

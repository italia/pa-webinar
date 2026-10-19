'use client';

import { useEffect, useState } from 'react';

import { rapportoFasciaCopertina } from '@/lib/events/cover-band';

/** La forma della copertina nella pagina vera, aggiornata quando la finestra
 *  cambia misura (solo se cambia davvero). */
export function useFasciaCopertina(): number {
  const [rapporto, setRapporto] = useState(() => rapportoFasciaCopertina());
  useEffect(() => {
    const aggiorna = () => {
      const nuovo = rapportoFasciaCopertina({
        width: window.innerWidth,
        height: window.innerHeight,
      });
      setRapporto((prima) => (Math.abs(prima - nuovo) < 0.01 ? prima : nuovo));
    };
    aggiorna();
    window.addEventListener('resize', aggiorna);
    return () => window.removeEventListener('resize', aggiorna);
  }, []);
  return rapporto;
}

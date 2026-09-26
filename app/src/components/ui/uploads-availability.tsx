'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Se questa installazione ha uno storage per i file caricati.
 *
 * Lo decide il server (`getFilesStorage() !== null`) e lo passa qui una volta
 * per tutta l'area admin: senza storage i campi "file o URL" mostrano solo
 * l'URL invece di offrire un caricamento destinato a fallire. Fuori dal
 * provider vale `true`, il comportamento di sempre: il campo prova a caricare
 * e, se il server risponde che lo storage manca, lo dice.
 */
const UploadsAvailabilityContext = createContext<boolean>(true);

export function UploadsAvailabilityProvider({
  available,
  children,
}: {
  available: boolean;
  children: ReactNode;
}) {
  return (
    <UploadsAvailabilityContext.Provider value={available}>
      {children}
    </UploadsAvailabilityContext.Provider>
  );
}

export function useUploadsAvailable(): boolean {
  return useContext(UploadsAvailabilityContext);
}

'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Se chi sta guardando la pagina puo' caricare file, e se no perche'.
 *
 * Lo decide il server una volta per tutta l'area admin: serve uno storage per
 * i file (`getFilesStorage() !== null`) e una sessione dello staff, perche' la
 * rotta di caricamento la chiede. Chi modifica un evento con il solo link di
 * conduzione non ce l'ha: senza questa informazione il campo gli offrirebbe
 * un caricamento destinato a un 401. Dove non si puo' caricare i campi «file
 * o link» mostrano solo il link, con il motivo.
 *
 * Fuori dal provider vale «disponibile», il comportamento di sempre: il campo
 * prova a caricare e, se il server risponde con un errore, lo dice.
 */
export type MotivoSenzaCaricamento = 'storage' | 'sessione';

interface DisponibilitaCaricamento {
  disponibile: boolean;
  motivo: MotivoSenzaCaricamento | null;
}

const UploadsAvailabilityContext = createContext<DisponibilitaCaricamento>({
  disponibile: true,
  motivo: null,
});

export function UploadsAvailabilityProvider({
  available,
  reason,
  children,
}: {
  available: boolean;
  /** Perche' non si puo' caricare; senza, vale la mancanza di storage. */
  reason?: MotivoSenzaCaricamento | null;
  children: ReactNode;
}) {
  const valore: DisponibilitaCaricamento = available
    ? { disponibile: true, motivo: null }
    : { disponibile: false, motivo: reason ?? 'storage' };
  return (
    <UploadsAvailabilityContext.Provider value={valore}>
      {children}
    </UploadsAvailabilityContext.Provider>
  );
}

export function useUploadsAvailable(): boolean {
  return useContext(UploadsAvailabilityContext).disponibile;
}

/** Perche' il caricamento non c'e': null se c'e'. */
export function useUploadsReason(): MotivoSenzaCaricamento | null {
  return useContext(UploadsAvailabilityContext).motivo;
}

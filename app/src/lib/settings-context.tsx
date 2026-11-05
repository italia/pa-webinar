// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { createContext, useContext } from 'react';

import type { ImpostazioniPubbliche } from '@/lib/settings/public-projection';

const SettingsContext = createContext<ImpostazioniPubbliche | null>(null);

// Cio' che passa di qui finisce nell'HTML di ogni pagina pubblica.
export function SettingsProvider({
  settings,
  children,
}: {
  settings: ImpostazioniPubbliche;
  children: React.ReactNode;
}) {
  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): ImpostazioniPubbliche {
  const ctx = useContext(SettingsContext);
  if (!ctx)
    throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

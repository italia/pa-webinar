'use client';

import { createContext, useContext } from 'react';
import type { SiteSetting } from '@prisma/client';

const SettingsContext = createContext<SiteSetting | null>(null);

export function SettingsProvider({
  settings,
  children,
}: {
  settings: SiteSetting;
  children: React.ReactNode;
}) {
  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SiteSetting {
  const ctx = useContext(SettingsContext);
  if (!ctx)
    throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

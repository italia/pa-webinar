import { vi } from 'vitest';

// Fuori da una richiesta `cookies()` di Next lancia: e' l'unica cosa finta di
// queste prove, insieme allo storage dei file dove serve.
vi.mock('next/headers', async () => {
  const { biscotti } = await import('./biscotti');
  return {
    cookies: async () => ({
      get: (nome: string) => {
        const value = biscotti.get(nome);
        return value === undefined ? undefined : { name: nome, value };
      },
    }),
  };
});

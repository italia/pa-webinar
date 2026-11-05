// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lo staff dietro il link primario: solo con la sessione di un account che
 * gestisce l'evento e ha un nome; la chiave dell'istanza e gli altri restano
 * il posto condiviso.
 */
const stato = vi.hoisted(() => ({
  cookie: true as boolean,
  sessione: null as Record<string, unknown> | null,
  gestisce: true,
  nome: 'Ada Rossi' as string | null,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) =>
      stato.cookie && n === 'admin_session' ? { value: 'x' } : undefined,
  }),
}));
vi.mock('react', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  cache: <T>(fn: T) => fn,
}));
vi.mock('./staff-session', () => ({
  getStaffSession: vi.fn(async () => stato.sessione),
  puoGestire: vi.fn(async () => stato.gestisce),
  staffPerIntestazione: vi.fn(async () => ({ ruolo: 'organizer', nome: stato.nome })),
}));

import { getStaffSession } from './staff-session';
import { staffDietroIlPrimario } from './staff-seat';

beforeEach(() => {
  stato.cookie = true;
  stato.sessione = { role: 'organizer', accountId: 'acc-1', emailHash: 'h' };
  stato.gestisce = true;
  stato.nome = 'Ada Rossi';
  vi.mocked(getStaffSession).mockClear();
});

describe('staffDietroIlPrimario', () => {
  it("un account che gestisce l'evento, con il suo nome", async () => {
    expect(await staffDietroIlPrimario('e1')).toEqual({
      accountId: 'acc-1',
      nome: 'Ada Rossi',
    });
  });

  it('senza il cookie della sessione non verifica nulla', async () => {
    stato.cookie = false;
    expect(await staffDietroIlPrimario('e1')).toBeNull();
    expect(getStaffSession).not.toHaveBeenCalled();
  });

  it("la chiave dell'istanza, un evento non suo o un nome che manca: il posto condiviso", async () => {
    stato.sessione = { role: 'admin', accountId: null };
    expect(await staffDietroIlPrimario('e1')).toBeNull();
    stato.sessione = { role: 'organizer', accountId: 'acc-1', emailHash: 'h' };
    stato.gestisce = false;
    expect(await staffDietroIlPrimario('e1')).toBeNull();
    stato.gestisce = true;
    stato.nome = '  ';
    expect(await staffDietroIlPrimario('e1')).toBeNull();
  });
});

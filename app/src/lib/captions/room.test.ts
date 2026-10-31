import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  registration: { findFirst: vi.fn(), findMany: vi.fn() },
  multitrackConsent: { findFirst: vi.fn(), findMany: vi.fn() },
  roomOccupant: { findUnique: vi.fn(), findMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string) => `chiaro:${v}` }));

import { consensoTrascrizione, endpointConConsenso, postoDellEndpoint } from './room';

const EVENTO = 'e1';
const ISCRIZIONE = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('consensoTrascrizione', () => {
  it('per la trascrizione non vale il consenso dato con il testo della sola traccia audio', async () => {
    db.registration.findFirst.mockResolvedValue({ displayName: 'nome', consentMultitrack: true, consentMultitrackVersion: null });
    db.multitrackConsent.findFirst.mockResolvedValue(null);
    expect(await consensoTrascrizione(EVENTO, `reg-${ISCRIZIONE}-ab12cd34`, 2)).toEqual({ dato: false, nome: null });
    // La prova in sala si cerca solo con il testo richiesto.
    expect(db.multitrackConsent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: EVENTO, registrationId: ISCRIZIONE, textVersion: { gte: 2 } } }),
    );
    // Per la traccia audio vale ancora.
    expect(await consensoTrascrizione(EVENTO, `reg-${ISCRIZIONE}-ab12cd34`, 1)).toEqual({
      dato: true,
      nome: 'chiaro:nome',
    });
  });

  it('un iscritto con il consenso dato all\'iscrizione, a ogni ingresso', async () => {
    db.registration.findFirst.mockResolvedValue({ displayName: 'nome', consentMultitrack: true, consentMultitrackVersion: 2 });
    db.multitrackConsent.findFirst.mockResolvedValue(null);
    const c = await consensoTrascrizione(EVENTO, `reg-${ISCRIZIONE}-ab12cd34`, 2);
    expect(c).toEqual({ dato: true, nome: 'chiaro:nome' });
    expect(db.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ISCRIZIONE, eventId: EVENTO } }),
    );
  });

  it('un iscritto che l\'ha dato in sala d\'attesa', async () => {
    db.registration.findFirst.mockResolvedValue({ displayName: 'nome', consentMultitrack: false });
    db.multitrackConsent.findFirst.mockResolvedValue({ displayName: 'in-sala' });
    expect(await consensoTrascrizione(EVENTO, `reg-${ISCRIZIONE}-ab12cd34`, 2)).toEqual({
      dato: true,
      nome: 'chiaro:in-sala',
    });
  });

  it('un iscritto senza consenso, o di un altro evento', async () => {
    db.registration.findFirst.mockResolvedValueOnce({ displayName: 'nome', consentMultitrack: false });
    db.multitrackConsent.findFirst.mockResolvedValueOnce(null);
    expect((await consensoTrascrizione(EVENTO, `reg-${ISCRIZIONE}-x`, 2)).dato).toBe(false);
    db.registration.findFirst.mockResolvedValueOnce(null);
    db.multitrackConsent.findFirst.mockResolvedValueOnce({ displayName: 'x' });
    expect((await consensoTrascrizione(EVENTO, `reg-${ISCRIZIONE}-x`, 2)).dato).toBe(false);
  });

  it('chi modera o un ospite: la prova di quel posto', async () => {
    db.multitrackConsent.findFirst.mockResolvedValue({ displayName: 'mod' });
    expect(await consensoTrascrizione(EVENTO, 'mod-e1-ab12cd34', 2)).toEqual({ dato: true, nome: 'chiaro:mod' });
    expect(db.multitrackConsent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: EVENTO, jitsiUserId: 'mod-e1-ab12cd34', textVersion: { gte: 2 } } }),
    );
    db.multitrackConsent.findFirst.mockResolvedValue(null);
    expect((await consensoTrascrizione(EVENTO, 'guest-abc', 2)).dato).toBe(false);
  });
});

describe('postoDellEndpoint', () => {
  it('il posto che Prosody ha legato all\'endpoint, o nessuno', async () => {
    db.roomOccupant.findUnique.mockResolvedValueOnce({ seatId: 'mod-e1-x' });
    expect(await postoDellEndpoint(EVENTO, 'ab12')).toBe('mod-e1-x');
    db.roomOccupant.findUnique.mockResolvedValueOnce(null);
    expect(await postoDellEndpoint(EVENTO, 'zz')).toBeNull();
  });
});

describe('endpointConConsenso', () => {
  const ALTRA = '99999999-2222-4333-8444-555555555555';
  it('la stessa regola di consensoTrascrizione, in poche letture', async () => {
    db.roomOccupant.findMany.mockResolvedValue([
      { endpointId: 'ep-iscritto', seatId: `reg-${ISCRIZIONE}-ab12cd34` },
      { endpointId: 'ep-vecchio-testo', seatId: `reg-${ALTRA}-ab12cd34` },
      { endpointId: 'ep-ospite', seatId: 'guest-1' },
      { endpointId: 'ep-ospite-no', seatId: 'guest-2' },
      { endpointId: 'ep-senza-posto', seatId: '' },
    ]);
    db.registration.findMany.mockResolvedValue([
      { id: ISCRIZIONE, consentMultitrack: true, consentMultitrackVersion: 2 },
      { id: ALTRA, consentMultitrack: true, consentMultitrackVersion: 1 },
    ]);
    db.multitrackConsent.findMany.mockResolvedValue([{ registrationId: null, jitsiUserId: 'guest-1' }]);

    const ammessi = await endpointConConsenso(EVENTO, ['ep-iscritto', 'ep-vecchio-testo', 'ep-ospite', 'ep-ospite-no', 'ep-senza-posto', 'ep-ignoto'], 2);
    expect([...ammessi].sort()).toEqual(['ep-iscritto', 'ep-ospite']);
    // Con la sola traccia audio vale anche il testo precedente.
    db.roomOccupant.findMany.mockResolvedValueOnce([{ endpointId: 'ep-vecchio-testo', seatId: `reg-${ALTRA}-ab12cd34` }]);
    db.multitrackConsent.findMany.mockResolvedValueOnce([]);
    const tracce = await endpointConConsenso(EVENTO, ['ep-vecchio-testo'], 1);
    expect([...tracce]).toEqual(['ep-vecchio-testo']);
  });

  it('nessun endpoint, nessuna lettura', async () => {
    expect((await endpointConConsenso(EVENTO, [], 2)).size).toBe(0);
    expect(db.roomOccupant.findMany).not.toHaveBeenCalled();
  });
});


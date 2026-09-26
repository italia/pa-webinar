import { describe, it, expect, vi } from 'vitest';

import { EventStatusSchedule } from './schedule-adapter';

/**
 * Presidio sulle tre attese della piazza.
 *
 * Il cancello disegna cose diverse — lucchetto e conto alla rovescia, cordone
 * rosso, porte aperte — a seconda di questo stato, e le due attese si
 * confondono facilmente: «non e' ancora ora» e «la stanza non c'e' ancora»
 * arrivano da due segnali diversi e finiscono nello stesso punto.
 */
describe('EventStatusSchedule', () => {
  it('evento in diretta e sala pronta: si entra', () => {
    expect(new EventStatusSchedule('LIVE', 0, false, true).getStatus()).toBe('live');
  });

  it('evento in diretta ma sala non pronta: cordone, non lucchetto', () => {
    // Col lucchetto la piazza direbbe «inizia tra 00:00» all'infinito, perche'
    // l'ora d'inizio e' gia' passata.
    expect(new EventStatusSchedule('LIVE', 0, false, false).getStatus()).toBe('preparing');
  });

  it('prima dell’ora si aspetta l’orologio, qualunque cosa dica il ponte', () => {
    const fraUnOra = Date.now() + 3_600_000;
    for (const s of ['PUBLISHED', 'IDLE', 'PROVISIONING'] as const) {
      expect(new EventStatusSchedule(s, fraUnOra, false, false).getStatus(), s).toBe('scheduled');
      expect(new EventStatusSchedule(s, fraUnOra, false, true).getStatus(), s).toBe('scheduled');
    }
  });

  it('passata l’ora, un evento non ancora avviato aspetta la stanza', () => {
    // Il conto alla rovescia non scende sotto zero: col lucchetto la piazza
    // direbbe «Inizia tra 00:00» finche' il moderatore non avvia.
    const unOraFa = Date.now() - 3_600_000;
    for (const s of ['PUBLISHED', 'IDLE', 'PROVISIONING'] as const) {
      expect(new EventStatusSchedule(s, unOraFa, false, true).getStatus(), s).toBe('preparing');
    }
  });

  it('l’ora che scocca muove il cancello da sola', async () => {
    // Nessuno tocca lo stato dell'evento mentre si aspetta: se non si
    // risvegliasse da solo, il conto resterebbe fermo a zero sotto il lucchetto.
    const s = new EventStatusSchedule('PROVISIONING', Date.now() + 30, false, true);
    const visto = vi.fn();
    s.on('statusChange', visto);
    expect(s.getStatus()).toBe('scheduled');
    await new Promise((r) => setTimeout(r, 80));
    expect(s.getStatus()).toBe('preparing');
    expect(visto).toHaveBeenCalledWith('preparing');
    s.dispose();
  });

  it('evento finito resta finito, prima o dopo l’ora', () => {
    expect(new EventStatusSchedule('ENDED', 0, false, false).getStatus()).toBe('ended');
    expect(
      new EventStatusSchedule('ENDED', Date.now() + 3_600_000, false, false).getStatus(),
    ).toBe('ended');
  });

  it('la sala che si apre muove il cancello senza ricaricare', () => {
    const s = new EventStatusSchedule('LIVE', 0, false, false);
    const visto = vi.fn();
    s.on('statusChange', visto);
    s.update('LIVE', true);
    expect(s.getStatus()).toBe('live');
    expect(visto).toHaveBeenCalledWith('live');
  });

  it('un aggiornamento che non cambia il disegno non sveglia nessuno', () => {
    const s = new EventStatusSchedule('LIVE', 0, false, true);
    const visto = vi.fn();
    s.on('statusChange', visto);
    s.update('LIVE', true);
    expect(visto).not.toHaveBeenCalled();
  });

  it('chi aggiorna solo lo stato dell’evento non perde la sala', () => {
    // La sala pronta arriva da una sonda, lo stato dell'evento da un'altra
    // parte: se il secondo cancellasse il primo, le porte si riaprirebbero da
    // sole al primo aggiornamento che passa.
    const s = new EventStatusSchedule('PUBLISHED', Date.now() + 3_600_000, false, false);
    s.update('LIVE');
    expect(s.getStatus()).toBe('preparing');
  });
});

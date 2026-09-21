/**
 * `withDeadline`, la guardia che rende interrompibile un comando Redis.
 *
 * Il client è costruito con `maxRetriesPerRequest: null`: un comando non
 * viene mai rifiutato per scadenza, resta in coda finché Redis non torna.
 * Controllare `status` copre la connessione caduta, non quella che resta
 * pronta su una rete che ingoia i pacchetti — e lì ad aspettare c'è una
 * rotta HTTP.
 *
 * Il caso che vale davvero la pena fissare è l'ultimo: un comando che
 * fallisce DOPO che la scadenza ha già vinto non è più osservato da nessuno,
 * e un rifiuto non osservato su Node abbatte il processo.
 */

import { describe, it, expect, vi } from 'vitest';

import { withDeadline } from './redis';

describe('withDeadline', () => {
  it('restituisce il valore quando il comando arriva in tempo', async () => {
    await expect(withDeadline(Promise.resolve('ok'), 50, 'ripiego')).resolves.toBe('ok');
  });

  it('restituisce il ripiego quando il comando non torna', async () => {
    const mai = new Promise<string>(() => {
      /* un comando accodato che non si risolve mai */
    });
    await expect(withDeadline(mai, 10, 'ripiego')).resolves.toBe('ripiego');
  });

  it('restituisce il ripiego quando il comando fallisce subito', async () => {
    const rotto = Promise.reject(new Error('ECONNRESET'));
    await expect(withDeadline(rotto, 50, 'ripiego')).resolves.toBe('ripiego');
  });

  it('non lascia un rifiuto non osservato quando il comando fallisce dopo la scadenza', async () => {
    // Senza il `.catch()` sull'operazione questo rifiuto arriverebbe quando
    // la corsa è già stata vinta dal timer, e nessuno lo starebbe più
    // ascoltando: su Node è un processo che cade.
    const spia = vi.fn();
    process.on('unhandledRejection', spia);

    let fallisci: (e: Error) => void = () => undefined;
    const tardivo = new Promise<string>((_, reject) => {
      fallisci = reject;
    });

    await expect(withDeadline(tardivo, 5, 'ripiego')).resolves.toBe('ripiego');
    fallisci(new Error('arrivato tardi'));
    // Un giro di event loop perché un eventuale rifiuto non osservato emerga.
    await new Promise((r) => setTimeout(r, 20));

    process.off('unhandledRejection', spia);
    expect(spia).not.toHaveBeenCalled();
  });

  it('non lascia un timer pendente quando la risposta è veloce', async () => {
    // Un timer non azzerato tiene sveglio l'event loop: su una rotta chiamata
    // cinque volte al secondo da ogni client, se ne accumulano.
    const spia = vi.spyOn(global, 'clearTimeout');
    await withDeadline(Promise.resolve(1), 10_000, 0);
    expect(spia).toHaveBeenCalled();
    spia.mockRestore();
  });
});

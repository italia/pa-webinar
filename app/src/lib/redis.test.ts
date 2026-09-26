/**
 * `withDeadline`, la guardia che rende interrompibile un comando Redis.
 *
 * Il client è costruito con `maxRetriesPerRequest: null`: un comando non
 * viene mai rifiutato per scadenza, resta in coda finché Redis non torna.
 * Controllare `status` copre la connessione caduta, non quella che resta
 * pronta su una rete che ingoia i pacchetti — e lì ad aspettare c'è una
 * rotta HTTP.
 *
 * Il caso che vale la pena fissare è il terzo: un comando che fallisce prima
 * della scadenza deve dare il ripiego, non un'eccezione. È quello che fa la
 * cattura sull'operazione — non evitare rifiuti non osservati, che
 * `Promise.race` gestisce già da sé sottoscrivendo ogni promessa.
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

  it('un fallimento dopo la scadenza non disturba chi ha già avuto il ripiego', async () => {
    // Il valore è già stato restituito: il rifiuto tardivo non deve cambiarlo
    // né far cadere il processo. (Il gestore ce l'ha `Promise.race`, che
    // sottoscrive entrambe le promesse; la cattura serve al caso veloce.)
    const spia = vi.fn();
    process.on('unhandledRejection', spia);

    let fallisci: (e: Error) => void = () => undefined;
    const tardivo = new Promise<string>((_, reject) => {
      fallisci = reject;
    });

    await expect(withDeadline(tardivo, 5, 'ripiego')).resolves.toBe('ripiego');
    fallisci(new Error('arrivato tardi'));
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

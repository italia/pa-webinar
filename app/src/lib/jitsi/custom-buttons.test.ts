import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JitsiMeetExternalAPI } from '@/types/jitsi';

import {
  REMOUNT_DELAY_MS,
  impostaPulsante,
  pulsantiIniziali,
  salaPronta,
} from './custom-buttons';

/**
 * Un solo elenco di pulsanti personalizzati per sala: chi ne aggiunge uno non
 * cancella quelli degli altri, e un pulsante cambiato si ridisegna.
 */

function sala() {
  const executeCommand = vi.fn();
  const api = { executeCommand } as unknown as JitsiMeetExternalAPI;
  const elenchi = () =>
    executeCommand.mock.calls.map((c) =>
      (
        c[1] as { customToolbarButtons: Array<{ id: string; text: string }> }
      ).customToolbarButtons.map((p) => `${p.id}:${p.text}`)
    );
  return { api, executeCommand, elenchi };
}

const p = (id: string, text: string) => ({ id, text, icon: `data:${text}` });

afterEach(() => vi.useRealTimers());

describe('registro dei pulsanti personalizzati di Jitsi', () => {
  it('chi aggiunge un pulsante manda anche quelli degli altri', () => {
    const { api, elenchi } = sala();
    pulsantiIniziali(api, [p('pa-captions', 'Nascondi')]);
    salaPronta(api);
    impostaPulsante(api, 'pa-fullscreen', p('pa-fullscreen', 'Schermo intero'));
    expect(elenchi()).toEqual([['pa-captions:Nascondi', 'pa-fullscreen:Schermo intero']]);
  });

  it("un pulsante gia' disegnato che cambia si toglie e si rimette", () => {
    vi.useFakeTimers();
    const { api, elenchi } = sala();
    impostaPulsante(api, 'pa-captions', p('pa-captions', 'Nascondi'));
    impostaPulsante(api, 'pa-fullscreen', p('pa-fullscreen', 'Schermo intero'));
    impostaPulsante(api, 'pa-captions', p('pa-captions', 'Mostra'));
    // Si toglie solo il pulsante cambiato: lo schermo intero resta al suo posto.
    expect(elenchi().at(-1)).toEqual(['pa-fullscreen:Schermo intero']);
    vi.advanceTimersByTime(REMOUNT_DELAY_MS);
    expect(elenchi().at(-1)).toEqual([
      'pa-captions:Mostra',
      'pa-fullscreen:Schermo intero',
    ]);
  });

  it('senza cambiamenti non manda nulla; togliere un pulsante lascia gli altri', () => {
    const { api, executeCommand, elenchi } = sala();
    pulsantiIniziali(api, [p('pa-captions', 'Nascondi')]);
    salaPronta(api);
    impostaPulsante(api, 'pa-captions', p('pa-captions', 'Nascondi'));
    expect(executeCommand).not.toHaveBeenCalled();
    impostaPulsante(api, 'pa-fullscreen', p('pa-fullscreen', 'Schermo intero'));
    impostaPulsante(api, 'pa-captions', null);
    expect(elenchi().at(-1)).toEqual(['pa-fullscreen:Schermo intero']);
    impostaPulsante(api, 'pa-captions', null);
    expect(executeCommand).toHaveBeenCalledTimes(2);
  });
});

describe('registro — prima dell’ingresso nella conferenza', () => {
  it('tiene le richieste e le manda quando la sala è pronta', () => {
    const { api, executeCommand, elenchi } = sala();
    pulsantiIniziali(api, []);
    impostaPulsante(api, 'pa-fullscreen', p('pa-fullscreen', 'Schermo intero'));
    expect(executeCommand).not.toHaveBeenCalled();
    salaPronta(api);
    expect(elenchi()).toEqual([['pa-fullscreen:Schermo intero']]);
    salaPronta(api);
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });

  it('senza richieste nuove, all’ingresso non manda nulla', () => {
    const { api, executeCommand } = sala();
    pulsantiIniziali(api, [p('pa-captions', 'Nascondi')]);
    impostaPulsante(api, 'pa-captions', p('pa-captions', 'Nascondi'));
    salaPronta(api);
    expect(executeCommand).not.toHaveBeenCalled();
  });
});

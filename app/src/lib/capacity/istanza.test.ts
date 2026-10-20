import { afterEach, describe, expect, it, vi } from 'vitest';

import { ambienteCapacita, capacitaIstanza } from './istanza';

/**
 * L'istanza della stima: le impostazioni del sito e le variabili d'ambiente
 * che il chart scrive, con i loro valori predefiniti quando mancano.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ambienteCapacita', () => {
  it('senza variabili: tutte le voci, ponti non collegati, quattro voci trascritte', () => {
    expect(ambienteCapacita({})).toEqual({
      numLoudest: 0,
      cascading: false,
      captionsMaxStreams: 4,
    });
  });

  it('legge le tre variabili, e ignora i valori storti', () => {
    expect(
      ambienteCapacita({
        JVB_NUM_LOUDEST: '5',
        JVB_CASCADING: 'true',
        CAPTIONS_MAX_STREAMS: '2',
      })
    ).toEqual({ numLoudest: 5, cascading: true, captionsMaxStreams: 2 });
    expect(
      ambienteCapacita({
        JVB_NUM_LOUDEST: 'molte',
        JVB_CASCADING: 'si',
        CAPTIONS_MAX_STREAMS: '0',
      })
    ).toEqual({ numLoudest: 0, cascading: false, captionsMaxStreams: 1 });
  });
});

describe('capacitaIstanza', () => {
  it('i ponti dell istanza vengono da JVB_MAX_REPLICAS, non dal tetto per evento del sito', () => {
    vi.stubEnv('JVB_MAX_REPLICAS', '1');
    vi.stubEnv('JVB_NUM_LOUDEST', '5');
    const istanza = capacitaIstanza({
      jvbCpuCoresPerPod: 15,
      jvbStressWarnPercent: 40,
      jvbStressCriticalPercent: 80,
      defaultSenderRatioPct: 20,
      videoQuality: 'BALANCED',
    });
    expect(istanza).toMatchObject({
      coresPerBridge: 15,
      stressWarn: 40,
      stressCritical: 80,
      instanceBridges: 1,
      numLoudest: 5,
      siteCameraPct: 20,
      siteVideoQuality: 'BALANCED',
    });
  });

  it('i sottotitoli ci sono solo con il servizio installato e lasciati accesi', () => {
    vi.stubEnv('CAPTIONS_STATUS_URL', '');
    expect(capacitaIstanza({ liveCaptionsEnabled: true }).captionsAvailable).toBe(false);
    vi.stubEnv('CAPTIONS_STATUS_URL', 'http://captions:8080/status');
    expect(capacitaIstanza({ liveCaptionsEnabled: true }).captionsAvailable).toBe(true);
    expect(capacitaIstanza({ liveCaptionsEnabled: false }).captionsAvailable).toBe(false);
  });

  it('impostazioni mancanti: i valori predefiniti', () => {
    vi.stubEnv('JVB_MAX_REPLICAS', '');
    expect(capacitaIstanza({})).toMatchObject({
      coresPerBridge: 16,
      stressWarn: 50,
      stressCritical: 70,
      instanceBridges: 6,
      siteCameraPct: 30,
      siteVideoQuality: 'HIGH',
    });
  });
});

import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('i default misurati', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({ boost: 0.5, maxStreams: 4, pauseGapMs: 900, vadMinDbfs: -55, vadMarginDb: 10 });
  });

  it('rifiuta una soglia della voce positiva, che spegnerebbe i sottotitoli in silenzio', () => {
    expect(() => loadConfig({ CAPTIONS_VAD_MIN_DBFS: '55' })).toThrow(/CAPTIONS_VAD_MIN_DBFS/);
    expect(() => loadConfig({ CAPTIONS_VAD_MIN_DBFS: '0' })).toThrow(/CAPTIONS_VAD_MIN_DBFS/);
    expect(() => loadConfig({ CAPTIONS_VAD_MIN_DBFS: '-5' })).toThrow(/CAPTIONS_VAD_MIN_DBFS/);
    expect(loadConfig({ CAPTIONS_VAD_MIN_DBFS: '-60' }).vadMinDbfs).toBe(-60);
  });
});

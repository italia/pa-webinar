import { describe, expect, it } from 'vitest';

import { LoadGovernor } from './load.js';

function governor(now: { t: number }) {
  return new LoadGovernor({
    maxStreams: 4,
    degradeLagMs: 1000,
    pauseLagMs: 3000,
    pauseCooldownMs: 60_000,
    maxPauseMs: 240_000,
    windowMs: 10_000,
    sustainMs: 5_000,
    now: () => now.t,
  });
}

describe('LoadGovernor', () => {
  it('parte ok con il limite pieno', () => {
    const now = { t: 0 };
    expect(governor(now).evaluate()).toMatchObject({ state: 'ok', streamLimit: 4, lagP95Ms: null });
  });

  it('con ritardo alto dimezza le voci', () => {
    const now = { t: 0 };
    const g = governor(now);
    for (let i = 0; i < 20; i++) g.recordLag(1500);
    expect(g.evaluate()).toMatchObject({ state: 'degraded', streamLimit: 2 });
  });

  it('sospende solo se il ritardo resta oltre la soglia, e la sospensione raddoppia', () => {
    const now = { t: 0 };
    const g = governor(now);
    g.recordLag(5000);
    expect(g.evaluate().state).toBe('degraded');
    now.t = 6000;
    g.recordLag(5000);
    const paused = g.evaluate();
    expect(paused).toMatchObject({ state: 'paused', streamLimit: 0, pausedUntil: 66_000 });

    now.t = 66_001;
    expect(g.evaluate()).toMatchObject({ state: 'ok', lagP95Ms: null });

    g.recordLag(5000);
    g.evaluate();
    now.t = 72_000;
    g.recordLag(5000);
    expect(g.evaluate()).toMatchObject({ state: 'paused', pausedUntil: 72_000 + 120_000 });
  });

  it('dimentica le sospensioni passate dopo un periodo tranquillo', () => {
    const now = { t: 0 };
    const g = new LoadGovernor({
      maxStreams: 4, degradeLagMs: 1000, pauseLagMs: 3000, pauseCooldownMs: 1000, maxPauseMs: 60_000,
      sustainMs: 0, forgiveMs: 10_000, now: () => now.t,
    });
    g.recordLag(5000);
    expect(g.evaluate().pausedUntil).toBe(1000);
    now.t = 1001;
    g.evaluate();
    now.t = 20_000;
    g.recordLag(5000);
    expect(g.evaluate().pausedUntil).toBe(21_000);
  });

  it('motore irraggiungibile: unavailable, poi di nuovo ok', () => {
    const now = { t: 0 };
    const g = governor(now);
    g.setEngineAvailable(false);
    expect(g.evaluate()).toMatchObject({ state: 'unavailable', streamLimit: 0 });
    g.setEngineAvailable(true);
    expect(g.evaluate().state).toBe('ok');
  });
});

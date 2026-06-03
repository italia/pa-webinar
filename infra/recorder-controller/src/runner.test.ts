import { describe, it, expect } from 'vitest';

import { collectRecorderEnv } from './config';
import { containerPhase } from './docker';
import { recorderHandleName } from './labels';

describe('collectRecorderEnv', () => {
  it('estrae solo le RECORDER_ENV_* spogliando il prefisso', () => {
    expect(
      collectRecorderEnv({
        RECORDER_ENV_JITSI_DOMAIN: 'meet.example',
        RECORDER_ENV_INGEST_URL: 'https://app/api/internal/multitrack-manifest',
        PORT: '8080',
        UNRELATED: 'x',
      } as NodeJS.ProcessEnv),
    ).toEqual({
      JITSI_DOMAIN: 'meet.example',
      INGEST_URL: 'https://app/api/internal/multitrack-manifest',
    });
  });

  it('ritorna {} se nessuna RECORDER_ENV_*', () => {
    expect(collectRecorderEnv({ FOO: 'bar' } as NodeJS.ProcessEnv)).toEqual({});
  });
});

describe('containerPhase', () => {
  const info = (State: string, Status: string) =>
    ({ State, Status } as Parameters<typeof containerPhase>[0]);

  it('running → active', () => {
    expect(containerPhase(info('running', 'Up 3 minutes'))).toBe('active');
  });
  it('created/restarting → active', () => {
    expect(containerPhase(info('created', 'Created'))).toBe('active');
    expect(containerPhase(info('restarting', 'Restarting'))).toBe('active');
  });
  it('exited 0 → succeeded', () => {
    expect(containerPhase(info('exited', 'Exited (0) 2 minutes ago'))).toBe('succeeded');
  });
  it('exited non-zero → failed', () => {
    expect(containerPhase(info('exited', 'Exited (1) 2 minutes ago'))).toBe('failed');
    expect(containerPhase(info('dead', 'Dead'))).toBe('failed');
  });
});

describe('recorderHandleName', () => {
  it('è deterministico e DNS-safe (≤63, prefisso recorder-)', () => {
    const name = recorderHandleName('3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(name).toBe('recorder-3fa85f6457174562b3fc');
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^recorder-[a-z0-9]+$/);
  });
});

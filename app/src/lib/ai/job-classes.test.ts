import { describe, expect, it } from 'vitest';

import {
  CPU_WORKER_KINDS,
  EVENT_JOB_KINDS,
  GPU_WORKER_KINDS,
  LLM_JOB_KINDS,
  MT_JOB_KINDS,
  POSTPROD_JOB_KINDS,
} from './job-classes';

describe('classi dei lavori di post-produzione', () => {
  it('la traduzione dei testi non accende mai la GPU: worker senza GPU, motore su CPU, niente vLLM', () => {
    expect(GPU_WORKER_KINDS).not.toContain('TRANSLATE_TEXT');
    expect(CPU_WORKER_KINDS).toContain('TRANSLATE_TEXT');
    expect(LLM_JOB_KINDS).not.toContain('TRANSLATE_TEXT');
    expect(MT_JOB_KINDS).toEqual(['TRANSLATE_TEXT']);
  });

  it('vLLM solo per i lavori che gli chiedono testo', () => {
    expect([...LLM_JOB_KINDS].sort()).toEqual([
      'REPORT',
      'SUMMARIZE',
      'TRANSCRIBE',
      'TRANSCRIBE_MULTITRACK',
      'TRANSLATE',
    ]);
    expect(LLM_JOB_KINDS.filter((k) => MT_JOB_KINDS.includes(k))).toEqual([]);
  });

  it("ogni tipo e' di un solo worker, e i lavori dell'evento sono tipi noti", () => {
    expect([...GPU_WORKER_KINDS, ...CPU_WORKER_KINDS].sort()).toEqual(
      [...POSTPROD_JOB_KINDS].sort()
    );
    expect(EVENT_JOB_KINDS.every((k) => POSTPROD_JOB_KINDS.includes(k))).toBe(true);
  });
});

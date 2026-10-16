// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const put = vi.hoisted(() => vi.fn());
vi.mock('@/lib/storage', () => ({ getRecordingsStorage: () => ({ put }) }));

import { rewritePostprodBlob } from './postprod';

beforeEach(() => vi.clearAllMocks());

describe('rewritePostprodBlob', () => {
  it('scrive dal server con il fornitore dell archivio (niente PUT su un indirizzo firmato)', async () => {
    put.mockResolvedValue({ publicUrl: 'x' });
    await expect(
      rewritePostprodBlob('postprod/r/1/t.json', '{"a":1}', 'application/json')
    ).resolves.toBe(true);
    expect(put).toHaveBeenCalledWith(
      'postprod/r/1/t.json',
      Buffer.from('{"a":1}', 'utf8'),
      'application/json',
      {
        signal: expect.any(AbortSignal),
      }
    );
  });

  it('fuori dal prefisso della post-produzione non scrive', async () => {
    await expect(rewritePostprodBlob('recordings/x.mp4', 'x', 'video/mp4')).resolves.toBe(
      false
    );
    expect(put).not.toHaveBeenCalled();
  });

  it('un archivio che non risponde entro il tempo massimo: interrotto, false', async () => {
    put.mockImplementation(
      (_k: string, _b: Buffer, _t: string, opts: { signal: AbortSignal }) =>
        new Promise((_, rifiuta) =>
          opts.signal.addEventListener('abort', () => rifiuta(opts.signal.reason))
        )
    );
    await expect(
      rewritePostprodBlob('postprod/r/1/t.json', 'x', 'application/json', 20)
    ).resolves.toBe(false);
  });

  it('un errore dell archivio diventa false', async () => {
    put.mockRejectedValue(new Error('giu'));
    await expect(
      rewritePostprodBlob('postprod/r/1/t.json', 'x', 'application/json')
    ).resolves.toBe(false);
  });
});

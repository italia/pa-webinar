// @vitest-environment node
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Riga = {
  id: string;
  type: 'TRANSCRIPT_JSON' | 'TRANSCRIPT_VTT';
  language: string | null;
  blobKey: string;
  inlineBody: string;
  contentHash: string;
  mimeType: string;
  revisedAt: Date | null;
  createdAt: Date;
};

// Una banca dati finta: le query rispondono in base al filtro, non
// all'ordine in cui vengono fatte.
const db = vi.hoisted(() => ({ righe: [] as Riga[] }));
const m = vi.hoisted(() => ({
  riscrivi: vi.fn(),
  firma: vi.fn(),
  dopoScrittura: null as null | (() => void),
}));

vi.mock('@/lib/db', () => {
  const corrisponde = (r: Riga, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'recordingId') return true;
      if (k === 'revisedAt') return r.revisedAt !== null;
      return (r as Record<string, unknown>)[k] === v;
    });
  return {
    prisma: {
      postprodArtifact: {
        findFirst: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) =>
            db.righe.find((r) => corrisponde(r, where)) ?? null
        ),
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          db.righe
            .filter((r) => corrisponde(r, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        ),
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            db.righe.find((r) => r.id === where.id) ?? null
        ),
      },
    },
  };
});
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (s: string) => s.replace(/^cifrato:/, ''),
}));
vi.mock('@/lib/storage/postprod', () => ({
  rewritePostprodBlob: m.riscrivi,
  presignArtifactDownload: m.firma,
}));

import {
  sceltaSorgente,
  sottotitoliPerIlWorker,
  trascrizionePerIlWorker,
} from './transcript-input';

const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const REG = { id: 'rec', sourceLanguage: 'it' };

function riga(p: Partial<Riga> & Pick<Riga, 'id' | 'type'>): Riga {
  const corpo = p.inlineBody ?? `corpo di ${p.id}`;
  return {
    language: null,
    blobKey: `postprod/evt/rec/002/${p.id}`,
    mimeType: p.type === 'TRANSCRIPT_VTT' ? 'text/vtt' : 'application/json',
    revisedAt: null,
    createdAt: new Date('2026-01-01'),
    ...p,
    inlineBody: `cifrato:${corpo}`,
    contentHash: hash(corpo),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.righe = [];
  m.dopoScrittura = null;
  m.firma.mockImplementation(
    async ({ blobKey }: { blobKey: string }) => `https://firmato/${blobKey}`
  );
  m.riscrivi.mockImplementation(async () => {
    m.dopoScrittura?.();
    m.dopoScrittura = null;
    return true;
  });
});

describe('trascrizionePerIlWorker', () => {
  it('una trascrizione mai corretta: solo l indirizzo firmato del file', async () => {
    db.righe = [riga({ id: 'json', type: 'TRANSCRIPT_JSON' })];
    await expect(trascrizionePerIlWorker(REG, 30)).resolves.toEqual({
      downloadUrl: 'https://firmato/postprod/evt/rec/002/json',
      blobKey: 'postprod/evt/rec/002/json',
    });
    expect(m.riscrivi).not.toHaveBeenCalled();
  });

  it('corretta a mano: prima la si riscrive nell archivio dalla banca dati, poi si firma', async () => {
    db.righe = [
      riga({
        id: 'json',
        type: 'TRANSCRIPT_JSON',
        inlineBody: 'corretta',
        revisedAt: new Date(),
      }),
    ];
    await trascrizionePerIlWorker(REG, 30);
    expect(m.riscrivi).toHaveBeenCalledOnce();
    expect(m.riscrivi).toHaveBeenCalledWith(
      'postprod/evt/rec/002/json',
      'corretta',
      'application/json',
      expect.any(Number)
    );
    expect(m.riscrivi.mock.invocationCallOrder[0]).toBeLessThan(
      m.firma.mock.invocationCallOrder[0]!
    );
  });

  it('una modifica arrivata durante la scrittura (una cancellazione) si riscrive subito dopo', async () => {
    db.righe = [
      riga({
        id: 'json',
        type: 'TRANSCRIPT_JSON',
        inlineBody: 'con la frase',
        revisedAt: new Date(),
      }),
    ];
    m.dopoScrittura = () => {
      db.righe[0] = {
        ...db.righe[0]!,
        inlineBody: 'cifrato:senza la frase',
        contentHash: hash('senza la frase'),
      };
    };
    await trascrizionePerIlWorker(REG, 30);
    expect(m.riscrivi.mock.calls.map((c) => c[1])).toEqual([
      'con la frase',
      'senza la frase',
    ]);
  });

  it('se l archivio non risponde il lavoro parte lo stesso', async () => {
    db.righe = [riga({ id: 'json', type: 'TRANSCRIPT_JSON', revisedAt: new Date() })];
    m.riscrivi.mockResolvedValue(false);
    const errore = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(trascrizionePerIlWorker(REG, 30)).resolves.toMatchObject({
      blobKey: 'postprod/evt/rec/002/json',
    });
    expect(m.riscrivi).toHaveBeenCalledOnce();
    expect(errore).toHaveBeenCalled();
    errore.mockRestore();
  });

  it('dai sottotitoli live, senza file: niente da dare al worker, niente da scrivere', async () => {
    db.righe = [
      riga({ id: 'json', type: 'TRANSCRIPT_JSON', blobKey: '', revisedAt: new Date() }),
    ];
    await expect(trascrizionePerIlWorker(REG, 30)).resolves.toBeNull();
    expect(m.riscrivi).not.toHaveBeenCalled();
    expect(m.firma).not.toHaveBeenCalled();
  });

  it('se il testo cambia a ogni scrittura si ferma dopo due e lo dice', async () => {
    db.righe = [riga({ id: 'json', type: 'TRANSCRIPT_JSON', revisedAt: new Date() })];
    let n = 0;
    m.riscrivi.mockImplementation(async () => {
      n += 1;
      db.righe[0] = {
        ...db.righe[0]!,
        inlineBody: `cifrato:v${n}`,
        contentHash: hash(`altro ${n}`),
      };
      return true;
    });
    const errore = vi.spyOn(console, 'error').mockImplementation(() => {});
    await trascrizionePerIlWorker(REG, 30);
    expect(m.riscrivi).toHaveBeenCalledTimes(2);
    expect(errore).toHaveBeenCalled();
    errore.mockRestore();
  });

  it('nessuna trascrizione: null', async () => {
    await expect(trascrizionePerIlWorker(REG, 30)).resolves.toBeNull();
  });
});

describe('sottotitoliPerIlWorker', () => {
  it('sceglie i sottotitoli nella lingua della registrazione, anche se non sono i piu recenti', async () => {
    db.righe = [
      riga({ id: 'json', type: 'TRANSCRIPT_JSON' }),
      riga({
        id: 'it.vtt',
        type: 'TRANSCRIPT_VTT',
        language: 'it',
        createdAt: new Date('2026-01-01'),
      }),
      riga({
        id: 'en.vtt',
        type: 'TRANSCRIPT_VTT',
        language: 'en',
        createdAt: new Date('2026-02-01'),
      }),
    ];
    await expect(sottotitoliPerIlWorker(REG, 30)).resolves.toMatchObject({
      language: 'it',
    });
    expect(m.riscrivi).not.toHaveBeenCalled();
  });

  it('con la trascrizione rivista li riscrive prima di firmarli', async () => {
    db.righe = [
      riga({ id: 'json', type: 'TRANSCRIPT_JSON', revisedAt: new Date() }),
      riga({
        id: 'it.vtt',
        type: 'TRANSCRIPT_VTT',
        language: 'it',
        inlineBody: 'WEBVTT corretto',
      }),
    ];
    await sottotitoliPerIlWorker(REG, 30);
    expect(m.riscrivi).toHaveBeenCalledWith(
      'postprod/evt/rec/002/it.vtt',
      'WEBVTT corretto',
      'text/vtt',
      expect.any(Number)
    );
  });

  it('senza la lingua della registrazione prende i piu recenti, come prima', async () => {
    db.righe = [
      riga({
        id: 'it.vtt',
        type: 'TRANSCRIPT_VTT',
        language: 'it',
        createdAt: new Date('2026-01-01'),
      }),
      riga({
        id: 'en.vtt',
        type: 'TRANSCRIPT_VTT',
        language: 'en',
        createdAt: new Date('2026-02-01'),
      }),
    ];
    await expect(
      sottotitoliPerIlWorker({ ...REG, sourceLanguage: null }, 30)
    ).resolves.toMatchObject({ language: 'en' });
  });
});

describe('sceltaSorgente', () => {
  it('la prima lingua dell elenco che ha un file', () => {
    const righe = [{ language: 'en' }, { language: 'it' }];
    expect(sceltaSorgente(righe, [null, 'de', 'it'])).toBe(righe[1]);
    expect(sceltaSorgente(righe, ['de'])).toBeUndefined();
  });
});

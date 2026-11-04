// @vitest-environment node
/**
 * La sintesi di una registrazione: la corregge chi gestisce l’evento. Il testo
 * resta cifrato a riposo, si scrive sull’artefatto della lingua giusta, e alla
 * prima correzione la versione della macchina si conserva cosi’ com’e’.
 */
import { createHash } from 'crypto';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, tx, sessione } = vi.hoisted(() => {
  const tx = {
    postprodArtifact: { update: vi.fn() },
    postprodOriginalBody: { createMany: vi.fn() },
  };
  return {
    tx,
    sessione: { cookie: undefined as string | undefined },
    prisma: {
      staffAccount: { findUnique: vi.fn() },
      adminAuditLog: { create: vi.fn() },
      event: { count: vi.fn() },
      recording: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'admin_session' && sessione.cookie
        ? { value: sessione.cookie }
        : undefined,
  }),
}));

import { signStaffSession } from '@/lib/auth/staff-session';
import { decryptPII, encryptPII } from '@/lib/crypto/pii';

import { GET, PUT } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const EVENTO = '22222222-2222-4222-8222-222222222222';
const REGISTRAZIONE = '33333333-3333-4333-8333-333333333333';

function chiama(handler: typeof GET, method: string, corpo?: unknown) {
  const request = new Request(
    `http://localhost/api/admin/postprod/recordings/${REGISTRAZIONE}/summary`,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    }
  );
  return handler(request as never, { params: Promise.resolve({ id: REGISTRAZIONE }) });
}
const leggi = () => chiama(GET, 'GET');
const correggi = (corpo: unknown) => chiama(PUT, 'PUT', corpo);

async function entra(role: 'ADMIN' | 'ORGANIZER') {
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT,
    active: true,
    role,
    emailHash: 'impronta-account',
  });
  sessione.cookie = await signStaffSession({ id: ACCOUNT, role });
}

function artefatto(
  id: string,
  type: string,
  language: string | null,
  testo: string | null,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    recordingId: REGISTRAZIONE,
    type,
    language,
    inlineBody: testo === null ? null : encryptPII(testo),
    contentHash: `hash-${id}`,
    sizeBytes: 10n,
    modelId: 'modello-sintesi',
    modelVersion: '1.0',
    revisedAt: null,
    ...extra,
  };
}

function registrazione(artifacts: unknown[], sourceLanguage: string | null = 'it') {
  prisma.recording.findUnique.mockResolvedValue({
    id: REGISTRAZIONE,
    eventId: EVENTO,
    sourceLanguage,
    artifacts,
  });
}

const nessunaScrittura = () => {
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(tx.postprodArtifact.update).not.toHaveBeenCalled();
  expect(tx.postprodOriginalBody.createMany).not.toHaveBeenCalled();
};

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.APP_SECRET = 'segreto-di-prova-della-post-produzione-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.event.count.mockResolvedValue(0);
  registrazione([artefatto('md-it', 'SUMMARY_MD', 'it', 'Testo della macchina')]);
  tx.postprodOriginalBody.createMany.mockResolvedValue({ count: 1 });
});

describe('un corpo che non e’ JSON', () => {
  it('e’ 400, non un errore del server', async () => {
    const request = new Request('http://localhost/x', {
      method: 'PUT',
      body: 'non json',
    });
    const r = await PUT(request as never, {
      params: Promise.resolve({ id: REGISTRAZIONE }),
    });
    expect(r.status).toBe(400);
    nessunaScrittura();
  });
});

describe('chi puo’ entrare', () => {
  it('senza sessione e’ 401, e non si legge niente', async () => {
    sessione.cookie = undefined;
    expect((await leggi()).status).toBe(401);
    expect((await correggi({ language: 'it', md: 'Nuovo' })).status).toBe(401);
    expect(prisma.recording.findUnique).not.toHaveBeenCalled();
    nessunaScrittura();
  });

  it('la registrazione di un altro organizzatore e’ 403', async () => {
    await entra('ORGANIZER');
    expect((await leggi()).status).toBe(403);
    expect((await correggi({ language: 'it', md: 'Nuovo' })).status).toBe(403);
    expect(prisma.event.count.mock.calls[0]![0].where).toMatchObject({
      id: EVENTO,
      AND: [{ OR: expect.arrayContaining([{ createdById: ACCOUNT }]) }],
    });
    nessunaScrittura();
  });

  it('chi organizza lavora sulla registrazione di un proprio evento', async () => {
    await entra('ORGANIZER');
    prisma.event.count.mockResolvedValue(1);
    expect((await leggi()).status).toBe(200);
    expect((await correggi({ language: 'it', md: 'Nuovo' })).status).toBe(200);
  });

  it('per l’amministrazione una registrazione inesistente e’ 404', async () => {
    prisma.recording.findUnique.mockResolvedValue(null);
    expect((await leggi()).status).toBe(404);
    expect((await correggi({ language: 'it', md: 'Nuovo' })).status).toBe(404);
    nessunaScrittura();
  });
});

describe('GET', () => {
  it('consegna in chiaro il testo e la struttura, lingua per lingua', async () => {
    const struttura = { overall_summary: 'In breve', key_decisions: ['Una decisione'] };
    registrazione([
      artefatto('md-it', 'SUMMARY_MD', 'it', 'Sintesi italiana'),
      artefatto('json-it', 'SUMMARY_JSON', 'it', JSON.stringify(struttura)),
      artefatto('md-en', 'TRANSLATION_MD', 'en', 'English summary'),
    ]);
    expect(await (await leggi()).json()).toEqual({
      recordingId: REGISTRAZIONE,
      sourceLanguage: 'it',
      languages: ['en', 'it'],
      summaries: {
        it: { md: 'Sintesi italiana', structured: struttura },
        en: { md: 'English summary', structured: null },
      },
    });
  });

  it('senza lingua dichiarata la registrazione e’ in italiano', async () => {
    registrazione([], null);
    const corpo = (await (await leggi()).json()) as { sourceLanguage: string };
    expect(corpo.sourceLanguage).toBe('it');
  });

  it('una struttura illeggibile non toglie il testo', async () => {
    registrazione([
      artefatto('md-it', 'SUMMARY_MD', 'it', 'Sintesi italiana'),
      artefatto('json-it', 'SUMMARY_JSON', 'it', 'non-e-json'),
    ]);
    const corpo = (await (await leggi()).json()) as { summaries: unknown };
    expect(corpo.summaries).toEqual({ it: { md: 'Sintesi italiana', structured: null } });
  });

  it('salta gli artefatti senza lingua o senza corpo', async () => {
    registrazione([
      artefatto('senza-lingua', 'SUMMARY_MD', null, 'Testo'),
      artefatto('senza-corpo', 'SUMMARY_MD', 'it', null),
    ]);
    const corpo = (await (await leggi()).json()) as { languages: string[] };
    expect(corpo.languages).toEqual([]);
  });
});

describe('PUT: cosa si accetta', () => {
  it('un corpo non valido e’ 422, e non si scrive niente', async () => {
    const corpi = [
      { language: 'it' },
      { md: 'Nuovo' },
      { language: 'i', md: 'Nuovo' },
      { language: 'it', md: 'x'.repeat(100_001) },
      { language: 'it', structured: { key_decisions: 'una stringa' } },
    ];
    for (const corpo of corpi) {
      expect((await correggi(corpo)).status).toBe(422);
    }
    nessunaScrittura();
  });

  it('senza l’artefatto del testo chiede di rifare la pipeline', async () => {
    const r = await correggi({ language: 'fr', md: 'Nouveau' });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { code: string }).code).toBe('SUMMARY_MISSING');
    nessunaScrittura();
  });

  it('se manca la struttura non si scrive nemmeno il testo', async () => {
    const r = await correggi({ language: 'it', md: 'Nuovo', structured: {} });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { code: string }).code).toBe('SUMMARY_MISSING');
    nessunaScrittura();
  });
});

describe('PUT: cosa si scrive', () => {
  it('il testo va a riposo cifrato, con impronta e dimensione del chiaro', async () => {
    const testo = 'Sintesi riveduta: città';
    const r = await correggi({ language: 'it', md: testo });
    expect(await r.json()).toEqual({ ok: true, language: 'it', updated: 1 });

    const { where, data } = tx.postprodArtifact.update.mock.calls[0]![0];
    expect(where).toEqual({ id: 'md-it' });
    expect(data.inlineBody).not.toContain('Sintesi');
    expect(decryptPII(data.inlineBody)).toBe(testo);
    expect(data.contentHash).toBe(createHash('sha256').update(testo).digest('hex'));
    expect(data.sizeBytes).toBe(BigInt(Buffer.byteLength(testo, 'utf8')));
    expect(data.revisedAt).toBeInstanceOf(Date);
  });

  it('in un’altra lingua il testo e’ la traduzione, non la sintesi', async () => {
    registrazione([
      artefatto('md-en', 'SUMMARY_MD', 'en', 'Riga che non va toccata'),
      artefatto('trad-en', 'TRANSLATION_MD', 'en', 'English summary'),
    ]);
    await correggi({ language: 'en', md: 'Reviewed summary' });
    expect(tx.postprodArtifact.update).toHaveBeenCalledTimes(1);
    expect(tx.postprodArtifact.update.mock.calls[0]![0].where).toEqual({ id: 'trad-en' });
  });

  it('nella lingua originale il testo e’ la sintesi, non la traduzione', async () => {
    registrazione(
      [
        artefatto('trad-en', 'TRANSLATION_MD', 'en', 'Riga che non va toccata'),
        artefatto('md-en', 'SUMMARY_MD', 'en', 'English summary'),
      ],
      'en'
    );
    await correggi({ language: 'en', md: 'Reviewed summary' });
    expect(tx.postprodArtifact.update.mock.calls[0]![0].where).toEqual({ id: 'md-en' });
  });

  it('senza lingua dichiarata vale l’italiano', async () => {
    registrazione([artefatto('md-it', 'SUMMARY_MD', 'it', 'Testo della macchina')], null);
    expect((await correggi({ language: 'it', md: 'Nuovo' })).status).toBe(200);
    expect(tx.postprodArtifact.update.mock.calls[0]![0].where).toEqual({ id: 'md-it' });
  });

  it('la struttura si cifra intera, campi in piu’ compresi', async () => {
    registrazione([artefatto('json-it', 'SUMMARY_JSON', 'it', '{}')]);
    const struttura = { overall_summary: 'In breve', campo_futuro: 1 };
    await correggi({ language: 'it', structured: struttura });
    const { where, data } = tx.postprodArtifact.update.mock.calls[0]![0];
    expect(where).toEqual({ id: 'json-it' });
    expect(JSON.parse(decryptPII(data.inlineBody))).toEqual(struttura);
  });

  it('testo e struttura insieme aggiornano due artefatti', async () => {
    registrazione([
      artefatto('md-it', 'SUMMARY_MD', 'it', 'Testo'),
      artefatto('json-it', 'SUMMARY_JSON', 'it', '{}'),
    ]);
    const r = await correggi({ language: 'it', md: 'Nuovo', structured: {} });
    expect(await r.json()).toEqual({ ok: true, language: 'it', updated: 2 });
  });
});

describe('PUT: la versione della macchina', () => {
  it('alla prima correzione si conserva identica, prima di riscrivere', async () => {
    const macchina = artefatto('md-it', 'SUMMARY_MD', 'it', 'Testo della macchina');
    registrazione([macchina]);
    await correggi({ language: 'it', md: 'Nuovo' });

    const argomenti = tx.postprodOriginalBody.createMany.mock.calls[0]![0];
    expect(argomenti.skipDuplicates).toBe(true);
    expect(argomenti.data).toEqual([
      {
        artifactId: 'md-it',
        recordingId: REGISTRAZIONE,
        eventId: EVENTO,
        type: 'SUMMARY_MD',
        language: 'it',
        body: macchina.inlineBody,
        contentHash: 'hash-md-it',
        sizeBytes: 10n,
        modelId: 'modello-sintesi',
        modelVersion: '1.0',
        certainMachineOrigin: true,
      },
    ]);
    expect(tx.postprodOriginalBody.createMany.mock.invocationCallOrder[0]!).toBeLessThan(
      tx.postprodArtifact.update.mock.invocationCallOrder[0]!
    );
  });

  it('su un testo gia’ corretto non si afferma che sia della macchina', async () => {
    registrazione([
      artefatto('md-it', 'SUMMARY_MD', 'it', 'Testo gia’ corretto', {
        revisedAt: new Date('2026-10-01T08:00:00Z'),
      }),
    ]);
    await correggi({ language: 'it', md: 'Nuovo' });
    expect(tx.postprodOriginalBody.createMany.mock.calls[0]![0].data[0]).toMatchObject({
      certainMachineOrigin: false,
    });
  });

  it('si conserva solo l’artefatto che cambia', async () => {
    registrazione([
      artefatto('md-it', 'SUMMARY_MD', 'it', 'Testo'),
      artefatto('json-it', 'SUMMARY_JSON', 'it', '{}'),
    ]);
    await correggi({ language: 'it', md: 'Nuovo' });
    expect(tx.postprodOriginalBody.createMany).toHaveBeenCalledTimes(1);
    expect(tx.postprodOriginalBody.createMany.mock.calls[0]![0].data[0].artifactId).toBe(
      'md-it'
    );
  });
});

describe('PUT: la traccia', () => {
  it('dice cosa e’ cambiato, senza il testo', async () => {
    await correggi({ language: 'it', md: 'Testo riservato' });
    const riga = prisma.adminAuditLog.create.mock.calls[0]![0].data as {
      action: string;
      target: string;
      details: string;
    };
    expect(riga).toMatchObject({
      action: 'POSTPROD_SUMMARY_EDIT',
      target: REGISTRAZIONE,
    });
    expect(JSON.parse(riga.details)).toEqual({
      language: 'it',
      md: true,
      structured: false,
    });
    expect(riga.details).not.toContain('Testo riservato');
  });
});

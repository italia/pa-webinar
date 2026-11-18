// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  evento: {
    moderatorName: 'Mario Rossi',
    speakersInfo: { it: 'Giulia Verdi, Università di Roma\n- Relatore 1' } as unknown,
    createdBy: { name: 'Luca Neri' } as { name: string } | null,
    additionalMods: [{ name: 'Sara Blu' }],
  },
  iscrizioni: [] as Array<{ id: string; nicknameKey: string }>,
  update: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn(async () => db.evento) },
    registration: {
      findMany: vi.fn(async ({ where }: { where: { nicknameKey: { in: string[] } } }) =>
        db.iscrizioni.filter((r) => where.nicknameKey.in.includes(r.nicknameKey))
      ),
      update: db.update,
    },
  },
}));
vi.mock('@/lib/redis', () => ({
  getRedis: () => null,
  withDeadline: (p: Promise<unknown>) => p,
}));
vi.mock('@/lib/crypto/pii', () => ({
  encryptPII: (v: string) => `enc:${v}`,
  tryDecryptPII: (v: string | null) => (v?.startsWith('enc:') ? v.slice(4) : v),
}));
vi.mock('@/lib/settings', () => ({ getSettings: async () => ({ defaultLocale: 'it' }) }));
// Le traduzioni dai cataloghi veri, come le darebbe next-intl.
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: string }) => {
    const m = (await import(`@/i18n/messages/${locale}.json`)).default as {
      live: { pseudonym: string; nickname: { reserved: string } };
    };
    return (k: string, v?: { code: string }) =>
      k === 'nickname.reserved'
        ? m.live.nickname.reserved
        : m.live.pseudonym.replace('{code}', v?.code ?? '');
  },
}));

import {
  improntaNickname,
  nicknameDellIscrizione,
  nicknameDellOspite,
  nomeDiChiPartecipa,
  nomiDiChiConduce,
  paroleRiservate,
  prendiNicknameOspite,
  resetNicknameCachesForTests,
  rispostaNicknameRifiutato,
  salvaNicknameIscrizione,
  verificaNickname,
} from './nickname';

const EVENTO = 'ev-1';
let n = 0;
/** Un evento diverso per ogni prova: la cache di chi conduce e' per evento. */
const nuovoEvento = () => `ev-${++n}`;

beforeEach(() => {
  resetNicknameCachesForTests();
  db.iscrizioni = [];
  db.update.mockReset();
});

describe('paroleRiservate', () => {
  it('i ruoli e la parola dello pseudonimo, in tutte le lingue', async () => {
    const parole = await paroleRiservate();
    for (const p of [
      'Moderatore',
      'Relatore',
      'Partecipante',
      'Moderator',
      'Speaker',
      'Teilnehmende',
      'Участник',
    ]) {
      expect(parole).toContain(p);
    }
  });
});

describe('nomiDiChiConduce', () => {
  it("moderatore principale, concessioni, chi ha creato l'evento e i relatori della pagina", async () => {
    const nomi = await nomiDiChiConduce(nuovoEvento());
    expect(nomi).toEqual(
      expect.arrayContaining([
        'Mario Rossi',
        'Luca Neri',
        'Sara Blu',
        'Giulia Verdi',
        'Università di Roma',
      ])
    );
  });
});

describe('verificaNickname', () => {
  it('accetta un nickname libero, nella forma canonica', async () => {
    expect(await verificaNickname(nuovoEvento(), '  Pippo ', { ospite: 'g1' })).toEqual({
      ok: true,
      nickname: 'Pippo',
    });
  });

  it.each([
    ['length', 'P'],
    ['format', 'Pippo Rossi'],
    ['scripts', 'Pаolo'],
    ['reserved', 'Moderatore2'],
    ['reserved', 'Speaker'],
    ['reserved', 'Partecipante-7K2QXM'],
    ['host', 'MarioRossi'],
    ['host', 'Giulia'],
    ['host', 'sara'],
  ])('rifiuta per %s: %s', async (motivo, nick) => {
    expect(await verificaNickname(nuovoEvento(), nick, { ospite: 'g1' })).toEqual({
      ok: false,
      motivo,
    });
  });

  it("occupato da un'altra iscrizione: propone un'alternativa libera", async () => {
    const ev = nuovoEvento();
    db.iscrizioni = [
      { id: 'r-altra', nicknameKey: improntaNickname(ev, 'Pippo') },
      { id: 'r-altra2', nicknameKey: improntaNickname(ev, 'Pippo2') },
    ];
    expect(await verificaNickname(ev, 'pìppo', { iscrizione: 'r-mia' })).toEqual({
      ok: false,
      motivo: 'taken',
      suggerimento: 'pìppo3',
    });
    // Il proprio nickname resta proprio.
    expect(await verificaNickname(ev, 'Pippo', { iscrizione: 'r-altra' })).toEqual({
      ok: true,
      nickname: 'Pippo',
    });
  });
});

describe('salvaNicknameIscrizione', () => {
  it("salva cifrato, con l'impronta per l'evento", async () => {
    const ev = nuovoEvento();
    expect(await salvaNicknameIscrizione(ev, 'r1', 'Pippo')).toEqual({
      ok: true,
      nickname: 'Pippo',
    });
    expect(db.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { nickname: 'enc:Pippo', nicknameKey: improntaNickname(ev, 'Pippo') },
    });
  });

  it('con null lo toglie', async () => {
    expect(await salvaNicknameIscrizione(nuovoEvento(), 'r1', null)).toEqual({
      ok: true,
      nickname: null,
    });
    expect(db.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { nickname: null, nicknameKey: null },
    });
  });

  it('un rifiuto non scrive niente', async () => {
    expect(await salvaNicknameIscrizione(nuovoEvento(), 'r1', 'Relatore')).toMatchObject({
      ok: false,
      motivo: 'reserved',
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("due iscritti insieme: il vincolo unico ferma il secondo, che riceve un'alternativa", async () => {
    db.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      })
    );
    expect(await salvaNicknameIscrizione(nuovoEvento(), 'r1', 'Pippo')).toEqual({
      ok: false,
      motivo: 'taken',
      suggerimento: 'Pippo2',
    });
  });
});

describe('prendiNicknameOspite e nicknameDellOspite', () => {
  const chiave = (ip: string) => (nick: string) => `guest-${ip}-${nick}`;

  it("il primo lo prende; lo stesso ospite lo ritrova; un altro trova un'alternativa", async () => {
    const ev = nuovoEvento();
    expect(await prendiNicknameOspite(ev, 'Pippo', chiave('1'))).toEqual({
      ok: true,
      nickname: 'Pippo',
    });
    expect(await prendiNicknameOspite(ev, 'Pippo', chiave('1'))).toEqual({
      ok: true,
      nickname: 'Pippo',
    });
    expect(await prendiNicknameOspite(ev, 'PIPPO', chiave('2'))).toEqual({
      ok: false,
      motivo: 'taken',
      suggerimento: 'PIPPO2',
    });
  });

  it('un nickname preso da un ospite non passa a un iscritto', async () => {
    const ev = nuovoEvento();
    await prendiNicknameOspite(ev, 'Pippo', chiave('1'));
    expect(await verificaNickname(ev, 'Pippo', { iscrizione: 'r1' })).toMatchObject({
      ok: false,
      motivo: 'taken',
    });
  });

  it("chat e domande lo riconoscono solo per chi l'ha preso", async () => {
    const ev = nuovoEvento();
    await prendiNicknameOspite(ev, 'Pippo', chiave('1'));
    expect(await nicknameDellOspite(ev, 'Pippo', 'guest-1-Pippo')).toBe(true);
    expect(await nicknameDellOspite(ev, 'Pippo', 'guest-2-Pippo')).toBe(false);
    expect(await nicknameDellOspite(ev, 'Mario Rossi', 'guest-1-Mario Rossi')).toBe(
      false
    );
    expect(await nicknameDellOspite(EVENTO, 'Pippo', 'guest-1-Pippo')).toBe(false);
  });
});

describe('nomeDiChiPartecipa', () => {
  it('il nickname, altrimenti lo pseudonimo col pubblico anonimo, altrimenti il nome', async () => {
    expect(
      await nomeDiChiPartecipa(
        { id: 'e', audienceAnonymous: true },
        'reg-1',
        'Pippo',
        'Anna'
      )
    ).toBe('Pippo');
    expect(
      await nomeDiChiPartecipa(
        { id: 'e', audienceAnonymous: false },
        'reg-1',
        null,
        'Anna'
      )
    ).toBe('Anna');
    expect(
      await nomeDiChiPartecipa(
        { id: 'e', audienceAnonymous: true },
        'reg-1',
        null,
        'Anna'
      )
    ).toMatch(/^Partecipante-[2-9A-HJ-NP-Z]{6}$/);
  });

  it("il nickname dell'iscrizione, in chiaro", () => {
    expect(nicknameDellIscrizione({ nickname: 'enc:Pippo' })).toBe('Pippo');
    expect(nicknameDellIscrizione({ nickname: null })).toBeNull();
    expect(nicknameDellIscrizione({})).toBeNull();
  });
});

describe('rispostaNicknameRifiutato', () => {
  it("422 per un nickname che non va, 409 con l'alternativa per uno occupato", async () => {
    const non = rispostaNicknameRifiutato({ motivo: 'host' });
    expect(non.status).toBe(422);
    expect(await non.json()).toMatchObject({ code: 'NICKNAME_INVALID', reason: 'host' });
    const preso = rispostaNicknameRifiutato({ motivo: 'taken', suggerimento: 'Pippo2' });
    expect(preso.status).toBe(409);
    expect(await preso.json()).toMatchObject({
      code: 'NICKNAME_TAKEN',
      suggestion: 'Pippo2',
    });
  });
});

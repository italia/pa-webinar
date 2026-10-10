import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string) => v.replace(/^cif:/, ''),
  encryptPII: (v: string) => `cif:${v}`,
}));

import {
  componiTrascrizione,
  conservazioneFinita,
  contaVoci,
  registrazioneSoloSottotitoli,
  senzaLePersone,
  togliPersoneDalleTrascrizioni,
  vaCostruita,
} from './transcript';

const t0 = new Date('2026-10-20T10:00:00.000Z');
const frase = (seatId: string | null, nome: string | null, testo: string | null, da: number, a: number) => ({
  seatId,
  speakerName: nome ? `cif:${nome}` : null,
  text: testo ? `cif:${testo}` : null,
  language: 'it',
  startedAt: new Date(t0.getTime() + da * 1000),
  endedAt: new Date(t0.getTime() + a * 1000),
});

describe('componiTrascrizione', () => {
  it('le frasi diventano segmenti, con una voce per persona e i nomi dati col consenso', () => {
    const t = componiTrascrizione(
      [
        frase('mod-1', 'Moderatrice', 'Buongiorno a tutti.', 2, 4.5),
        frase('reg-a-1', 'Relatore 1', 'Grazie dell\'invito.', 5, 7),
        frase('mod-1', 'Moderatrice', 'Cominciamo.', 8, 9),
      ],
      t0,
    );
    expect(t.segments).toEqual([
      { start: 2, end: 4.5, text: 'Buongiorno a tutti.', speaker: 'SPEAKER_00' },
      { start: 5, end: 7, text: "Grazie dell'invito.", speaker: 'SPEAKER_01' },
      { start: 8, end: 9, text: 'Cominciamo.', speaker: 'SPEAKER_00' },
    ]);
    expect(t.speakers).toEqual([
      { diarLabel: 'SPEAKER_00', displayName: 'Moderatrice', totalSpeechSec: 4 },
      { diarLabel: 'SPEAKER_01', displayName: 'Relatore 1', totalSpeechSec: 2 },
    ]);
    expect(t.language).toBe('it');
    expect(t.source).toBe('live-captions');
  });

  it('chi si ricollega resta lo stesso parlante', () => {
    const iscrizione = '0b1f6c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f';
    const t = componiTrascrizione(
      [
        // Stessa iscrizione, due ingressi: due posti diversi.
        frase(`reg-${iscrizione}-aaaa1111`, 'Relatore 1', 'Prima parte.', 1, 2),
        // Link di moderazione condiviso: due ingressi con lo stesso nome.
        frase('mod-ev-11111111', 'Moderatrice', 'Benvenuti.', 3, 4),
        frase(`reg-${iscrizione}-bbbb2222`, 'Relatore 1', 'Seconda parte.', 5, 6),
        frase('mod-ev-22222222', 'moderatrice ', 'Grazie.', 7, 8),
        // Lo stesso link con un altro nome: un'altra persona.
        frase('mod-ev-33333333', 'Relatore 2', 'Una domanda.', 9, 10),
      ],
      t0,
    );
    expect(t.segments.map((s) => s.speaker)).toEqual([
      'SPEAKER_00',
      'SPEAKER_01',
      'SPEAKER_00',
      'SPEAKER_01',
      'SPEAKER_02',
    ]);
    expect(t.speakers.map((s) => s.displayName)).toEqual(['Relatore 1', 'Moderatrice', 'Relatore 2']);
  });

  it('di chi non ha acconsentito non resta niente', () => {
    const t = componiTrascrizione([frase(null, null, null, 1, 2), frase('mod-1', 'M', 'Si.', 3, 4)], t0);
    expect(t.segments).toHaveLength(1);
    expect(t.speakers).toHaveLength(1);
  });

  it('una frase detta prima dell\'inizio del video parte da zero', () => {
    const t = componiTrascrizione([frase('mod-1', 'M', 'Prova.', -3, -1)], t0);
    expect(t.segments[0]).toMatchObject({ start: 0, end: 0 });
  });
});

describe('registrazioneSoloSottotitoli', () => {
  it('riconosce la registrazione senza file', () => {
    expect(registrazioneSoloSottotitoli({ blobKey: '' })).toBe(true);
    expect(registrazioneSoloSottotitoli({ blobKey: 'recordings/ev/a.mp4' })).toBe(false);
    expect(registrazioneSoloSottotitoli({ blobKey: 'multitrack/ev/' })).toBe(false);
  });
});

describe('senzaLePersone', () => {
  const corpo = JSON.stringify({
    source: 'live-captions',
    segments: [
      { start: 0, end: 1, text: 'Uno', speaker: 'SPEAKER_00' },
      { start: 1, end: 2, text: 'Due', speaker: 'SPEAKER_01' },
      { start: 2, end: 3, text: 'Tre', speaker: 'SPEAKER_00' },
    ],
    speakers: [
      { diarLabel: 'SPEAKER_00', displayName: 'Relatore 1', registrationId: 'r1' },
      { diarLabel: 'SPEAKER_01', displayName: 'Moderatrice' },
    ],
  });

  it('toglie frasi e voce della persona, il resto resta', () => {
    const r = senzaLePersone(corpo, new Set(['r1']));
    expect(r?.etichette).toEqual(['SPEAKER_00']);
    expect(r?.vuoto).toBe(false);
    const t = JSON.parse(r!.corpo) as { segments: Array<{ text: string }>; speakers: Array<{ diarLabel: string }>; source: string };
    expect(t.segments.map((s) => s.text)).toEqual(['Due']);
    expect(t.speakers.map((s) => s.diarLabel)).toEqual(['SPEAKER_01']);
    expect(t.source).toBe('live-captions');
  });

  it('non tocca una trascrizione senza quella persona', () => {
    expect(senzaLePersone(corpo, new Set(['altra']))).toBeNull();
  });

  it('il nome registrato con le frasi resta solo dove serve', () => {
    const t = componiTrascrizione(
      [frase('reg-0b1f6c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f-aa', 'Relatore 1', 'Ciao.', 1, 2), frase('mod-1', 'M', 'Si.', 3, 4)],
      t0,
    );
    expect(t.speakers).toEqual([
      expect.objectContaining({ diarLabel: 'SPEAKER_00', registrationId: '0b1f6c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f' }),
      expect.not.objectContaining({ registrationId: expect.anything() }),
    ]);
  });
});

describe('togliPersoneDalleTrascrizioni', () => {
  const corpo = (segs: Array<[string, string]>) =>
    `cif:${JSON.stringify({
      segments: segs.map(([speaker, text]) => ({ start: 0, end: 1, speaker, text })),
      speakers: [
        { diarLabel: 'SPEAKER_00', registrationId: 'r1' },
        { diarLabel: 'SPEAKER_01' },
      ],
    })}`;

  function txCon(artefatti: unknown[]) {
    return {
      postprodArtifact: { findMany: vi.fn(async () => artefatti), update: vi.fn(), delete: vi.fn() },
      postprodOriginalBody: { update: vi.fn() },
      speaker: { deleteMany: vi.fn() },
      recording: { delete: vi.fn() },
    };
  }

  it('riscrive la trascrizione e il testo originale, e toglie la voce', async () => {
    const tx = txCon([
      {
        id: 'a1',
        recordingId: 'rec-1',
        inlineBody: corpo([['SPEAKER_00', 'Mio'], ['SPEAKER_01', 'Altro']]),
        recording: { blobKey: '' },
        original: { id: 'o1', body: corpo([['SPEAKER_00', 'Mio originale'], ['SPEAKER_01', 'Altro']]) },
      },
    ]);
    const n = await togliPersoneDalleTrascrizioni(tx as never, ['ev-1'], ['r1']);
    expect(n).toBe(1);
    const scritto = (tx.postprodArtifact.update.mock.calls[0]![0] as { data: { inlineBody: string } }).data.inlineBody;
    expect(scritto).not.toContain('Mio');
    expect(scritto).toContain('Altro');
    const originale = (tx.postprodOriginalBody.update.mock.calls[0]![0] as { data: { body: string } }).data.body;
    expect(originale).not.toContain('Mio originale');
    expect(tx.speaker.deleteMany).toHaveBeenCalledWith({
      where: { recordingId: 'rec-1', diarLabel: { in: ['SPEAKER_00'] } },
    });
  });

  it('una trascrizione che resta vuota se ne va, con la registrazione senza file', async () => {
    const tx = txCon([
      {
        id: 'a1',
        recordingId: 'rec-1',
        inlineBody: corpo([['SPEAKER_00', 'Mio']]),
        recording: { blobKey: '' },
        original: null,
      },
    ]);
    await togliPersoneDalleTrascrizioni(tx as never, ['ev-1'], ['r1']);
    expect(tx.recording.delete).toHaveBeenCalledWith({ where: { id: 'rec-1' } });
    expect(tx.postprodArtifact.update).not.toHaveBeenCalled();
  });
});

describe('vaCostruita', () => {
  const adesso = new Date('2026-10-20T12:00:00.000Z');
  const prima = (min: number) => new Date(adesso.getTime() - min * 60_000);
  const base = { ultimaFrase: prima(10), ai: false, video: false, costruita: null };

  it('aspetta che le frasi smettano di arrivare', () => {
    expect(vaCostruita({ ...base, ultimaFrase: prima(1) }, adesso)).toBe(false);
    expect(vaCostruita(base, adesso)).toBe(true);
  });

  it('ricostruisce se sono arrivate frasi dopo l\'ultima volta', () => {
    const costruita = { il: prima(20), corretta: false, soloSottotitoli: true };
    expect(vaCostruita({ ...base, costruita }, adesso)).toBe(true);
    expect(vaCostruita({ ...base, costruita: { ...costruita, il: prima(5) } }, adesso)).toBe(false);
  });

  it('si sposta sulla registrazione con il video quando arriva', () => {
    const costruita = { il: prima(5), corretta: false, soloSottotitoli: true };
    expect(vaCostruita({ ...base, video: true, costruita }, adesso)).toBe(true);
    expect(vaCostruita({ ...base, video: true, costruita: { ...costruita, soloSottotitoli: false } }, adesso)).toBe(false);
  });

  it('non tocca una trascrizione corretta a mano ne\' una dell\'AI', () => {
    const costruita = { il: prima(20), corretta: true, soloSottotitoli: true };
    expect(vaCostruita({ ...base, video: true, costruita }, adesso)).toBe(false);
    expect(vaCostruita({ ...base, ai: true }, adesso)).toBe(false);
  });
});

describe('contaVoci', () => {
  it('conta le persone: chi si ricollega non vale due', () => {
    const iscrizione = '0b1f6c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f';
    expect(
      contaVoci([
        { seatId: `reg-${iscrizione}-aa`, speakerName: 'cif:Relatore 1' },
        { seatId: `reg-${iscrizione}-bb`, speakerName: 'cif:Relatore 1' },
        { seatId: 'mod-ev-1', speakerName: 'cif:Moderatrice' },
        { seatId: null, speakerName: null },
      ]),
    ).toBe(2);
  });
});

describe('conservazioneFinita', () => {
  it('dopo la fine piu\' i giorni di conservazione', () => {
    const fine = new Date('2026-10-01T10:00:00.000Z');
    expect(conservazioneFinita({ endsAt: fine, dataRetentionDays: 30 }, new Date('2026-10-30T10:00:00.000Z'))).toBe(false);
    expect(conservazioneFinita({ endsAt: fine, dataRetentionDays: 30 }, new Date('2026-11-01T10:00:00.000Z'))).toBe(true);
  });
});

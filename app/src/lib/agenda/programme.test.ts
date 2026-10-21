import { describe, expect, it } from 'vitest';

import {
  durataProgramma,
  orariProgramma,
  parsePlannedMinutes,
  relatoreDelProgramma,
} from './programme';

const INIZIO = new Date('2026-10-21T08:00:00.000Z');
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('orariProgramma', () => {
  it('somma le durate a partire dall’inizio dell’evento', () => {
    const orari = orariProgramma(INIZIO, [
      { plannedMinutes: 10 },
      { plannedMinutes: 30 },
      { plannedMinutes: 20 },
    ]);
    expect(orari.map((o) => [iso(o.start), iso(o.end)])).toEqual([
      ['2026-10-21T08:00:00.000Z', '2026-10-21T08:10:00.000Z'],
      ['2026-10-21T08:10:00.000Z', '2026-10-21T08:40:00.000Z'],
      ['2026-10-21T08:40:00.000Z', '2026-10-21T09:00:00.000Z'],
    ]);
  });

  it('dal primo argomento senza durata in poi non dice piu’ orari', () => {
    const orari = orariProgramma(INIZIO, [
      { plannedMinutes: 15 },
      { plannedMinutes: null },
      { plannedMinutes: 20 },
    ]);
    expect(orari.map((o) => [iso(o.start), iso(o.end)])).toEqual([
      ['2026-10-21T08:00:00.000Z', '2026-10-21T08:15:00.000Z'],
      // Si sa quando comincia, non quando finisce.
      ['2026-10-21T08:15:00.000Z', null],
      [null, null],
    ]);
  });

  it('nessun argomento, nessun orario', () => {
    expect(orariProgramma(INIZIO, [])).toEqual([]);
  });
});

describe('durataProgramma', () => {
  it('la somma, solo se ogni argomento ha una durata', () => {
    expect(durataProgramma([{ plannedMinutes: 10 }, { plannedMinutes: 35 }])).toBe(45);
    expect(
      durataProgramma([{ plannedMinutes: 10 }, { plannedMinutes: null }])
    ).toBeNull();
    expect(durataProgramma([])).toBeNull();
  });
});

describe('parsePlannedMinutes', () => {
  it('vuoto è nessuna durata, un intero da 1 a 600 è la durata, il resto non vale', () => {
    expect(parsePlannedMinutes('  ')).toBeNull();
    expect(parsePlannedMinutes(' 45 ')).toBe(45);
    expect(parsePlannedMinutes('600')).toBe(600);
    expect(parsePlannedMinutes('0')).toBeUndefined();
    expect(parsePlannedMinutes('601')).toBeUndefined();
    expect(parsePlannedMinutes('1e2')).toBeUndefined();
    expect(parsePlannedMinutes('10,5')).toBeUndefined();
  });
});

describe('relatoreDelProgramma', () => {
  const evento = {
    moderatorName: 'Organizzatrice',
    moderatorPublicListed: true,
    moderatorOrganization: 'Ente A',
    moderatorPhotoId: 'foto-1',
  };
  const persona = {
    name: 'cifrato:Relatore 1',
    organization: 'Ente B',
    photoId: 'foto-2',
    publicListed: true,
    revokedAt: null as Date | null,
  };
  const decifra = (v: string) => v.replace('cifrato:', '');

  it('una persona presentata: nome decifrato, ente e foto', () => {
    expect(
      relatoreDelProgramma({ speakerPrimary: false, speaker: persona }, evento, decifra)
    ).toEqual({
      name: 'Relatore 1',
      organization: 'Ente B',
      photoUrl: '/api/avatar/person/foto-2',
    });
  });

  it('una persona non presentata o revocata non esce: il programma mostra solo l’argomento', () => {
    expect(
      relatoreDelProgramma(
        { speakerPrimary: false, speaker: { ...persona, publicListed: false } },
        evento,
        decifra
      )
    ).toBeNull();
    expect(
      relatoreDelProgramma(
        { speakerPrimary: false, speaker: { ...persona, revokedAt: new Date() } },
        evento,
        decifra
      )
    ).toBeNull();
    expect(
      relatoreDelProgramma({ speakerPrimary: false, speaker: null }, evento, decifra)
    ).toBeNull();
  });

  it('l’organizzatore principale solo se è presentato', () => {
    expect(
      relatoreDelProgramma({ speakerPrimary: true, speaker: null }, evento, decifra)
    ).toEqual({
      name: 'Organizzatrice',
      organization: 'Ente A',
      photoUrl: '/api/avatar/person/foto-1',
    });
    expect(
      relatoreDelProgramma(
        { speakerPrimary: true, speaker: null },
        { ...evento, moderatorPublicListed: false },
        decifra
      )
    ).toBeNull();
  });
});

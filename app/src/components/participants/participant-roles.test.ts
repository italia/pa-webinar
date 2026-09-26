// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  canKick,
  normalizeRole,
  rolesAreMeaningful,
  rolesFromRoomsInfo,
} from './participant-roles';

describe('rolesFromRoomsInfo', () => {
  it('legge id e ruolo dalla stanza principale', () => {
    const info = {
      rooms: [
        {
          isMainRoom: true,
          id: 'sala',
          participants: [
            { id: 'aaa', role: 'moderator', displayName: 'Relatore 1' },
            { id: 'bbb', role: 'participant', displayName: 'Ospite' },
            { id: 'ccc', role: 'visitor' },
          ],
        },
        { isMainRoom: false, participants: [{ id: 'zzz', role: 'moderator' }] },
      ],
    };
    expect(rolesFromRoomsInfo(info)).toEqual({
      aaa: 'moderator',
      bbb: 'participant',
      ccc: 'participant',
    });
  });

  it('senza il segno di stanza principale valgono tutte', () => {
    expect(
      rolesFromRoomsInfo({ rooms: [{ participants: [{ id: 'aaa', role: 'moderator' }] }] }),
    ).toEqual({ aaa: 'moderator' });
  });

  it('una risposta illeggibile non inventa ruoli', () => {
    expect(rolesFromRoomsInfo(undefined)).toEqual({});
    expect(rolesFromRoomsInfo({ rooms: 'no' })).toEqual({});
    expect(rolesFromRoomsInfo({ rooms: [{ participants: [{ id: 'aaa' }, { role: 'moderator' }, null] }] })).toEqual({});
  });
});

describe('normalizeRole', () => {
  it('solo «moderator» è moderatore; ruolo assente = sconosciuto', () => {
    expect(normalizeRole('moderator')).toBe('moderator');
    expect(normalizeRole('none')).toBe('participant');
    expect(normalizeRole('')).toBeNull();
    expect(normalizeRole(undefined)).toBeNull();
  });
});

describe('rolesAreMeaningful', () => {
  const ids = ['aaa', 'bbb', 'ccc'];

  it('nessun ruolo noto: niente etichette', () => {
    expect(rolesAreMeaningful({}, ids)).toBe(false);
  });

  it('tutti moderatori, come quando Jicofo non assegna il ruolo dal token: niente etichette', () => {
    expect(
      rolesAreMeaningful({ aaa: 'moderator', bbb: 'moderator', ccc: 'moderator' }, ids),
    ).toBe(false);
  });

  it('moderatori e partecipanti insieme: le etichette distinguono qualcuno', () => {
    expect(rolesAreMeaningful({ aaa: 'moderator', bbb: 'participant' }, ids)).toBe(true);
  });

  it('conta solo chi è in elenco', () => {
    expect(rolesAreMeaningful({ aaa: 'moderator', uscito: 'participant' }, ids)).toBe(false);
  });
});

describe('canKick', () => {
  it('chi modera nel portale: su ogni riga tranne la propria', () => {
    expect(canKick(true, 'bbb', 'aaa')).toBe(true);
    expect(canKick(true, 'aaa', 'aaa')).toBe(false);
  });

  it('chi non modera nel portale: mai, qualunque sia il ruolo in Jitsi', () => {
    expect(canKick(false, 'bbb', 'aaa')).toBe(false);
  });

  it('id locale non ancora noto: il pulsante resta', () => {
    expect(canKick(true, 'bbb', null)).toBe(true);
    expect(canKick(true, 'bbb', '')).toBe(true);
  });
});

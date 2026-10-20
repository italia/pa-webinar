import { describe, expect, it } from 'vitest';

import { fusoCalendario, offsetMinutes, oraUtc } from './timezone';

/**
 * L'ora locale con TZID vale solo se la VTIMEZONE del file la riporta
 * all'istante giusto. Qui le regole ricavate si confrontano con quelle note,
 * e i casi in cui non sono sicure devono ricadere sull'UTC.
 */

const d = (iso: string) => new Date(iso);

describe('offsetMinutes', () => {
  it('legge lo scarto del fuso all’istante dato', () => {
    expect(offsetMinutes('Europe/Rome', d('2026-01-15T12:00:00Z').getTime())).toBe(60);
    expect(offsetMinutes('Europe/Rome', d('2026-07-15T12:00:00Z').getTime())).toBe(120);
    expect(offsetMinutes('America/New_York', d('2026-01-15T12:00:00Z').getTime())).toBe(
      -300
    );
    expect(offsetMinutes('Asia/Kolkata', d('2026-01-15T12:00:00Z').getTime())).toBe(330);
  });
});

describe('fusoCalendario', () => {
  it('Europa/Roma: ora legale e solare con le regole dell’ultima domenica', () => {
    const fuso = fusoCalendario('Europe/Rome', [
      d('2026-10-21T09:00:00Z'),
      d('2026-10-21T10:30:00Z'),
    ])!;
    expect(fuso).not.toBeNull();
    expect(fuso.vtimezone).toEqual([
      'BEGIN:VTIMEZONE',
      'TZID:Europe/Rome',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700329T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0200',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:19701025T030000',
      'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
      'TZOFFSETFROM:+0200',
      'TZOFFSETTO:+0100',
      'END:STANDARD',
      'END:VTIMEZONE',
    ]);
    // 09:00 UTC in ottobre (ora legale) sono le 11:00 a Roma.
    expect(fuso.property('DTSTART', d('2026-10-21T09:00:00Z'))).toBe(
      'DTSTART;TZID=Europe/Rome:20261021T110000'
    );
    // In inverno l'ora solare: 14:00 UTC sono le 15:00.
    expect(fuso.property('DTEND', d('2027-01-15T14:00:00Z'))).toBe(
      'DTEND;TZID=Europe/Rome:20270115T150000'
    );
  });

  it('America/New_York: seconda domenica di marzo, prima di novembre', () => {
    const fuso = fusoCalendario('America/New_York', [d('2026-11-10T15:00:00Z')])!;
    expect(fuso.vtimezone).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
    expect(fuso.vtimezone).toContain('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU');
    expect(fuso.vtimezone).toContain('TZOFFSETTO:-0500');
    expect(fuso.property('DTSTART', d('2026-11-10T15:00:00Z'))).toBe(
      'DTSTART;TZID=America/New_York:20261110T100000'
    );
  });

  it('emisfero sud: l’ora legale comincia in ottobre', () => {
    const fuso = fusoCalendario('Australia/Sydney', [d('2026-12-01T00:00:00Z')])!;
    const daylight = fuso.vtimezone.slice(
      fuso.vtimezone.indexOf('BEGIN:DAYLIGHT'),
      fuso.vtimezone.indexOf('END:DAYLIGHT')
    );
    expect(daylight).toContain('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU');
    expect(daylight).toContain('TZOFFSETTO:+1100');
    expect(fuso.property('DTSTART', d('2026-12-01T00:00:00Z'))).toBe(
      'DTSTART;TZID=Australia/Sydney:20261201T110000'
    );
  });

  it('un fuso senza ora legale ha una sola osservanza', () => {
    const fuso = fusoCalendario('Asia/Tokyo', [d('2026-10-21T01:00:00Z')])!;
    expect(fuso.vtimezone).toEqual([
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Tokyo',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0900',
      'TZOFFSETTO:+0900',
      'END:STANDARD',
      'END:VTIMEZONE',
    ]);
    expect(fuso.property('DTSTART', d('2026-10-21T01:00:00Z'))).toBe(
      'DTSTART;TZID=Asia/Tokyo:20261021T100000'
    );
  });

  it('ricade sull’UTC a ridosso di un cambio d’ora, dove l’ora locale è ambigua', () => {
    // 25 ottobre 2026: alle 01:00 UTC Roma torna all'ora solare.
    expect(fusoCalendario('Europe/Rome', [d('2026-10-25T02:00:00Z')])).toBeNull();
    expect(
      fusoCalendario('Europe/Rome', [
        d('2026-10-24T20:00:00Z'),
        d('2026-10-24T23:30:00Z'),
      ])
    ).toBeNull();
    // Fuori dal margine, il fuso torna.
    expect(fusoCalendario('Europe/Rome', [d('2026-10-25T09:00:00Z')])).not.toBeNull();
  });

  it('ricade sull’UTC per UTC, fusi sconosciuti o malformati', () => {
    const quando = [d('2026-10-21T09:00:00Z')];
    expect(fusoCalendario('UTC', quando)).toBeNull();
    expect(fusoCalendario('Etc/UTC', quando)).toBeNull();
    expect(fusoCalendario('', quando)).toBeNull();
    expect(fusoCalendario('Mars/Olympus_Mons', quando)).toBeNull();
    expect(fusoCalendario('Europe/Rome;X=1', quando)).toBeNull();
    expect(fusoCalendario('Europe/Rome', [])).toBeNull();
  });
});

describe('oraUtc', () => {
  it('scrive l’istante con la Z', () => {
    expect(oraUtc(d('2026-10-21T09:05:07Z'))).toBe('20261021T090507Z');
  });
});

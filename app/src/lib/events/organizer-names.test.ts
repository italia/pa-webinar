import { describe, expect, it } from 'vitest';

import { nomiOrganizzatori } from './organizer-names';

describe('nomiOrganizzatori', () => {
  it('gli enti, nell’ordine dato, vincono sul nome libero', () => {
    expect(
      nomiOrganizzatori({
        organizers: [{ name: 'Ente Uno' }, { name: ' Ente Due ' }, { name: ' ' }],
        organizerName: 'Nome libero',
      })
    ).toBe('Ente Uno, Ente Due');
  });

  it('senza enti il nome libero, senza nessuno una stringa vuota', () => {
    expect(nomiOrganizzatori({ organizers: [], organizerName: ' Nome libero ' })).toBe(
      'Nome libero'
    );
    expect(nomiOrganizzatori({ organizerName: null })).toBe('');
  });
});

import { describe, expect, it } from 'vitest';

import { BOZZA_VUOTA, controllaBozza, conRuolo, indirizziPresi } from './people-draft';

/**
 * Le regole di una persona nuova, le stesse nel passo «Persone» e nel modulo
 * breve del passo «Programma».
 */
describe('controllaBozza', () => {
  const presi = indirizziPresi(
    [{ email: 'Anna@Example.org' }],
    [{ email: 'luca@example.org' }],
    ['chi@example.org ']
  );

  it('nome ed email servono', () => {
    expect(controllaBozza({ ...BOZZA_VUOTA, name: 'Carla' }, presi)).toEqual({
      errore: 'personRequired',
    });
    expect(controllaBozza({ ...BOZZA_VUOTA, email: 'c@example.org' }, presi)).toEqual({
      errore: 'personRequired',
    });
  });

  it('un indirizzo non valido, o gia’ usato (organizzatore principale compreso), non passa', () => {
    const bozza = { ...BOZZA_VUOTA, name: 'Carla' };
    expect(controllaBozza({ ...bozza, email: 'carla' }, presi)).toEqual({
      errore: 'invalidEmail',
    });
    expect(controllaBozza({ ...bozza, email: ' ANNA@example.org' }, presi)).toEqual({
      errore: 'duplicateEmail',
    });
    expect(controllaBozza({ ...bozza, email: 'chi@example.org' }, presi)).toEqual({
      errore: 'duplicateEmail',
    });
  });

  it('pronta: nome e ente senza spazi, indirizzo in minuscolo, non presentata se non lo si sceglie', () => {
    expect(
      controllaBozza(
        {
          ...BOZZA_VUOTA,
          name: ' Carla Verdi ',
          email: 'Carla@Example.org',
          organization: ' Ente ',
        },
        presi
      )
    ).toEqual({
      role: 'speaker',
      persona: {
        name: 'Carla Verdi',
        email: 'carla@example.org',
        personId: null,
        organization: 'Ente',
        organizationLogoUrl: null,
        publicListed: false,
        photoId: null,
      },
    });
  });
});

describe('conRuolo', () => {
  const persona = { ...BOZZA_VUOTA, name: 'Carla', email: 'carla@example.org' };
  it('relatore fra i relatori; moderatore e organizzatore fra chi conduce', () => {
    expect(conRuolo([], [], persona, 'speaker')).toEqual({
      moderators: [],
      speakers: [persona],
    });
    expect(conRuolo([], [], persona, 'organizer').moderators[0]).toMatchObject({
      organizer: true,
    });
    expect(conRuolo([], [], persona, 'moderator').moderators[0]).toMatchObject({
      organizer: false,
    });
  });
});

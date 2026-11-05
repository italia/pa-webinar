// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import { rubricaProposta } from './address-book';

describe('rubricaProposta', () => {
  it('propone la rubrica se installazione ed evento la tengono accesa', () => {
    expect(
      rubricaProposta({ offerAddressBook: true }, { addressBookEnabled: true })
    ).toBe(true);
  });

  it("non la propone se l'evento non la offre", () => {
    expect(
      rubricaProposta({ offerAddressBook: false }, { addressBookEnabled: true })
    ).toBe(false);
  });

  it("non la propone se l'installazione la spegne, anche se l'evento la offre", () => {
    expect(
      rubricaProposta({ offerAddressBook: true }, { addressBookEnabled: false })
    ).toBe(false);
  });

  it('non la propone se sono spente entrambe', () => {
    expect(
      rubricaProposta({ offerAddressBook: false }, { addressBookEnabled: false })
    ).toBe(false);
  });

  it('un flag assente vale acceso', () => {
    expect(rubricaProposta({}, {})).toBe(true);
    expect(rubricaProposta({ offerAddressBook: true }, {})).toBe(true);
    expect(rubricaProposta({}, { addressBookEnabled: true })).toBe(true);
    expect(
      rubricaProposta({ offerAddressBook: null }, { addressBookEnabled: null })
    ).toBe(true);
  });

  it("un flag assente non annulla il false dell'altro", () => {
    expect(rubricaProposta({ offerAddressBook: false }, {})).toBe(false);
    expect(rubricaProposta({}, { addressBookEnabled: false })).toBe(false);
  });
});

// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { Prisma, type EventTemplate } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { NOT_PRESET_TEMPLATE_FIELDS, presetDelModello } from './template-preset';

/**
 * Il presidio della whitelist fra il modello e il wizard: ogni colonna arriva al
 * wizard, o dice perche' no. Un campo dimenticato non da' errori: il modello
 * direbbe pseudonimi, e l'evento nascerebbe con i nomi.
 */
const colonne = (
  Prisma.dmmf.datamodel.models.find((m) => m.name === 'EventTemplate')?.fields ?? []
)
  .filter((f) => f.kind === 'scalar' || f.kind === 'enum')
  .map((f) => f.name);

const riga = Object.fromEntries(
  colonne.map((c) => [c, null])
) as unknown as EventTemplate;

describe('presetDelModello', () => {
  it('classifica ogni colonna del modello', () => {
    expect(colonne.length).toBeGreaterThan(20);
    const passate = new Set(Object.keys(presetDelModello(riga)));
    const escluse = new Set(Object.keys(NOT_PRESET_TEMPLATE_FIELDS));
    expect(colonne.filter((c) => !passate.has(c) && !escluse.has(c))).toEqual([]);
  });

  it('non esclude una colonna che passa, e non nomina colonne che non ci sono', () => {
    const passate = new Set(Object.keys(presetDelModello(riga)));
    expect(Object.keys(NOT_PRESET_TEMPLATE_FIELDS).filter((c) => passate.has(c))).toEqual(
      []
    );
    expect(
      Object.keys(NOT_PRESET_TEMPLATE_FIELDS).filter((c) => !colonne.includes(c))
    ).toEqual([]);
    expect([...passate].filter((c) => !colonne.includes(c))).toEqual([]);
  });

  it('porta i valori del modello, senza dire nomi delle colonne di servizio', () => {
    const preset = presetDelModello({
      ...riga,
      id: 'tpl-1',
      name: 'Webinar',
      recordingDestination: 'PUBLIC',
      offerAddressBook: false,
      audienceAnonymous: true,
      hostsAlwaysRecorded: true,
      postEventShowQA: false,
      isSystem: true,
    });
    expect(preset).toMatchObject({
      id: 'tpl-1',
      name: 'Webinar',
      recordingDestination: 'PUBLIC',
      offerAddressBook: false,
      audienceAnonymous: true,
      hostsAlwaysRecorded: true,
      postEventShowQA: false,
      permissionMatrix: null,
      descriptionTemplate: null,
    });
    expect(preset).not.toHaveProperty('isSystem');
  });
});

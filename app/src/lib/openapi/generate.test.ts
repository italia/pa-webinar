// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import { generateOpenApiSpec } from './generate';

interface SchemaOggetto {
  properties: Record<string, { items?: { properties?: Record<string, unknown> } }>;
}

interface Specifica {
  paths: Record<
    string,
    {
      get: {
        description: string;
        responses: Record<
          string,
          { content: { 'application/json': { schema: SchemaOggetto } } }
        >;
      };
    }
  >;
}

describe('generateOpenApiSpec', () => {
  const rotta = (generateOpenApiSpec() as Specifica).paths['/api/gdpr/export']?.get;
  const risposta = rotta?.responses['200']?.content['application/json'].schema;

  it("dichiara le prove di sala dell'export, campo per campo", () => {
    const campi = risposta?.properties.roomConsentProofs?.items?.properties ?? {};
    expect(Object.keys(campi).sort()).toEqual(
      [
        'destination',
        'event',
        'eventId',
        'givenAt',
        'kind',
        'locale',
        'name',
        'superseded',
        'textVersion',
        'withdrawnAt',
      ].sort()
    );
  });

  it('la descrizione della rotta le nomina tra i dati che durano', () => {
    expect(rotta?.description).toContain('led an event');
  });
});

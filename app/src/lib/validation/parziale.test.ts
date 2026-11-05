// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { glossaryTermPatchSchema } from '@/lib/ai/glossary';

import { updateMaterialAdminSchema } from './materials';
import { parzialeSenzaDefault } from './parziale';
import {
  updateEventSchema,
  updateGdprTemplateSchema,
  updateQuestionTemplateSchema,
} from './schemas';

describe('parzialeSenzaDefault', () => {
  const base = z.object({
    titolo: z.string().min(2),
    pubblico: z.boolean().default(true),
    posti: z.number().optional().default(10),
    lista: z.boolean().default(false).nullable(),
    nota: z.string().nullable().optional(),
  });

  it('un campo non mandato resta assente, con ogni forma di default', () => {
    expect(parzialeSenzaDefault(base).parse({})).toEqual({});
  });

  it('un campo mandato resta quello mandato', () => {
    expect(parzialeSenzaDefault(base).parse({ pubblico: false, lista: null })).toEqual({
      pubblico: false,
      lista: null,
    });
  });

  it('i controlli restano', () => {
    expect(parzialeSenzaDefault(base).safeParse({ titolo: 'x' }).success).toBe(false);
  });

  it('uno schema stretto resta stretto', () => {
    const stretto = parzialeSenzaDefault(
      z.object({ a: z.string().default('x') }).strict()
    );
    expect(stretto.safeParse({ b: 1 }).success).toBe(false);
  });

  it('non cambia lo schema di creazione', () => {
    parzialeSenzaDefault(base);
    expect(base.parse({ titolo: 'ab', lista: null })).toEqual({
      titolo: 'ab',
      pubblico: true,
      posti: 10,
      lista: null,
    });
  });
});

describe('le modifiche parziali non riscrivono i campi non mandati', () => {
  it.each([
    ['evento', updateEventSchema],
    ['materiale', updateMaterialAdminSchema],
    ['informativa', updateGdprTemplateSchema],
    ['questionario', updateQuestionTemplateSchema],
    ['glossario', glossaryTermPatchSchema],
  ])('%s', (_nome, schema) => {
    expect(schema.parse({})).toEqual({});
  });
});

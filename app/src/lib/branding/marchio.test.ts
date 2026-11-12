// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import { eNomeDelProdotto, larghezzaMarchioIntero } from './marchio';

describe('eNomeDelProdotto', () => {
  it('treats an empty or missing site name as the product name', () => {
    expect(eNomeDelProdotto('')).toBe(true);
    expect(eNomeDelProdotto('   ')).toBe(true);
    expect(eNomeDelProdotto(null)).toBe(true);
    expect(eNomeDelProdotto(undefined)).toBe(true);
  });

  it('recognises the product name whatever the case and spacing', () => {
    expect(eNomeDelProdotto('PA Webinar')).toBe(true);
    expect(eNomeDelProdotto('PA webinar')).toBe(true);
    expect(eNomeDelProdotto('  pa WEBINAR ')).toBe(true);
  });

  it('leaves a name of its own to the installation', () => {
    expect(eNomeDelProdotto('Webinar del Comune')).toBe(false);
    expect(eNomeDelProdotto('PA Webinar Regione')).toBe(false);
    expect(eNomeDelProdotto('PAWebinar')).toBe(false);
  });
});

describe('larghezzaMarchioIntero', () => {
  it('keeps the proportions of the logo file at the sizes in use', () => {
    expect(larghezzaMarchioIntero(40)).toBe(181);
    expect(larghezzaMarchioIntero(22)).toBe(99);
  });
});

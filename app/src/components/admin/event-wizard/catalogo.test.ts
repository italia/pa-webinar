// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import {
  catalogoDaSalvare,
  catalogoDellEvento,
  catalogoDopoIlSalvataggio,
  type CampiCatalogo,
} from './catalogo';

const MODELLO = '33333333-3333-4333-8333-333333333333';
const MODELLI = [{ id: MODELLO }];

const campi = (c: Partial<CampiCatalogo> = {}): CampiCatalogo => ({
  templateId: null,
  deletedTemplateName: null,
  formatClass: null,
  ...c,
});

describe('Il catalogo che il wizard salva', () => {
  it('in creazione manda la scelta di partenza, e niente se non ce n e', () => {
    expect(catalogoDaSalvare(campi({ templateId: MODELLO }), null, false)).toEqual({
      templateId: MODELLO,
    });
    expect(catalogoDaSalvare(campi({ formatClass: 'MEETING' }), null, false)).toEqual({
      formatClass: 'MEETING',
    });
    expect(catalogoDaSalvare(campi(), null, false)).toEqual({});
  });

  it('in modifica manda solo cio che cambia, anche per togliere', () => {
    const salvato = campi({ templateId: MODELLO, formatClass: 'PUBLIC' });
    expect(catalogoDaSalvare(salvato, salvato, false, MODELLI)).toEqual({});
    expect(
      catalogoDaSalvare(campi({ formatClass: 'PUBLIC' }), salvato, false, MODELLI)
    ).toEqual({ templateId: null });
    expect(
      catalogoDaSalvare(
        campi({ templateId: MODELLO, formatClass: 'MEETING' }),
        salvato,
        false,
        MODELLI
      )
    ).toEqual({ formatClass: 'MEETING' });
  });

  it('togliere il nome di un modello cancellato manda «nessun modello»', () => {
    const salvato = campi({ deletedTemplateName: 'Vecchio' });
    expect(catalogoDaSalvare(salvato, salvato, false, MODELLI)).toEqual({});
    expect(catalogoDaSalvare(campi(), salvato, false, MODELLI)).toEqual({
      templateId: null,
    });
  });

  it('un modello che non esiste piu (da una bozza) non si manda', () => {
    const salvato = campi();
    expect(
      catalogoDaSalvare(campi({ templateId: 'non-esiste' }), salvato, false, MODELLI)
    ).toEqual({});
  });

  it('con un link di conduzione non manda niente: lo decide lo staff', () => {
    expect(
      catalogoDaSalvare(
        campi({ templateId: MODELLO, formatClass: 'MEETING' }),
        campi(),
        true,
        MODELLI
      )
    ).toEqual({});
  });

  it('dopo un salvataggio riuscito il confronto riparte da cio che si e mandato', () => {
    const prima = campi({ templateId: MODELLO, formatClass: 'PUBLIC' });
    const dopo = catalogoDopoIlSalvataggio(prima, { templateId: null });
    expect(dopo).toEqual(campi({ formatClass: 'PUBLIC' }));
    // Tornare al modello di prima e' di nuovo un cambio.
    expect(catalogoDaSalvare(prima, dopo, false, MODELLI)).toEqual({
      templateId: MODELLO,
    });
    expect(
      catalogoDopoIlSalvataggio(campi({ deletedTemplateName: 'Vecchio' }), {
        formatClass: 'MEETING',
      })
    ).toEqual(campi({ deletedTemplateName: 'Vecchio', formatClass: 'MEETING' }));
  });

  it('un evento di prima del catalogo parte vuoto; un modello cancellato resta col nome', () => {
    expect(catalogoDellEvento({})).toEqual(campi());
    expect(catalogoDellEvento({ templateId: null, templateName: 'Vecchio' })).toEqual(
      campi({ deletedTemplateName: 'Vecchio' })
    );
    expect(catalogoDellEvento({ templateId: MODELLO, templateName: 'Attuale' })).toEqual(
      campi({ templateId: MODELLO })
    );
  });
});

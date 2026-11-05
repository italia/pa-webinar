// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { z } from 'zod';

function senzaDefault(campo: z.ZodType): z.ZodType {
  if (campo instanceof z.ZodDefault)
    return senzaDefault(campo.removeDefault() as z.ZodType);
  if (campo instanceof z.ZodOptional || campo instanceof z.ZodNullable) {
    const interno = campo.unwrap() as z.ZodType;
    const pulito = senzaDefault(interno);
    if (pulito === interno) return campo;
    return campo instanceof z.ZodOptional ? pulito.optional() : pulito.nullable();
  }
  return campo;
}

/**
 * Lo schema di una modifica parziale, ricavato da quello di creazione: ogni
 * campo diventa facoltativo e perde il default.
 *
 * `.partial()` da solo non basta: zod applica il default anche ai campi resi
 * facoltativi, e una modifica riscriverebbe con i valori iniziali tutti i
 * campi che non ha mandato.
 */
export function parzialeSenzaDefault<
  S extends z.ZodRawShape,
  C extends z.core.$ZodObjectConfig,
>(schema: z.ZodObject<S, C>) {
  const parziale = schema.partial();
  const campi = Object.fromEntries(
    Object.entries(parziale.shape).map(([nome, campo]) => [
      nome,
      senzaDefault(campo as z.ZodType),
    ])
  );
  return parziale.extend(campi) as unknown as typeof parziale;
}

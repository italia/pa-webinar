// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { test, type APIRequestContext, type APIResponse } from '@playwright/test';

/**
 * Entra come amministratore. Il login ha un limite per indirizzo e la suite
 * gira da uno solo: a limite raggiunto si aspetta il tempo detto dal server,
 * invece di far fallire un test che con il login non c'entra.
 */
export async function accediComeAdmin(
  request: APIRequestContext,
  chiave: string
): Promise<APIResponse> {
  const accedi = () => request.post('/api/admin/login', { data: { key: chiave } });
  const risposta = await accedi();
  if (risposta.status() !== 429) return risposta;
  const secondi = Number(risposta.headers()['retry-after'] ?? 60) + 1;
  test.info().setTimeout(test.info().timeout + secondi * 1000);
  await new Promise((fine) => setTimeout(fine, secondi * 1000));
  return accedi();
}

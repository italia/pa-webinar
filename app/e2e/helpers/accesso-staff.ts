// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { randomUUID } from 'crypto';

import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

import { linkDallaCasella } from './casella';

/**
 * Un account nominale dello staff, usato come lo usa una persona: lo crea la
 * sessione della chiave dell'istanza, il link di accesso arriva per email e lo
 * si consuma come fa la pagina del link.
 *
 * Serve dove la chiave dell'istanza non basta: la sessione della chiave non ha
 * una persona dietro, e il contenuto di una registrazione e' di chi organizza
 * l'evento (ADR-021). Gli eventi creati con la sessione dell'account sono suoi.
 */
export interface AccountStaff {
  id: string;
  email: string;
}

/** Crea l'account, con la sessione della chiave dell'istanza che `admin` porta. */
export async function creaAccountStaff(
  admin: APIRequestContext,
  ruolo: 'ADMIN' | 'ORGANIZER'
): Promise<AccountStaff> {
  const email = `e2e-staff-${randomUUID()}@example.com`;
  const res = await admin.post('/api/admin/organizers', {
    data: { name: 'Staff E2E', email, role: ruolo, invite: true, locale: 'it' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { id, invited } = (await res.json()) as { id: string; invited: boolean };
  expect(invited, 'link di accesso non accodato').toBe(true);
  return { id, email };
}

/**
 * Entra con il link arrivato all'indirizzo dell'account: la sessione resta nei
 * cookie di `request`, al posto di quella che c'era.
 */
export async function accediConLink(
  request: APIRequestContext,
  account: AccountStaff
): Promise<APIResponse> {
  const link = await linkDallaCasella(request, account.email);
  const token = new URL(link).searchParams.get('t');
  expect(token, `link senza token: ${link}`).toBeTruthy();
  return request.post('/api/staff/login-link/verify', { data: { token } });
}

/**
 * Elimina l'account con la sessione della chiave dell'istanza. I suoi eventi
 * vanno eliminati prima: l'eliminazione dell'account cambia i loro link da
 * moderatore.
 */
export function eliminaAccountStaff(
  admin: APIRequestContext,
  account: AccountStaff
): Promise<APIResponse> {
  return admin.delete(`/api/admin/organizers/${account.id}`);
}

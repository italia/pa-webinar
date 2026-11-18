// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { expect, type APIRequestContext } from '@playwright/test';

const CRON_KEY = process.env.E2E_CRON_API_KEY || 'dev_cron_key_change_in_production';
const MAILPIT = process.env.E2E_MAILPIT_URL || 'http://localhost:8025';

/**
 * Il link dell'ultima email arrivata a `email` che porta il parametro `t`,
 * letto da Mailpit, la casella dello stack locale. La coda delle email si
 * svuota chiamando il lavoro pianificato invece di aspettarlo. Con `oggetto`
 * conta solo l'email il cui oggetto lo contiene.
 */
export async function linkDallaCasella(
  request: APIRequestContext,
  email: string,
  oggetto?: string
): Promise<string> {
  let link: string | null = null;
  await expect
    .poll(
      async () => {
        await request.get('/api/cron/email-outbox', {
          headers: { 'x-api-key': CRON_KEY },
        });
        const cerca = await request.get(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`
        );
        if (!cerca.ok()) return null;
        const { messages: arrivate } = (await cerca.json()) as {
          messages: Array<{ ID: string; Subject: string }>;
        };
        const cercata = arrivate.find((m) => !oggetto || m.Subject.includes(oggetto));
        if (!cercata) return null;
        const corpo = await request.get(`${MAILPIT}/api/v1/message/${cercata.ID}`);
        const { Text } = (await corpo.json()) as { Text: string };
        link = Text.match(/https?:\/\/\S+[?&]t=[^\s]+/)?.[0] ?? null;
        return link;
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 5_000] }
    )
    .not.toBeNull();
  return link!;
}

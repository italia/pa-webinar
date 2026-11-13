// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { getTranslations } from 'next-intl/server';

import { linguaEmail } from '@/lib/email/lingua';
import { localizedUrl } from '@/lib/utils/localized-url';

/**
 * Il link a «I miei dati» in un'email: l'indirizzo nella lingua della pagina,
 * il testo in quella dell'email.
 */
export async function linkIMieiDati(
  baseUrl: string,
  locale: string
): Promise<{ url: string; label: string }> {
  const t = await getTranslations({ locale: linguaEmail(locale), namespace: 'email' });
  return {
    url: localizedUrl(baseUrl, '/privacy/my-data', locale),
    label: t('myDataLink'),
  };
}

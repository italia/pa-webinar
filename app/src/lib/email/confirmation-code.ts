// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * L'email con il codice che conferma una modifica a un'iscrizione dalla pagina
 * dei propri dati (lib/gdpr/confirmation-code): correggere nome ed ente, o
 * cancellare l'iscrizione.
 *
 * Il codice sta solo nel corpo, che l'outbox salva cifrato: l'oggetto resta in
 * chiaro e non lo porta. Nessun link: il codice si scrive nella pagina da cui e'
 * partita la richiesta, e un filtro della posta che apre i link non conferma
 * niente. I testi sono nella lingua email della pagina (EMAIL_LOCALES, ripiego
 * inglese). I metadati portano l'iscrizione, cosi' la sua cancellazione toglie
 * anche questa email dall'outbox.
 */
import { getTranslations } from 'next-intl/server';

import { linguaEmail } from '@/lib/email/lingua';
import { enqueueEmail } from '@/lib/email/outbox';
import { escapeHtml, layout } from '@/lib/email/templates';
import type { AzioneConfermata } from '@/lib/gdpr/confirmation-code';

export interface CodiceDaInviare {
  to: string;
  /** La lingua della pagina da cui arriva la richiesta. */
  locale: string;
  azione: AzioneConfermata;
  /** Per una correzione: una sola iscrizione o tutte quelle dell'indirizzo. */
  tutte?: boolean;
  eventTitle: string;
  codice: string;
  minuti: number;
  registrationId: string;
  siteName: string;
}

export async function inviaCodiceDiConferma(input: CodiceDaInviare): Promise<void> {
  const lingua = linguaEmail(input.locale);
  const t = await getTranslations({
    locale: lingua,
    namespace: 'email.confirmationCode',
  });
  const intro =
    input.azione === 'cancel'
      ? t('introCancel', { event: input.eventTitle })
      : input.tutte
        ? t('introEditAll')
        : t('introEdit', { event: input.eventTitle });
  const istruzioni = t('instructions', { minutes: input.minuti });
  const body = `
<p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
<p style="margin:0 0 8px;">${escapeHtml(t('codeLabel'))}</p>
<p style="margin:0 0 16px;font-size:28px;font-weight:700;letter-spacing:6px;color:#17324d;">${escapeHtml(input.codice)}</p>
<p style="margin:0 0 16px;">${escapeHtml(istruzioni)}</p>
<p style="margin:0;color:#516B7E;font-size:14px;">${escapeHtml(t('ignore'))}</p>`;
  const html = layout(escapeHtml(t('heading')), body, '', lingua, input.siteName);
  const text = [
    t('heading'),
    '',
    intro,
    '',
    `${t('codeLabel')} ${input.codice}`,
    '',
    istruzioni,
    '',
    t('ignore'),
  ].join('\n');
  await enqueueEmail({
    to: input.to,
    subject: t('subject', { site: input.siteName }),
    html,
    text,
    metadata: {
      kind: 'gdpr-confirmation-code',
      action: input.azione,
      registrationId: input.registrationId,
    },
  });
}

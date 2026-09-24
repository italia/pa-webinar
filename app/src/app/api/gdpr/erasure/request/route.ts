/**
 * POST /api/gdpr/erasure/request
 *
 * Step 1 of the GDPR Art. 17 (right to erasure) flow. The caller
 * submits an email; we email a signed, short-lived (1h) token to that
 * address. Only the mailbox holder can complete the erasure by clicking
 * the link.
 *
 * Always responds 200 to avoid leaking which addresses are registered.
 */

import { defaultLocale } from '@/i18n/config';
import { linguaEmail, linguaPagina } from '@/lib/email/lingua';
import { localizedUrl } from '@/lib/utils/localized-url';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { RateLimitError, ValidationError } from '@/lib/errors';
import { hashEmail } from '@/lib/crypto/pii';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { enqueueEmail } from '@/lib/email/outbox';
import { escapeHtml } from '@/lib/email/templates';
import { issueGdprToken } from '@/lib/gdpr/request-token';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  email: z.string().email(),
  locale: z.string().min(2).max(5).optional(),
});

function buildErasureLink(baseUrl: string, locale: string, token: string): string {
  // Dalla mappa dei percorsi, come ogni altro link nelle email: la pagina
  // esiste nella lingua di chi ha chiesto, con il suo indirizzo localizzato.
  return localizedUrl(baseUrl, `/privacy/my-data/erasure?t=${encodeURIComponent(token)}`, locale);
}

const SUBJECTS: Record<string, string> = {
  it: 'Cancellazione dei tuoi dati personali',
  en: 'Erasure of your personal data',
  fr: 'Effacement de vos données personnelles',
  de: 'Löschung Ihrer personenbezogenen Daten',
  es: 'Supresión de sus datos personales',
};

const BODIES: Record<string, (link: string) => { html: string; text: string }> = {
  it: (link) => ({
    html:
      `<p>Hai richiesto la cancellazione dei tuoi dati personali ` +
      `(GDPR Art. 17). Conferma l'operazione cliccando entro un'ora ` +
      `il link qui sotto:</p>` +
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` +
      `<p>L'operazione è irreversibile. Se non hai effettuato tu la ` +
      `richiesta, puoi ignorare questa email.</p>`,
    text:
      `Hai richiesto la cancellazione dei tuoi dati personali ` +
      `(GDPR Art. 17). Conferma cliccando entro un'ora il link qui ` +
      `sotto:\n\n${link}\n\n` +
      `L'operazione è irreversibile. Se non hai effettuato tu la ` +
      `richiesta, puoi ignorare questa email.`,
  }),
  en: (link) => ({
    html:
      `<p>You requested the erasure of your personal data ` +
      `(GDPR Art. 17). Confirm by opening the link below within one ` +
      `hour:</p>` +
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` +
      `<p>This action is irreversible. If you did not make this ` +
      `request, you can ignore this email.</p>`,
    text:
      `You requested the erasure of your personal data ` +
      `(GDPR Art. 17). Confirm by opening this link within one ` +
      `hour:\n\n${link}\n\n` +
      `This action is irreversible. If you did not make this ` +
      `request, you can ignore this email.`,
  }),
  fr: (link) => ({
    html:
      `<p>Vous avez demandé l’effacement de vos données personnelles ` +
      `(RGPD, art. 17). Confirmez l’opération en cliquant dans un délai ` +
      `d’une heure sur le lien ci-dessous :</p>` +
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` +
      `<p>Cette opération est irréversible. Si vous n’êtes pas à l’origine ` +
      `de cette demande, vous pouvez ignorer cet e-mail.</p>`,
    text:
      `Vous avez demandé l’effacement de vos données personnelles ` +
      `(RGPD, art. 17). Confirmez en ouvrant dans un délai d’une heure ` +
      `le lien ci-dessous :\n\n${link}\n\n` +
      `Cette opération est irréversible. Si vous n’êtes pas à l’origine ` +
      `de cette demande, vous pouvez ignorer cet e-mail.`,
  }),
  de: (link) => ({
    html:
      `<p>Sie haben die Löschung Ihrer personenbezogenen Daten beantragt ` +
      `(DSGVO, Art. 17). Bestätigen Sie den Vorgang, indem Sie innerhalb ` +
      `einer Stunde auf den folgenden Link klicken:</p>` +
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` +
      `<p>Der Vorgang kann nicht rückgängig gemacht werden. Falls Sie diese ` +
      `Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.</p>`,
    text:
      `Sie haben die Löschung Ihrer personenbezogenen Daten beantragt ` +
      `(DSGVO, Art. 17). Bestätigen Sie, indem Sie innerhalb einer Stunde ` +
      `den folgenden Link öffnen:\n\n${link}\n\n` +
      `Der Vorgang kann nicht rückgängig gemacht werden. Falls Sie diese ` +
      `Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.`,
  }),
  es: (link) => ({
    html:
      `<p>Ha solicitado la supresión de sus datos personales ` +
      `(RGPD, art. 17). Confirme la operación haciendo clic en el plazo ` +
      `de una hora en el enlace que figura a continuación:</p>` +
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` +
      `<p>La operación es irreversible. Si no ha realizado usted esta ` +
      `solicitud, puede ignorar este correo electrónico.</p>`,
    text:
      `Ha solicitado la supresión de sus datos personales ` +
      `(RGPD, art. 17). Confirme abriendo en el plazo de una hora el ` +
      `enlace que figura a continuación:\n\n${link}\n\n` +
      `La operación es irreversible. Si no ha realizado usted esta ` +
      `solicitud, puede ignorar este correo electrónico.`,
  }),
};

export const POST = withErrorHandling(async (request) => {
  const ip = getClientIp(request);
  const ipRl = rateLimit(`gdpr-erasure-req-ip:${ip}`, {
    limit: 5,
    windowMs: 3_600_000,
  });
  if (!ipRl.allowed) {
    throw new RateLimitError((ipRl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues);
  }
  const email = parsed.data.email.trim();
  // La lingua della pagina da cui arriva la richiesta, se e' una lingua della
  // piattaforma; i testi nella lingua email corrispondente (fallback inglese).
  const locale = linguaPagina(parsed.data.locale) ?? defaultLocale;
  const testi = linguaEmail(locale);

  const emailHash = hashEmail(email);
  const emailRl = rateLimit(`gdpr-erasure-req-email:${emailHash}`, {
    limit: 3,
    windowMs: 3_600_000,
  });

  if (emailRl.allowed) {
    const token = issueGdprToken('erasure', emailHash);
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ??
      'http://localhost:3000';
    const link = buildErasureLink(baseUrl, locale, token);

    const body = BODIES[testi] ?? BODIES.en!;
    const subject = SUBJECTS[testi] ?? SUBJECTS.en!;
    const { html, text } = body(link);

    await enqueueEmail({
      to: email,
      subject,
      html,
      text,
      metadata: { kind: 'gdpr-erasure-request' },
    });
  }

  return Response.json({ ok: true });
});

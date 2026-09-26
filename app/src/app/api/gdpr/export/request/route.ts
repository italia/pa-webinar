/**
 * POST /api/gdpr/export/request
 *
 * Step 1 of the GDPR Art. 15 (right of access) flow. The caller submits
 * an email; we email a signed, short-lived (1h) token to that address.
 * The caller then uses the link to fulfil the request — only the legit
 * mailbox holder ever sees the data.
 *
 * Always responds 200 to avoid leaking which addresses are registered.
 */

import { defaultLocale } from '@/i18n/config';
import { linguaEmail, linguaPagina } from '@/lib/email/lingua';
import { emailBaseUrl } from '@/lib/email/links';
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

function buildExportLink(baseUrl: string, locale: string, token: string): string {
  // Dalla mappa dei percorsi, come ogni altro link nelle email: la pagina
  // esiste nella lingua di chi ha chiesto, con il suo indirizzo localizzato.
  return localizedUrl(baseUrl, `/privacy/my-data?t=${encodeURIComponent(token)}`, locale);
}

const SUBJECTS: Record<string, string> = {
  it: 'Esportazione dei tuoi dati personali',
  en: 'Your personal-data export',
  fr: 'Exportation de vos données personnelles',
  de: 'Export Ihrer personenbezogenen Daten',
  es: 'Exportación de sus datos personales',
};

const BODIES: Record<string, (link: string) => { html: string; text: string }> = {
  it: (link) => ({
    html:
      `<p>Hai richiesto una copia dei tuoi dati personali. ` +
      `Clicca il link qui sotto entro un'ora per scaricarli:</p>` +
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` +
      `<p>Se non hai effettuato tu la richiesta, puoi ignorare questa email.</p>`,
    text:
      `Hai richiesto una copia dei tuoi dati personali. ` +
      `Apri questo link entro un'ora per scaricarli:\n\n${link}\n\n` +
      `Se non hai effettuato tu la richiesta, puoi ignorare questa email.`,
  }),
  en: (link) => ({
    html:
      `<p>You requested a copy of your personal data. ` +
      `Click the link below within one hour to download it:</p>` +
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` +
      `<p>If you did not make this request, you can ignore this email.</p>`,
    text:
      `You requested a copy of your personal data. ` +
      `Open this link within one hour to download it:\n\n${link}\n\n` +
      `If you did not make this request, you can ignore this email.`,
  }),
  fr: (link) => ({
    html:
      `<p>Vous avez demandé une copie de vos données personnelles. ` +
      `Cliquez sur le lien ci-dessous dans un délai d’une heure pour les télécharger :</p>` +
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` +
      `<p>Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail.</p>`,
    text:
      `Vous avez demandé une copie de vos données personnelles. ` +
      `Ouvrez ce lien dans un délai d’une heure pour les télécharger :\n\n${link}\n\n` +
      `Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail.`,
  }),
  de: (link) => ({
    html:
      `<p>Sie haben eine Kopie Ihrer personenbezogenen Daten angefordert. ` +
      `Klicken Sie innerhalb einer Stunde auf den folgenden Link, um sie herunterzuladen:</p>` +
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` +
      `<p>Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.</p>`,
    text:
      `Sie haben eine Kopie Ihrer personenbezogenen Daten angefordert. ` +
      `Öffnen Sie diesen Link innerhalb einer Stunde, um sie herunterzuladen:\n\n${link}\n\n` +
      `Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.`,
  }),
  es: (link) => ({
    html:
      `<p>Ha solicitado una copia de sus datos personales. ` +
      `Haga clic en el enlace que figura a continuación en el plazo de una hora para descargarlos:</p>` +
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` +
      `<p>Si no ha realizado usted esta solicitud, puede ignorar este correo electrónico.</p>`,
    text:
      `Ha solicitado una copia de sus datos personales. ` +
      `Abra este enlace en el plazo de una hora para descargarlos:\n\n${link}\n\n` +
      `Si no ha realizado usted esta solicitud, puede ignorar este correo electrónico.`,
  }),
};

export const POST = withErrorHandling(async (request) => {
  // Two rate-limit buckets:
  //   1) per IP — stop a single host from carpet-bombing the form
  //   2) per email-hash — stop spamming a single inbox
  // Both fire silently (we still return 200) when exceeded so an attacker
  // can't probe registration status by reading status codes.
  const ip = getClientIp(request);
  const ipRl = rateLimit(`gdpr-export-req-ip:${ip}`, {
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
  const emailRl = rateLimit(`gdpr-export-req-email:${emailHash}`, {
    limit: 3,
    windowMs: 3_600_000,
  });

  // Silently drop further sends to the same mailbox; still return 200.
  if (emailRl.allowed) {
    const token = issueGdprToken('export', emailHash);
    // A runtime: la lettura puntata la fissava il build, e l'email portava
    // `http://localhost:3000` su ogni istanza installata dall'immagine pubblicata.
    const link = buildExportLink(emailBaseUrl(), locale, token);

    const body =
      BODIES[testi] ?? BODIES.en!;
    const subject = SUBJECTS[testi] ?? SUBJECTS.en!;
    const { html, text } = body(link);

    await enqueueEmail({
      to: email,
      subject,
      html,
      text,
      metadata: { kind: 'gdpr-export-request' },
    });
  }

  return Response.json({ ok: true });
});

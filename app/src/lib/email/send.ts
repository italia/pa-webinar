/**
 * Email sending utility.
 * Uses Nodemailer with configurable SMTP transport.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import { getSettings } from '@/lib/settings';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    // Pool reuses the same SMTP connection across sends — the handshake
    // (TCP + TLS + LOGIN) happens once per pod, not once per email.
    // Without this, sequential sends against an upstream provider can
    // take 2-5s each on cold connections.
    pool: true,
    maxConnections: Number(process.env.SMTP_POOL_MAX_CONNECTIONS ?? 5),
    maxMessages: Number(process.env.SMTP_POOL_MAX_MESSAGES ?? 100),
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          }
        : undefined,
  });

  return transporter;
}

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: string;
    contentType: string;
  }>;
}

/**
 * Send an email via the configured SMTP transport.
 *
 * The display name comes from the admin panel (`SiteSetting.emailFromName`) and
 * falls back to SMTP_FROM_NAME, then to the site name: an instance that never
 * sets it behaves exactly as before. The ADDRESS stays environment-only —
 * the relay authorises a specific sender, so letting an operator type one in
 * would silently break delivery (SPF/DKIM) rather than rebrand anything.
 *
 * Reply-To is set when configured: From is a no-reply mailbox, so without it a
 * reply from an attendee is simply lost.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const transport = getTransporter();

  let fromName = process.env.SMTP_FROM_NAME ?? 'PA Webinar';
  let replyTo: string | undefined;
  try {
    const settings = await getSettings();
    const configured = settings.emailFromName?.trim();
    if (configured) fromName = configured;
    else if (settings.siteName?.trim() && !process.env.SMTP_FROM_NAME) {
      fromName = settings.siteName.trim();
    }
    replyTo = settings.emailReplyTo?.trim() || undefined;
  } catch {
    // Settings unreachable (DB blip): fall back to the env, never block a send.
  }

  await transport.sendMail({
    // A display name containing `"` would break the quoted string and could
    // inject header syntax — strip the quote characters and CR/LF outright.
    from: `"${fromName.replace(/["\r\n]/g, '')}" <${process.env.SMTP_FROM ?? 'noreply@dominio.gov.it'}>`,
    to: input.to,
    ...(replyTo ? { replyTo } : {}),
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments,
  });
}

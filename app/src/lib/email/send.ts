/**
 * Email sending utility.
 * Uses Nodemailer with configurable SMTP transport.
 */

import nodemailer from 'nodemailer';
import type { SendMailOptions, Transporter } from 'nodemailer';

import type { EmailAttachment, EmailCalendarInvite } from '@/lib/email/outbox';
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

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  calendarInvite?: EmailCalendarInvite;
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
export async function resolveSender(): Promise<{ fromName: string; replyTo?: string }> {
  // Env is the deployment default; the admin field, when set, wins. Precedence
  // is deliberately NOT "fall back to siteName": every documented deployment
  // sets SMTP_FROM_NAME, so preferring siteName would silently rename the
  // sender of an existing instance on upgrade. The admin help text says exactly
  // this, so the UI and the behaviour agree.
  const envName = process.env.SMTP_FROM_NAME?.trim();
  try {
    const settings = await getSettings();
    const configured = settings.emailFromName?.trim();
    return {
      fromName: configured || envName || settings.siteName?.trim() || 'PA Webinar',
      replyTo: settings.emailReplyTo?.trim() || undefined,
    };
  } catch (err) {
    // Settings unreachable (DB blip): fall back to the env rather than block a
    // send — but say so, otherwise a persistently failing lookup silently keeps
    // every instance on the deployment default.
    console.warn('[email] site settings unavailable, using SMTP_FROM_NAME:', err);
    return { fromName: envName || 'PA Webinar' };
  }
}

/**
 * Le opzioni nodemailer del messaggio. Separata dall'invio per poter comporre
 * il MIME vero nei test.
 *
 * L'invito di calendario va in `icalEvent`: nodemailer lo mette sia come
 * parte alternativa `text/calendar; method=REQUEST` accanto a testo e HTML,
 * sia come allegato `invite.ics`. La parte alternativa e' quella che fa
 * comparire in Gmail e Outlook la scheda dell'invito; l'allegato serve ai
 * client che non la leggono.
 */
export function mailOptions(
  input: SendEmailInput,
  sender: { fromName: string; replyTo?: string },
): SendMailOptions {
  return {
    // Object form on purpose: nodemailer quotes and encodes the display name
    // itself. Hand-building `"name" <addr>` meant sanitising by hand, and a
    // sanitiser that strips `"` but not `\` still lets a name ending in a
    // backslash escape the closing quote — the quoted string never terminates
    // and EVERY outgoing message gets a broken From.
    from: { name: sender.fromName, address: process.env.SMTP_FROM ?? 'noreply@dominio.gov.it' },
    to: input.to,
    ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments,
    ...(input.calendarInvite
      ? {
          icalEvent: {
            method: input.calendarInvite.method,
            filename: 'invite.ics',
            content: input.calendarInvite.content,
          },
        }
      : {}),
  };
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const transport = getTransporter();
  await transport.sendMail(mailOptions(input, await resolveSender()));
}

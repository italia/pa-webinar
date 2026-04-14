/**
 * Email sending utility.
 * Uses Nodemailer with configurable SMTP transport.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
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
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const transport = getTransporter();

  await transport.sendMail({
    from: `"${process.env.SMTP_FROM_NAME ?? 'Eventi PA'}" <${process.env.SMTP_FROM ?? 'noreply@dominio.gov.it'}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments,
  });
}

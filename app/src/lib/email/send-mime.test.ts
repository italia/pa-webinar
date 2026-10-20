// @vitest-environment node
import nodemailer from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';

/**
 * Il messaggio vero, composto da nodemailer come per l'invio: Gmail e Outlook
 * mostrano la scheda dell'invito solo se il calendario e' una parte
 * alternativa `text/calendar; method=REQUEST` accanto a testo e HTML.
 */
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn() }));

import { mailOptions } from './send';

async function compose(withInvite: boolean): Promise<string> {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const info = await transport.sendMail(
    mailOptions(
      {
        to: 'persona@example.org',
        subject: 'Invito',
        html: '<p>Ciao</p>',
        text: 'Ciao',
        ...(withInvite
          ? {
              calendarInvite: {
                method: 'REQUEST' as const,
                content:
                  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n',
              },
            }
          : {}),
      },
      { fromName: 'Portale' }
    )
  );
  return (info.message as Buffer).toString('utf8');
}

describe('mailOptions → MIME', () => {
  it('con l’invito: alternativa text/calendar method=REQUEST e allegato invite.ics', async () => {
    const raw = await compose(true);
    expect(raw).toMatch(/Content-Type: multipart\/mixed;/);
    expect(raw).toMatch(/Content-Type: multipart\/alternative;/);
    expect(raw).toMatch(/Content-Type: text\/plain; charset=utf-8/);
    expect(raw).toMatch(/Content-Type: text\/html; charset=utf-8/);
    expect(raw).toMatch(/Content-Type: text\/calendar; charset=utf-8; method=REQUEST/);
    expect(raw).toMatch(/Content-Type: application\/ics; name=invite\.ics/);
    expect(raw).toMatch(/Content-Disposition: attachment; filename=invite\.ics/);
    // La parte calendario sta dentro l'alternativa, dopo l'HTML.
    const alt = raw.slice(raw.indexOf('multipart/alternative'));
    expect(alt.indexOf('text/calendar')).toBeGreaterThan(alt.indexOf('text/html'));
  });

  it('senza invito: nessuna parte di calendario', async () => {
    const raw = await compose(false);
    expect(raw).not.toContain('text/calendar');
    expect(raw).not.toContain('invite.ics');
  });
});

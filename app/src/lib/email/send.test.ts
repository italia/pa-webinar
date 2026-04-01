import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock nodemailer before importing sendEmail
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
}));

// Must import after mock setup
const { sendEmail } = await import('./send');

beforeEach(() => {
  mockSendMail.mockClear();
  process.env.SMTP_HOST = 'localhost';
  process.env.SMTP_PORT = '1025';
  process.env.SMTP_FROM = 'test@dominio.gov.it';
  process.env.SMTP_FROM_NAME = 'Eventi Test';
});

describe('sendEmail', () => {
  it('calls sendMail with correct to, subject, html', async () => {
    await sendEmail({
      to: 'user@example.com',
      subject: 'Conferma registrazione',
      html: '<p>Benvenuto!</p>',
    });

    expect(mockSendMail).toHaveBeenCalledOnce();
    const call = mockSendMail.mock.calls[0]![0];
    expect(call.to).toBe('user@example.com');
    expect(call.subject).toBe('Conferma registrazione');
    expect(call.html).toBe('<p>Benvenuto!</p>');
  });

  it('includes from with name', async () => {
    await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    });

    const call = mockSendMail.mock.calls[0]![0];
    expect(call.from).toContain('Eventi Test');
    expect(call.from).toContain('test@dominio.gov.it');
  });

  it('passes text body when provided', async () => {
    await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>HTML</p>',
      text: 'Plain text',
    });

    const call = mockSendMail.mock.calls[0]![0];
    expect(call.text).toBe('Plain text');
  });

  it('passes attachments when provided', async () => {
    await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>HTML</p>',
      attachments: [
        {
          filename: 'event.ics',
          content: 'BEGIN:VCALENDAR...',
          contentType: 'text/calendar',
        },
      ],
    });

    const call = mockSendMail.mock.calls[0]![0];
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0].filename).toBe('event.ics');
  });

  it('throws when sendMail fails', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));
    await expect(
      sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      }),
    ).rejects.toThrow('SMTP connection refused');
  });
});

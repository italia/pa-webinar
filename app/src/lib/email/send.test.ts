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

// The sender name and Reply-To now come from SiteSetting. Mocked so this stays
// a transport unit test instead of dragging Prisma in; each test sets what it
// needs via `mockSettings`.
const mockSettings = vi.fn();
vi.mock('@/lib/settings', () => ({
  getSettings: () => mockSettings(),
}));

// Must import after mock setup
const { sendEmail } = await import('./send');

beforeEach(() => {
  mockSendMail.mockClear();
  process.env.SMTP_HOST = 'localhost';
  process.env.SMTP_PORT = '1025';
  process.env.SMTP_FROM = 'test@dominio.gov.it';
  process.env.SMTP_FROM_NAME = 'Eventi Test';
  mockSettings.mockResolvedValue({ siteName: 'PA Webinar', emailFromName: null, emailReplyTo: null });
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

    // Object form: nodemailer does the quoting, so a display name can never
    // break out of the header (a name ending in `\` used to unterminate the
    // hand-built quoted string and corrupt the From of every message).
    const call = mockSendMail.mock.calls[0]![0];
    expect(call.from).toEqual({ name: 'Eventi Test', address: 'test@dominio.gov.it' });
  });

  it('lets the admin-configured sender name win over the environment', async () => {
    mockSettings.mockResolvedValue({
      siteName: 'PA Webinar',
      emailFromName: 'Comune di Verifica',
      emailReplyTo: null,
    });
    await sendEmail({ to: 'u@example.com', subject: 'T', html: '<p>T</p>' });
    expect(mockSendMail.mock.calls[0]![0].from.name).toBe('Comune di Verifica');
  });

  it('keeps the deployment name when the admin field is blank', async () => {
    mockSettings.mockResolvedValue({ siteName: 'Comune di X', emailFromName: '   ', emailReplyTo: null });
    // NOT siteName: every documented deployment sets SMTP_FROM_NAME, and
    // preferring siteName would silently rename an existing instance's sender.
    await sendEmail({ to: 'u@example.com', subject: 'T', html: '<p>T</p>' });
    expect(mockSendMail.mock.calls[0]![0].from.name).toBe('Eventi Test');
  });

  it('falls back to the site name when the deployment sets no name', async () => {
    delete process.env.SMTP_FROM_NAME;
    mockSettings.mockResolvedValue({ siteName: 'Comune di X', emailFromName: null, emailReplyTo: null });
    await sendEmail({ to: 'u@example.com', subject: 'T', html: '<p>T</p>' });
    expect(mockSendMail.mock.calls[0]![0].from.name).toBe('Comune di X');
  });

  it('sets Reply-To when configured, and omits it otherwise', async () => {
    mockSettings.mockResolvedValue({
      siteName: 'PA Webinar',
      emailFromName: null,
      emailReplyTo: 'eventi@comune.it',
    });
    await sendEmail({ to: 'u@example.com', subject: 'T', html: '<p>T</p>' });
    expect(mockSendMail.mock.calls[0]![0].replyTo).toBe('eventi@comune.it');

    mockSendMail.mockClear();
    mockSettings.mockResolvedValue({ siteName: 'PA Webinar', emailFromName: null, emailReplyTo: '  ' });
    await sendEmail({ to: 'u@example.com', subject: 'T', html: '<p>T</p>' });
    expect(mockSendMail.mock.calls[0]![0]).not.toHaveProperty('replyTo');
  });

  it('still sends when the settings lookup fails', async () => {
    mockSettings.mockRejectedValue(new Error('db down'));
    await sendEmail({ to: 'u@example.com', subject: 'T', html: '<p>T</p>' });
    expect(mockSendMail).toHaveBeenCalledOnce();
    expect(mockSendMail.mock.calls[0]![0].from.name).toBe('Eventi Test');
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

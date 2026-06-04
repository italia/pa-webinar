/**
 * Next.js instrumentation hook — runs once at server startup.
 * Used to validate that required environment variables are present.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

const MIN_APP_SECRET_BYTES = 32;

export function register() {
  const required = [
    'APP_SECRET',
    'DATABASE_URL',
    'JITSI_JWT_SECRET',
    'NEXT_PUBLIC_JITSI_DOMAIN',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      `[pa-webinar] Missing required environment variables: ${missing.join(', ')}. ` +
        'The application may not function correctly.',
    );
  }

  const appSecret = process.env.APP_SECRET;
  if (appSecret && appSecret.length < MIN_APP_SECRET_BYTES) {
    const msg =
      `[pa-webinar] APP_SECRET is too short (${appSecret.length} bytes, ` +
      `minimum ${MIN_APP_SECRET_BYTES}). Short HS256 keys are brute-forceable.`;
    if (process.env.NODE_ENV === 'production') {
      // Fatal in production — refuse to start with a weak signing key.
      throw new Error(msg);
    }
    console.warn(msg + ' Allowed in non-production only.');
  }

  const recommended = ['CRON_API_KEY', 'ADMIN_API_KEY', 'SMTP_HOST'];
  const missingRecommended = recommended.filter((key) => !process.env[key]);

  if (missingRecommended.length > 0) {
    console.warn(
      `[pa-webinar] Missing recommended environment variables: ${missingRecommended.join(', ')}.`,
    );
  }
}

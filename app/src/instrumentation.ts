/**
 * Next.js instrumentation hook — runs once at server startup.
 * Used to validate that required environment variables are present.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
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
      `[eventi-dtd] Missing required environment variables: ${missing.join(', ')}. ` +
        'The application may not function correctly.',
    );
  }

  const recommended = ['CRON_API_KEY', 'ADMIN_API_KEY', 'SMTP_HOST'];
  const missingRecommended = recommended.filter((key) => !process.env[key]);

  if (missingRecommended.length > 0) {
    console.warn(
      `[eventi-dtd] Missing recommended environment variables: ${missingRecommended.join(', ')}.`,
    );
  }
}

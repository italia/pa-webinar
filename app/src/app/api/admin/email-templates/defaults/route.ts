/**
 * Returns the built-in default copy for each (key, locale) so the admin UI
 * can render the hardcoded strings as placeholders — without duplicating
 * them on the client.
 */
import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { UnauthorizedError } from '@/lib/errors';
import {
  baseConfirmationCopy,
  baseReminderCopy,
} from '@/lib/email/templates';

export const dynamic = 'force-dynamic';

type Locale = 'it' | 'en';

const LOCALES: Locale[] = ['it', 'en'];

// Sample input used to render defaults — placeholders are shown literally
// so admins understand which tokens they can use.
const SAMPLE_INPUT = {
  eventTitle: '{{eventTitle}}',
  eventDate: '{{eventDate}}',
  eventTime: '{{eventTime}}',
  eventDuration: '{{eventDuration}}',
  joinUrl: '{{joinUrl}}',
  eventPageUrl: '{{eventPageUrl}}',
  offsetMinutes: 60,
} as const;

export const GET = withErrorHandling(async () => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const confirmation: Record<Locale, unknown> = { it: null, en: null };
  const reminder: Record<Locale, unknown> = { it: null, en: null };
  for (const locale of LOCALES) {
    confirmation[locale] = baseConfirmationCopy({ locale, ...SAMPLE_INPUT });
    reminder[locale] = baseReminderCopy({ locale, ...SAMPLE_INPUT });
  }
  const defaults = { confirmation, reminder };

  return Response.json(
    { defaults },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

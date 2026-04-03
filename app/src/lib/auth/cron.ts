import { UnauthorizedError } from '@/lib/errors';

import { constantTimeEqual } from './moderator';

/**
 * Cron endpoints are authenticated with a shared secret passed via x-api-key.
 * We keep the contract centralized so routes and infrastructure stay aligned.
 */
export function assertCronApiKey(request: Request): void {
  const apiKey = process.env.CRON_API_KEY;
  const providedKey = request.headers.get('x-api-key') ?? '';

  if (!apiKey || !constantTimeEqual(providedKey, apiKey)) {
    throw new UnauthorizedError();
  }
}

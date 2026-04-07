import { cookies } from 'next/headers';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { withErrorHandling } from '@/lib/api-handler';
import { UnauthorizedError } from '@/lib/errors';
import { getInfrastructureInfo } from '@/lib/infrastructure';

export const GET = withErrorHandling(async () => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    throw new UnauthorizedError();
  }

  const info = await getInfrastructureInfo();

  return Response.json(info, {
    headers: { 'Cache-Control': 'private, s-maxage=60' },
  });
});

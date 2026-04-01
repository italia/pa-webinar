import { withErrorHandling } from '@/lib/api-handler';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Health check endpoint for Kubernetes liveness/readiness probes.
 * GET /api/health
 */
export const GET = withErrorHandling(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    throw new AppError('Database unreachable', 503, 'SERVICE_UNAVAILABLE');
  }

  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.1.0',
  });
});

import { withErrorHandling } from '@/lib/api-handler';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';

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

  // La versione arriva dall'immagine, non da npm: `npm_package_version` esiste
  // solo se il processo è stato avviato da uno script npm, e il container avvia
  // il server direttamente. In produzione questa risposta dichiarava quindi un
  // numero fisso, identico per ogni versione mai rilasciata — e chi controlla
  // cosa gira non aveva modo di accorgersene. Si legge a runtime, come vuole
  // l'immagine unica multi-ambiente.
  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: getPublicEnv('NEXT_PUBLIC_BUILD_VERSION'),
    commit: getPublicEnv('NEXT_PUBLIC_BUILD_SHA'),
    builtAt: getPublicEnv('NEXT_PUBLIC_BUILD_DATE'),
  });
});

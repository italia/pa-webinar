import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Readiness probe for Kubernetes.
 * Unlike /api/health (liveness), this validates schema compatibility
 * by running ORM queries that touch all columns on critical tables.
 * If a column is missing (P2022), the probe fails → K8s removes the
 * pod from Service endpoints → no 500s served to users.
 */
export async function GET() {
  try {
    await Promise.all([
      prisma.siteSetting.findFirst(),
      prisma.event.findFirst({ take: 1, orderBy: { createdAt: 'desc' } }),
    ]);

    return Response.json({ status: 'ready' }, { status: 200 });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Schema validation failed';
    console.error('[readiness] Schema check failed:', message);

    return Response.json(
      { status: 'not_ready', error: message },
      { status: 503 },
    );
  }
}

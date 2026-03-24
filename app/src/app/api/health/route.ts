import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Health check endpoint for Kubernetes liveness/readiness probes.
 * GET /api/health
 */
export async function GET() {
  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version ?? '0.1.0',
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}

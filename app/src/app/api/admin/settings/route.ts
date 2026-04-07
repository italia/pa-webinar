import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { prisma } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { invalidateSettingsCache } from '@/lib/settings';

export async function GET() {
  const settings = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
  });

  if (!settings) {
    const created = await prisma.siteSetting.create({
      data: { id: 'singleton' },
    });
    return NextResponse.json(created, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  }

  return NextResponse.json(settings, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}

export async function PUT(request: NextRequest) {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  // Remove fields that shouldn't be updated directly
  delete body.id;
  delete body.updatedAt;

  const updated = await prisma.siteSetting.update({
    where: { id: 'singleton' },
    data: body,
  });

  invalidateSettingsCache();

  return NextResponse.json(updated);
}

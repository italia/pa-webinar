import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { getInfrastructureInfo } from '@/lib/infrastructure';

export async function GET() {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const info = await getInfrastructureInfo();

  return NextResponse.json(info, {
    headers: { 'Cache-Control': 'private, s-maxage=60' },
  });
}

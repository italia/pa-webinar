import { NextResponse } from 'next/server';

import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string; id: string }>;
}

// ── DELETE /api/events/[slug]/reminders/[id] ─────────────
// Moderator only

export async function DELETE(request: Request, context: RouteContext) {
  const { param: slug, id } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Moderator token required' }, { status: 401 });
  }

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !constantTimeEqual(event.moderatorToken, token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const reminder = await prisma.eventReminder.findUnique({ where: { id } });
  if (!reminder || reminder.eventId !== event.id) {
    return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
  }

  // Delete sent records first (cascade should handle it, but be explicit)
  await prisma.eventReminder.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

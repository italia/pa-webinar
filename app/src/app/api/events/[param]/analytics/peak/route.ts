import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';

const peakSchema = z.object({
  count: z.number().int().min(0),
  moderatorToken: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ param: string }> },
) {
  const { param: slugOrId } = await params;

  const body = await request.json();
  const parsed = peakSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { count, moderatorToken } = parsed.data;

  const event = await prisma.event.findFirst({
    where: {
      OR: [{ slug: slugOrId }, { id: slugOrId }],
      moderatorToken,
      status: 'LIVE',
    },
    select: { id: true, peakParticipants: true },
  });

  if (!event) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (count > event.peakParticipants) {
    await prisma.event.update({
      where: { id: event.id },
      data: { peakParticipants: count },
    });
  }

  return NextResponse.json({ ok: true });
}

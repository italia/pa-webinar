import { prisma } from './db';

export interface AnalyticsOverview {
  totalEvents: number;
  totalRegistrations: number;
  totalParticipants: number;
  totalQuestions: number;
  totalPollVotes: number;
  averageParticipantsPerEvent: number;
  averageConversionRate: number;
  averageDurationMinutes: number;
  averageFeedbackRating: number;
  totalFeedback: number;
}

export interface AnalyticsTimeline {
  date: string;
  events: number;
  registrations: number;
  participants: number;
}

export interface EventAnalytics {
  eventId: string;
  title: string;
  date: string;
  registrations: number;
  participants: number;
  peakParticipants: number;
  questions: number;
  pollVotes: number;
  durationMinutes: number;
  conversionRate: number;
}

function daysAgoDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getOverview(days?: number): Promise<AnalyticsOverview> {
  const dateFilter = days ? { gte: daysAgoDate(days) } : undefined;
  const eventWhere = dateFilter ? { startsAt: dateFilter } : {};

  const [events, registrations, participants, questions, pollVotes, feedbackAgg] =
    await Promise.all([
      prisma.event.count({ where: eventWhere }),
      prisma.registration.count({
        where: dateFilter
          ? { event: { startsAt: dateFilter } }
          : {},
      }),
      prisma.registration.count({
        where: {
          joinedAt: { not: null },
          ...(dateFilter ? { event: { startsAt: dateFilter } } : {}),
        },
      }),
      prisma.question.count({
        where: dateFilter
          ? { event: { startsAt: dateFilter } }
          : {},
      }),
      prisma.pollVote.count({
        where: dateFilter
          ? { poll: { event: { startsAt: dateFilter } } }
          : {},
      }),
      prisma.eventFeedback.aggregate({
        _avg: { rating: true },
        _count: true,
        where: dateFilter
          ? { event: { startsAt: dateFilter } }
          : {},
      }),
    ]);

  const avgParticipants = events > 0 ? Math.round(participants / events) : 0;
  const avgConversion =
    registrations > 0
      ? Math.round((participants / registrations) * 100)
      : 0;

  const eventsWithDuration = await prisma.event.findMany({
    where: {
      ...eventWhere,
      status: { in: ['ENDED', 'ARCHIVED'] },
    },
    select: { startsAt: true, endsAt: true },
  });

  let avgDuration = 0;
  if (eventsWithDuration.length > 0) {
    const totalMinutes = eventsWithDuration.reduce((sum, e) => {
      return sum + (e.endsAt.getTime() - e.startsAt.getTime()) / 60_000;
    }, 0);
    avgDuration = Math.round(totalMinutes / eventsWithDuration.length);
  }

  return {
    totalEvents: events,
    totalRegistrations: registrations,
    totalParticipants: participants,
    totalQuestions: questions,
    totalPollVotes: pollVotes,
    averageParticipantsPerEvent: avgParticipants,
    averageConversionRate: avgConversion,
    averageDurationMinutes: avgDuration,
    averageFeedbackRating: Math.round((feedbackAgg._avg.rating ?? 0) * 10) / 10,
    totalFeedback: feedbackAgg._count,
  };
}

export async function getTimeline(days: number): Promise<AnalyticsTimeline[]> {
  const since = daysAgoDate(days);

  const events = await prisma.event.findMany({
    where: { startsAt: { gte: since } },
    select: { startsAt: true },
  });

  const registrations = await prisma.registration.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, joinedAt: true },
  });

  const dateMap = new Map<
    string,
    { events: number; registrations: number; participants: number }
  >();

  for (let d = 0; d < days; d++) {
    const date = new Date(since.getTime() + d * 86400000);
    const key = date.toISOString().slice(0, 10);
    dateMap.set(key, { events: 0, registrations: 0, participants: 0 });
  }

  for (const e of events) {
    const key = e.startsAt.toISOString().slice(0, 10);
    const entry = dateMap.get(key);
    if (entry) entry.events++;
  }

  for (const r of registrations) {
    const key = r.createdAt.toISOString().slice(0, 10);
    const entry = dateMap.get(key);
    if (entry) {
      entry.registrations++;
      if (r.joinedAt) entry.participants++;
    }
  }

  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));
}

export async function getEventAnalytics(
  limit?: number,
): Promise<EventAnalytics[]> {
  const events = await prisma.event.findMany({
    include: {
      _count: {
        select: {
          registrations: true,
          questions: true,
        },
      },
      registrations: {
        select: { joinedAt: true },
      },
      polls: {
        include: { _count: { select: { votes: true } } },
      },
    },
    orderBy: { startsAt: 'desc' },
    ...(limit ? { take: limit } : {}),
  });

  return events.map((e) => {
    const participants = e.registrations.filter(
      (r) => r.joinedAt !== null,
    ).length;
    const totalRegs = e._count.registrations;
    const pollVotes = e.polls.reduce((sum, p) => sum + p._count.votes, 0);
    const durationMinutes = Math.round(
      (e.endsAt.getTime() - e.startsAt.getTime()) / 60_000,
    );

    return {
      eventId: e.id,
      title: e.titleIt,
      date: e.startsAt.toISOString(),
      registrations: totalRegs,
      participants,
      peakParticipants: e.peakParticipants,
      questions: e._count.questions,
      pollVotes,
      durationMinutes,
      conversionRate:
        totalRegs > 0 ? Math.round((participants / totalRegs) * 100) : 0,
    };
  });
}

export async function getTopEvents(
  limit: number,
): Promise<EventAnalytics[]> {
  const allEvents = await getEventAnalytics();
  return allEvents
    .sort((a, b) => b.participants - a.participants)
    .slice(0, limit);
}

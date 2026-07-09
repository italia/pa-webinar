/**
 * GET /api/admin/events/[id]/analytics
 *
 * Post-event statistics for ANY event (recording optional). Composes the
 * existing aggregate recap (buildRecap) with:
 *   - attendance/conversion (Registration.joinedAt)
 *   - chat volume + authorship + moderator/audience split
 *   - an engagement TIMELINE (chat/Q&A/upvotes/polls/words bucketed over the
 *     call — "when interaction peaked")
 *   - a top-speakers leaderboard + talk-time balance (when a recording exists)
 *   - a composite ATTENTION score (participation proxy, admin-only)
 *
 * Per-person speaker stats are pseudonymous by default (Partecipante N).
 * All heavy per-row reads are capped; the endpoint is admin-gated.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';
import { buildRecap, ensureEventRecap } from '@/lib/events/recap';
import {
  bucketTimeline,
  clamp01,
  computeAttentionScore,
  gini,
  speakerLeaderboard,
  type AttentionSignals,
  type TimelinePoint,
} from '@/lib/analytics/event-analytics';

export const dynamic = 'force-dynamic';

const CAP = 8000; // per-stream row cap (defensive; events rarely approach this)

/**
 * Canonical per-person key across streams. Chat uses a JWT-derived senderId
 * (`reg-<registrationId>` or `guest-<hash>`); Q&A/polls/words use the raw
 * registrationId or a guestId. Normalize all of them to `r:<id>` / `g:<id>`
 * so one person is never counted twice.
 */
function personKey(opts: { senderId?: string | null; registrationId?: string | null; guestId?: string | null }): string | null {
  const { senderId, registrationId, guestId } = opts;
  if (registrationId) return `r:${registrationId}`;
  if (guestId) return `g:${guestId}`;
  if (senderId) return senderId.startsWith('reg-') ? `r:${senderId.slice(4)}` : `g:${senderId}`;
  return null;
}

export const GET = withErrorHandling(async (_request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await (context as { params: Promise<{ id: string }> }).params;

  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, title: true, status: true, startsAt: true, endsAt: true },
  });
  if (!event) throw new NotFoundError('Event');

  const [recap, registrations, chat, questions, upvotes, pollVotes, words, recording, callSession] =
    await Promise.all([
      // Persisted recap survives the retention cleanup (raw rows are deleted);
      // fall back to a live build for events that aren't concluded yet.
      ensureEventRecap(id).then((r) => r ?? buildRecap(id)),
      prisma.registration.findMany({ where: { eventId: id }, select: { joinedAt: true } }),
      prisma.chatMessage.findMany({
        where: { eventId: id, hiddenAt: null },
        select: { createdAt: true, senderId: true, senderName: true, isModerator: true },
        orderBy: { createdAt: 'asc' },
        take: CAP,
      }),
      prisma.question.findMany({
        where: { eventId: id },
        select: { createdAt: true, registrationId: true },
        orderBy: { createdAt: 'asc' },
        take: CAP,
      }),
      prisma.questionUpvote.findMany({
        where: { question: { eventId: id } },
        select: { createdAt: true, registrationId: true },
        orderBy: { createdAt: 'asc' },
        take: CAP,
      }),
      prisma.pollVote.findMany({
        where: { poll: { eventId: id } },
        select: { createdAt: true, registrationId: true, guestId: true },
        orderBy: { createdAt: 'asc' },
        take: CAP,
      }),
      prisma.wordCloudSubmission.findMany({
        where: { round: { eventId: id } },
        select: { createdAt: true, registrationId: true, guestId: true },
        orderBy: { createdAt: 'asc' },
        take: CAP,
      }),
      prisma.recording.findFirst({
        where: { eventId: id },
        select: {
          status: true,
          durationSec: true,
          speakers: {
            select: { diarLabel: true, displayName: true, totalSpeechSec: true },
            orderBy: { totalSpeechSec: 'desc' },
          },
        },
      }),
      prisma.callSession.findFirst({
        where: { eventId: id },
        orderBy: { createdAt: 'desc' },
        select: { startedAt: true, endedAt: true, peakParticipants: true },
      }),
    ]);

  // ── Attendance / conversion ──
  const registered = registrations.length;
  const joined = registrations.filter((r) => r.joinedAt != null).length;
  const headcount = callSession?.peakParticipants ?? recap.headcount;

  // ── Chat ──
  const chatAudience = chat.filter((m) => !m.isModerator);
  // Group by the stable senderId (one bucket per person) and display the
  // DECRYPTED name — senderName is AES-GCM at rest with a fresh IV per row,
  // so grouping on the raw column would make every message its own author.
  const authorMap = new Map<string, { name: string; count: number }>();
  for (const m of chatAudience) {
    const key = m.senderId || m.senderName;
    const existing = authorMap.get(key);
    if (existing) existing.count += 1;
    else authorMap.set(key, { name: tryDecryptPII(m.senderName) ?? m.senderName ?? '—', count: 1 });
  }
  const topAuthors = [...authorMap.values()].sort((a, b) => b.count - a.count).slice(0, 6);

  // ── Engagement timeline ──
  const points: TimelinePoint[] = [
    ...chatAudience.map((m) => ({ atMs: m.createdAt.getTime(), kind: 'chat' as const })),
    ...questions.map((q) => ({ atMs: q.createdAt.getTime(), kind: 'question' as const })),
    ...upvotes.map((u) => ({ atMs: u.createdAt.getTime(), kind: 'upvote' as const })),
    ...pollVotes.map((v) => ({ atMs: v.createdAt.getTime(), kind: 'poll' as const })),
    ...words.map((w) => ({ atMs: w.createdAt.getTime(), kind: 'word' as const })),
  ];
  const tsList = points.map((p) => p.atMs);
  const windowStart =
    callSession?.startedAt?.getTime() ??
    (tsList.length ? Math.min(...tsList) : event.startsAt.getTime());
  const windowEnd =
    callSession?.endedAt?.getTime() ??
    (tsList.length ? Math.max(...tsList) : event.endsAt.getTime());
  const timeline = bucketTimeline(points, windowStart, Math.max(windowStart, windowEnd));

  // ── Duration ──
  const durationSec =
    recording?.durationSec ??
    (callSession?.startedAt && callSession.endedAt
      ? Math.round((callSession.endedAt.getTime() - callSession.startedAt.getTime()) / 1000)
      : Math.round((event.endsAt.getTime() - event.startsAt.getTime()) / 1000));
  const durationHours = durationSec > 0 ? durationSec / 3600 : null;

  // ── Distinct interactors (union across streams, one canonical key/person) ──
  const interactorSet = new Set<string>();
  const addKey = (set: Set<string>, k: string | null): void => { if (k) set.add(k); };
  for (const m of chatAudience) addKey(interactorSet, personKey({ senderId: m.senderId }));
  for (const q of questions) addKey(interactorSet, personKey({ registrationId: q.registrationId }));
  for (const u of upvotes) addKey(interactorSet, personKey({ registrationId: u.registrationId }));
  for (const v of pollVotes) addKey(interactorSet, personKey({ registrationId: v.registrationId, guestId: v.guestId }));
  for (const w of words) addKey(interactorSet, personKey({ registrationId: w.registrationId, guestId: w.guestId }));
  const distinctInteractors = interactorSet.size;

  const liveSet = new Set<string>();
  for (const q of questions) addKey(liveSet, personKey({ registrationId: q.registrationId }));
  for (const v of pollVotes) addKey(liveSet, personKey({ registrationId: v.registrationId, guestId: v.guestId }));
  for (const w of words) addKey(liveSet, personKey({ registrationId: w.registrationId, guestId: w.guestId }));
  const distinctLiveParticipants = liveSet.size;

  const totalInteractions =
    chatAudience.length + questions.length + upvotes.length + pollVotes.length + words.length;

  // ── Audio / speakers (recording only for P0) ──
  const hasSpeakers = !!recording && recording.speakers.length > 0;
  const speakers = hasSpeakers
    ? speakerLeaderboard(
        recording.speakers.map((s) => ({
          diarLabel: s.diarLabel,
          displayName: s.displayName,
          speechSec: s.totalSpeechSec,
        })),
      )
    : [];
  // Talk balance is only meaningful with ≥2 speakers. A monologue (0/1 speaker)
  // is maximally IMBALANCED — gini() would return 0 → a misleading "100%
  // balanced" — so we drop the signal instead (null → excluded from the score
  // and hidden in the UI).
  const talkBalance =
    recording && recording.speakers.length >= 2
      ? 1 - gini(recording.speakers.map((s) => Math.max(0, s.totalSpeechSec)))
      : null;
  const totalSpeechSec = recording?.speakers.reduce((s, x) => s + Math.max(0, x.totalSpeechSec), 0) ?? 0;
  const audio = {
    available: hasSpeakers,
    source: hasSpeakers ? ('recording' as const) : null,
    recordingStatus: recording?.status ?? null,
    speakers,
    talkBalancePct: talkBalance != null ? Math.round(clamp01(talkBalance) * 100) : null,
    speechDensityPct:
      durationSec > 0 && totalSpeechSec > 0
        ? Math.round(clamp01(totalSpeechSec / durationSec) * 100)
        : null,
  };

  // ── Attention score ──
  // Rate denominator = actual headcount, not just registrants who got a
  // joinedAt: guests / forwarded-link joiners never set joinedAt, so on a
  // guest-heavy event `joined` massively undercounts and the rates saturate.
  // peakParticipants is the real (concurrent) headcount and a far better base.
  const rateBase = Math.max(joined, headcount) || null;
  const signals: AttentionSignals = {
    attendanceRate: registered > 0 ? joined / registered : null,
    breadth: rateBase ? clamp01(distinctInteractors / rateBase) : null,
    depth: rateBase ? clamp01(totalInteractions / rateBase / 3) : null,
    chatRate:
      rateBase && durationHours
        ? clamp01(chatAudience.length / rateBase / durationHours / 5)
        : null,
    liveParticipation: rateBase ? clamp01(distinctLiveParticipants / rateBase) : null,
    talkBalance,
    retention: null, // P1 — needs Registration.leftAt written
  };
  const attention = computeAttentionScore(signals);

  // Signal to the UI when any stream hit the row cap (timeline/totals partial).
  const capped =
    chat.length >= CAP ||
    questions.length >= CAP ||
    upvotes.length >= CAP ||
    pollVotes.length >= CAP ||
    words.length >= CAP;

  return Response.json({
    eventId: event.id,
    status: event.status,
    durationSec,
    generatedAt: new Date().toISOString(),
    attendance: {
      registered,
      joined,
      conversionPct: registered > 0 ? Math.round((joined / registered) * 100) : null,
      peakParticipants: headcount,
    },
    chat: {
      total: chat.length,
      byModerator: chat.length - chatAudience.length,
      byAudience: chatAudience.length,
      capped: chat.length >= CAP,
      topAuthors,
    },
    interactions: { total: totalInteractions, distinctInteractors, capped },
    qa: { topQuestions: recap.topQuestions },
    polls: recap.polls,
    topWords: recap.topWords,
    feedback: recap.feedback,
    audio,
    timeline,
    attention,
  });
});

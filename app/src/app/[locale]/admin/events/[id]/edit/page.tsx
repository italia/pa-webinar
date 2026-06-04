import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { jvbMaxReplicasFromEnv } from '@/lib/jvb-sizing';
import { getSettings } from '@/lib/settings';
import { Link } from '@/i18n/navigation';
import EventWizard, {
  type InitialEventShape,
} from '@/components/admin/event-wizard/wizard-shell';
import type {
  AdhocQuestionDraft,
  AdhocQuestionType,
  QuestionnaireBlock,
} from '@/components/admin/event-wizard/step-4-content';
import {
  coerceMatrix,
  type PermissionMatrix,
} from '@/lib/utils/permission-matrix';

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ token?: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Project a stored `QuestionItem` row into the wizard's AdhocQuestionDraft. */
function adhocFromDb(
  item: {
    prompt: unknown;
    type: string;
    options: unknown;
    scaleMin: number | null;
    scaleMax: number | null;
    required: boolean;
  },
  defaultLocale: string,
): AdhocQuestionDraft {
  // `prompt` and options are localized JSON — pull the default locale.
  const promptMap =
    typeof item.prompt === 'object' && item.prompt !== null
      ? (item.prompt as Record<string, string>)
      : {};
  const promptText =
    promptMap[defaultLocale] ??
    promptMap.it ??
    promptMap.en ??
    Object.values(promptMap)[0] ??
    '';

  const optionsArr = Array.isArray(item.options) ? item.options : [];
  const optionTexts = optionsArr.map((o) => {
    if (typeof o === 'object' && o !== null) {
      const rec = o as Record<string, string>;
      return rec[defaultLocale] ?? rec.it ?? rec.en ?? Object.values(rec)[0] ?? '';
    }
    return String(o ?? '');
  });

  return {
    prompt: promptText,
    type: item.type as AdhocQuestionType,
    options: optionTexts.length >= 2 ? optionTexts : ['', ''],
    scaleMin: item.scaleMin,
    scaleMax: item.scaleMax,
    required: item.required,
  };
}

export default async function EditEventPage({ params, searchParams }: PageProps) {
  const { id, locale } = await params;
  const { token } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'admin' });

  if (!token) notFound();
  if (!UUID_RE.test(id)) notFound();

  const [event, siteSettings, tags, gdprTemplates] = await Promise.all([
    prisma.event.findUnique({
      where: { id },
      include: {
        tagLinks: { include: { tag: true } },
        organizers: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        invitations: { orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] },
        additionalMods: {
          where: { revokedAt: null },
          orderBy: { createdAt: 'asc' },
        },
        materials: { orderBy: { createdAt: 'asc' } },
        questionnaires: {
          include: {
            templates: { orderBy: { sortOrder: 'asc' } },
            adhocItems: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    }),
    getSettings(),
    prisma.tag.findMany({ orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }] }),
    prisma.gdprTemplate.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isDefault: true },
    }),
  ]);

  if (!event || event.moderatorToken !== token) {
    notFound();
  }

  const defaultLocale = siteSettings.defaultLocale ?? 'it';

  const pre = event.questionnaires.find(
    (q) => q.placement === 'PRE_REGISTRATION',
  );
  const post = event.questionnaires.find((q) => q.placement === 'POST_EVENT');

  const preBlock: QuestionnaireBlock | null = pre
    ? {
        templateIds: pre.templates.map((l) => l.templateId),
        adhocQuestions: pre.adhocItems.map((i) => adhocFromDb(i, defaultLocale)),
      }
    : null;
  const postBlock: QuestionnaireBlock | null = post
    ? {
        templateIds: post.templates.map((l) => l.templateId),
        adhocQuestions: post.adhocItems.map((i) =>
          adhocFromDb(i, defaultLocale),
        ),
      }
    : null;

  const matrix: PermissionMatrix | null = coerceMatrix(event.permissionMatrix);

  const initialEvent: InitialEventShape = {
    id: event.id,
    slug: event.slug,
    moderatorToken: event.moderatorToken,
    event: {
      title: (event.title ?? {}) as Record<string, string>,
      description: (event.description ?? {}) as Record<string, string>,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      timezone: event.timezone,
      maxParticipants: event.maxParticipants,
      coverImageUrl: event.coverImageUrl,
      imageUrl: event.imageUrl,
      waitingRoomAudioUrl: event.waitingRoomAudioUrl,
      tagSlugs: event.tagLinks.map((l) => l.tag.slug),
      recurrenceRule: event.recurrenceRule,
      parseTitleKicker: event.parseTitleKicker,
      expectedSenderRatioPct: event.expectedSenderRatioPct,
      permissionMatrix: matrix,
      qaEnabled: event.qaEnabled,
      chatEnabled: event.chatEnabled,
      participantsCanUnmute: event.participantsCanUnmute,
      participantsCanStartVideo: event.participantsCanStartVideo,
      participantsCanShareScreen: event.participantsCanShareScreen,
      recordingEnabled: event.recordingEnabled,
      autoStartRecording: event.autoStartRecording,
      aiTranscriptEnabled: event.aiTranscriptEnabled,
      aiSummaryEnabled: event.aiSummaryEnabled,
      aiTranslationEnabled: event.aiTranslationEnabled,
      aiDubbingEnabled: event.aiDubbingEnabled,
      aiTargetLocales: event.aiTargetLocales,
      expectedSpeakers: event.expectedSpeakers,
      dataRetentionDays: event.dataRetentionDays,
      gdprTemplateId: event.gdprTemplateId,
      privacyPolicyText: event.privacyPolicyText,
      privacyPolicyUrl: event.privacyPolicyUrl,
      moderatorName: event.moderatorName,
      moderatorEmail: tryDecryptPII(event.moderatorEmail),
    },
    organizers: event.organizers.map((o) => ({
      id: o.id,
      name: o.name,
      // The wizard's OrganizerEntry carries an `organization` string. The
      // DB model doesn't have a separate "organization" column yet — use
      // the name as a stand-in so the picker doesn't show an empty field.
      organization: o.name,
      logoUrl: o.logoUrl,
      websiteUrl: o.websiteUrl,
    })),
    eventModerators: event.additionalMods.map((m) => ({
      id: m.id,
      name: tryDecryptPII(m.name) ?? m.name,
      email: tryDecryptPII(m.email),
      role: m.role as 'MODERATOR' | 'SPEAKER',
      personId: null,
    })),
    invitations: event.invitations.map((i) => ({
      id: i.id,
      name: tryDecryptPII(i.name),
      email: tryDecryptPII(i.email) ?? '',
      role: i.role as 'GUEST' | 'SPEAKER',
      personId: i.personId,
    })),
    materials: event.materials.map((m) => ({
      id: m.id,
      title: m.title,
      url: m.url,
      description: m.description,
      // DB stores uppercase; wizard uses lowercase.
      type: (m.type === 'FILE' ? 'file' : 'link') as 'file' | 'link',
      visibility: m.visibility as 'BEFORE' | 'DURING' | 'AFTER' | 'ALWAYS',
    })),
    preEventQuestionnaire: preBlock,
    postEventQuestionnaire: postBlock,
  };

  return (
    <div className="container py-4">
      <div className="mb-2">
        <Link
          href={`/admin/events/${id}?token=${token}`}
          className="text-decoration-none d-inline-flex align-items-center text-primary"
          style={{ fontSize: '0.9rem' }}
        >
          ← {t('title')}
        </Link>
      </div>

      <h1 className="fw-bold mb-4" style={{ color: 'var(--app-text)' }}>
        {t('editEvent')}
      </h1>

      <EventWizard
        mode="edit"
        initialEvent={initialEvent}
        siteTimezone={event.timezone}
        enabledLocales={
          Array.isArray(siteSettings.availableLocales) &&
          siteSettings.availableLocales.length > 0
            ? (siteSettings.availableLocales as string[])
            : ['it', 'en']
        }
        defaultLocale={defaultLocale}
        defaultSenderRatioPct={siteSettings.defaultSenderRatioPct ?? 30}
        defaultRetentionDays={event.dataRetentionDays}
        jvbSizingConfig={{
          cpuCoresPerPod: siteSettings.jvbCpuCoresPerPod ?? 16,
          receiversPerCore: siteSettings.jvbReceiversPerCore ?? 18.75,
          sendersPerCore: siteSettings.jvbSendersPerCore ?? 3.125,
          maxReplicas: siteSettings.jvbMaxReplicas ?? jvbMaxReplicasFromEnv(),
        }}
        availableTags={tags.map((tg) => ({
          slug: tg.slug,
          name: (tg.name ?? {}) as Record<string, string>,
          color: tg.color,
        }))}
        gdprTemplates={gdprTemplates}
        siteDefaultParseTitleKicker={siteSettings.parseTitleKicker}
      />
    </div>
  );
}

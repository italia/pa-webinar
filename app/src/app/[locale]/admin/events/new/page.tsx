import { getLocale, getTranslations } from 'next-intl/server';

import { staffOLogin } from '@/lib/auth/staff-page';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { getPublicEnv } from '@/lib/env';
import { resolveWhiteboardInfraReady } from '@/lib/jitsi/whiteboard';
import { prisma } from '@/lib/db';
import { jvbMaxReplicasFromEnv } from '@/lib/jvb-sizing';
import { getSettings } from '@/lib/settings';
import CreateEventWithTemplate from '@/components/admin/create-event-with-template';
import type { PermissionMatrix } from '@/lib/utils/permission-matrix';

interface CreateEventPageProps {
  searchParams: Promise<{ template?: string; instant?: string }>;
}

export default async function CreateEventPage({
  searchParams,
}: CreateEventPageProps) {
  // Creare eventi e' il mestiere dell'organizzatore (ADR-014).
  const session = await staffOLogin(await getLocale());
  const t = await getTranslations('admin');
  const { template: templateId, instant } = await searchParams;

  const [templates, siteSettings, tags, gdprTemplates] = await Promise.all([
    prisma.eventTemplate.findMany({ orderBy: { sortOrder: 'asc' } }),
    getSettings(),
    prisma.tag.findMany({ orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }] }),
    prisma.gdprTemplate.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isDefault: true },
    }),
  ]);

  // Chi crea l'evento da un account nominale ne e' il moderatore principale
  // di partenza: nome ed email gia' scritti, si cambiano se serve. Con la
  // chiave dell'istanza non c'e' un account, e i campi restano vuoti.
  const account = session.accountId
    ? await prisma.staffAccount.findUnique({
        where: { id: session.accountId },
        select: { name: true, email: true },
      })
    : null;
  const moderatoreDiPartenza = account
    ? { name: tryDecryptPII(account.name) ?? '', email: tryDecryptPII(account.email) ?? '' }
    : null;

  const selectedTemplate = templateId
    ? templates.find((tpl) => tpl.id === templateId) ?? null
    : null;

  const serializedTemplates = templates.map((tpl) => ({
    id: tpl.id,
    name: tpl.name,
    description: tpl.description,
    icon: tpl.icon,
    qaEnabled: tpl.qaEnabled,
    chatEnabled: tpl.chatEnabled,
    recordingEnabled: tpl.recordingEnabled,
    autoStartRecording: tpl.autoStartRecording,
    participantsCanUnmute: tpl.participantsCanUnmute,
    participantsCanStartVideo: tpl.participantsCanStartVideo,
    participantsCanShareScreen: tpl.participantsCanShareScreen,
    maxParticipants: tpl.maxParticipants,
  }));

  const serializedSelected = selectedTemplate
    ? {
        id: selectedTemplate.id,
        name: selectedTemplate.name,
        qaEnabled: selectedTemplate.qaEnabled,
        chatEnabled: selectedTemplate.chatEnabled,
        recordingEnabled: selectedTemplate.recordingEnabled,
        autoStartRecording: selectedTemplate.autoStartRecording,
        agendaEnabled: selectedTemplate.agendaEnabled,
        wordCloudEnabled: selectedTemplate.wordCloudEnabled,
        whiteboardEnabled: selectedTemplate.whiteboardEnabled,
        waitingRoomEngine: selectedTemplate.waitingRoomEngine,
        participantsCanUnmute: selectedTemplate.participantsCanUnmute,
        participantsCanStartVideo: selectedTemplate.participantsCanStartVideo,
        participantsCanShareScreen: selectedTemplate.participantsCanShareScreen,
        maxParticipants: selectedTemplate.maxParticipants,
        // Default wizard (semplificazione) + permissionMatrix (prima non
        // veniva passata → la matrice del template non arrivava al wizard).
        permissionMatrix:
          (selectedTemplate.permissionMatrix as PermissionMatrix | null) ?? null,
        defaultDurationMinutes: selectedTemplate.defaultDurationMinutes,
        aiTranscriptEnabled: selectedTemplate.aiTranscriptEnabled,
        aiSummaryEnabled: selectedTemplate.aiSummaryEnabled,
        aiTranslationEnabled: selectedTemplate.aiTranslationEnabled,
        // Questa serializzazione è una whitelist esplicita, non uno spread: un
        // campo nuovo sul template resta invisibile al wizard finché non lo si
        // nomina anche qui. È il motivo per cui i flag di cattura si perdevano.
        aiDubbingEnabled: selectedTemplate.aiDubbingEnabled,
        multitrackRecordingEnabled: selectedTemplate.multitrackRecordingEnabled,
        retainParticipantTracks: selectedTemplate.retainParticipantTracks,
        aiTargetLocales: selectedTemplate.aiTargetLocales,
        descriptionTemplate:
          (selectedTemplate.descriptionTemplate as Record<string, string> | null) ?? null,
        defaultRetentionDays: selectedTemplate.defaultRetentionDays,
        defaultExpectedSpeakers: selectedTemplate.defaultExpectedSpeakers,
        postEventPublic: selectedTemplate.postEventPublic,
      }
    : null;

  return (
    <div className="container py-5">
      <h1 className="fw-bold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('createEvent')}
      </h1>

      <CreateEventWithTemplate
        initialInstant={instant === '1'}
        templates={serializedTemplates}
        selectedTemplate={serializedSelected}
        siteTimezone={siteSettings.defaultTimezone}
        enabledLocales={
          Array.isArray(siteSettings.availableLocales) &&
          siteSettings.availableLocales.length > 0
            ? (siteSettings.availableLocales as string[])
            : ['it', 'en']
        }
        defaultLocale={siteSettings.defaultLocale ?? 'it'}
        defaultSenderRatioPct={siteSettings.defaultSenderRatioPct ?? 30}
        defaultRetentionDays={30}
        canUseRubrica={session.role === 'admin'}
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
        siteDefaultVideoQuality={siteSettings.videoQuality}
        // Letto a runtime come nella sala (lib/jitsi/whiteboard.ts): il
        // passo 2 offre la lavagna solo se l'installazione ne ha il servizio.
        whiteboardInfraReady={resolveWhiteboardInfraReady(
          getPublicEnv('NEXT_PUBLIC_WHITEBOARD_ENABLED'),
        )}
        defaultTargetLocales={siteSettings.aiDefaultTargetLocales}
        aiPipelineEnabled={siteSettings.aiPipelineEnabled}
        defaultModerator={moderatoreDiPartenza}
      />
    </div>
  );
}

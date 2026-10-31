import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { getStaffSession, puoGestire } from '@/lib/auth/staff-session';
import AccessDenied from '@/components/admin/access-denied';
import { localizedPath } from '@/lib/utils/localized-url';
import { eventAdminPath } from '@/lib/events/admin-links';
import { getPublicEnv } from '@/lib/env';
import { resolveWhiteboardInfraReady } from '@/lib/jitsi/whiteboard';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { rubricaConPersone } from '@/lib/persons/rubrica-picker';
import { capacitaIstanza } from '@/lib/capacity/istanza';
import { getSettings } from '@/lib/settings';
import { liveCaptionsAvailable } from '@/lib/captions/availability';
import { traduzioneDisponibile, ultimoLavoroTraduzione } from '@/lib/text-translation/enqueue';
import { calcolaStatoTesti } from '@/lib/text-translation/auto';
import { agendaGiaUsata } from '@/lib/agenda/status';
import { Link, percorso } from '@/i18n/navigation';
import { WIZARD_ADVANCED_SECTIONS, wizardStepFromParam, type WizardAdvancedSection } from '@/lib/events/wizard-steps';
import { salaForseAperta } from '@/lib/live/room-open';
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
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageTitle, eventPageMetadata } from '@/components/admin/admin-page-title';

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{
    token?: string;
    step?: string | string[];
    section?: string | string[];
    /** Una copia appena duplicata (vedi eventAdminPath). */
    copia?: string | string[];
  }>;
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
    scaleMinLabel?: unknown;
    scaleMaxLabel?: unknown;
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
    // Trasportati senza modifiche: il wizard mostra una lingua sola e non ha
    // campo per le etichette delle scale. Se la domanda non viene riscritta,
    // il salvataggio li rimanda indietro come sono.
    original: {
      prompt: promptMap,
      options: item.options ?? undefined,
      scaleMinLabel: item.scaleMinLabel ?? undefined,
      scaleMaxLabel: item.scaleMaxLabel ?? undefined,
    },
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string | string[]; copia?: string | string[] }>;
}) {
  const [{ id }, { token, copia }] = await Promise.all([params, searchParams]);
  const meta = await eventPageMetadata('/admin/events/[id]/edit', id, { token, conToken: true });
  // Una copia appena duplicata: anche la scheda del browser lo dice, per non
  // confonderla con l'originale aperto accanto.
  if ((copia === 'prossima' || copia === 'stesse') && typeof meta.title === 'string') {
    const nome = await adminPageTitle('/admin/events/[id]/edit');
    if (nome && meta.title.startsWith(nome)) {
      const t = await getTranslations('admin');
      return { ...meta, title: `${t('editCopyTitle')}${meta.title.slice(nome.length)}` };
    }
  }
  return meta;
}

export default async function EditEventPage({ params, searchParams }: PageProps) {
  const { id, locale } = await params;
  const { token, step, section, copia: copiaParam } = await searchParams;
  // Una copia appena duplicata, solo finche' e' in bozza: lo si dice in
  // cima, perche' la pagina e' la stessa della modifica.
  const copia = copiaParam === 'prossima' || copiaParam === 'stesse' ? copiaParam : null;
  // Il passo da cui partire (dai link «Modifica» della pagina dell'evento),
  // anche nominato come una volta: `content`, e la vecchia sezione
  // `section=participation` delle impostazioni avanzate, oggi il passo
  // «Permessi».
  const daIndirizzo =
    section === 'participation' ? { step: 'permissions' as const } : wizardStepFromParam(step);
  const initialStep = daIndirizzo?.step;
  const initialSection: WizardAdvancedSection | undefined =
    (WIZARD_ADVANCED_SECTIONS as readonly string[]).includes(String(section))
      ? (section as WizardAdvancedSection)
      : daIndirizzo?.section;
  const t = await getTranslations({ locale, namespace: 'admin' });
  const tNav = await getTranslations('admin.nav');

  if (!UUID_RE.test(id)) notFound();

  // Come la pagina di gestione: lo staff entra con la propria sessione (per
  // l'organizzatore solo sugli eventi che gestisce, ADR-014) e il token
  // nell'indirizzo si toglie; chi ha solo il link del moderatore entra col token.
  const session = await getStaffSession(await cookies());
  const staffCanManage = session ? await puoGestire(session, id) : false;
  if (token && staffCanManage) {
    redirect(localizedPath(eventAdminPath(id, { edit: true, step: initialStep, section: initialSection }), locale));
  }
  if (!token) {
    if (!session) notFound();
    if (!staffCanManage) return <AccessDenied />;
  }

  const [event, siteSettings, tags, gdprTemplates, ultimaTraduzione] = await Promise.all([
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
        // Il programma: gli argomenti in ordine, con chi interviene, e cio'
        // che dice se l'agenda e' gia' stata usata in sala.
        agendaItems: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            label: true,
            plannedMinutes: true,
            status: true,
            speakerGrantId: true,
            speakerPrimary: true,
          },
        },
        questionnaires: {
          include: {
            templates: { orderBy: { sortOrder: 'asc' } },
            adhocItems: { orderBy: { sortOrder: 'asc' } },
            _count: { select: { responses: true } },
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
    ultimoLavoroTraduzione(id),
  ]);

  if (!event || (token && event.moderatorToken !== token)) {
    notFound();
  }

  const defaultLocale = siteSettings.defaultLocale ?? 'it';
  // Lo stato delle lingue di titolo e descrizione, calcolato qui sull'evento e
  // le impostazioni gia' letti: con il solo link di conduzione il wizard non
  // puo' chiederlo all'amministrazione.
  const statoLingue = calcolaStatoTesti({
    evento: event,
    impostazioni: siteSettings,
    lavoro: ultimaTraduzione,
    ora: new Date(),
  });

  const pre = event.questionnaires.find(
    (q) => q.placement === 'PRE_REGISTRATION',
  );
  const post = event.questionnaires.find((q) => q.placement === 'POST_EVENT');

  const preBlock: QuestionnaireBlock | null = pre
    ? {
        templateIds: pre.templates.map((l) => l.templateId),
        adhocQuestions: pre.adhocItems.map((i) => adhocFromDb(i, defaultLocale)),
        original: {
          title: pre.title,
          description: pre.description,
          required: pre.required,
          allowEdit: pre.allowEdit,
        },
      }
    : null;
  const postBlock: QuestionnaireBlock | null = post
    ? {
        templateIds: post.templates.map((l) => l.templateId),
        adhocQuestions: post.adhocItems.map((i) =>
          adhocFromDb(i, defaultLocale),
        ),
        original: {
          title: post.title,
          description: post.description,
          required: post.required,
          allowEdit: post.allowEdit,
        },
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
      waitingRoomEngine: event.waitingRoomEngine,
      videoQuality: event.videoQuality,
      expectedSenderRatioPct: event.expectedSenderRatioPct,
      permissionMatrix: matrix,
      qaEnabled: event.qaEnabled,
      chatEnabled: event.chatEnabled,
      participantsCanUnmute: event.participantsCanUnmute,
      participantsCanStartVideo: event.participantsCanStartVideo,
      participantsCanShareScreen: event.participantsCanShareScreen,
      recordingEnabled: event.recordingEnabled,
      agendaEnabled: event.agendaEnabled,
      wordCloudEnabled: event.wordCloudEnabled,
      whiteboardEnabled: event.whiteboardEnabled,
      liveCaptionsEnabled: event.liveCaptionsEnabled,
      captionsTranscriptEnabled: event.captionsTranscriptEnabled,
      autoStartRecording: event.autoStartRecording,
      listenOnlyWithoutConsent: event.listenOnlyWithoutConsent,
      aiTranscriptEnabled: event.aiTranscriptEnabled,
      aiSummaryEnabled: event.aiSummaryEnabled,
      aiTranslationEnabled: event.aiTranslationEnabled,
      aiDubbingEnabled: event.aiDubbingEnabled,
      multitrackRecordingEnabled: event.multitrackRecordingEnabled,
      retainParticipantTracks: event.retainParticipantTracks,
      aiTargetLocales: event.aiTargetLocales,
      expectedSpeakers: event.expectedSpeakers,
      status: event.status,
      dataRetentionDays: event.dataRetentionDays,
      postEventPublic: event.postEventPublic,
      gdprTemplateId: event.gdprTemplateId,
      privacyPolicyText: event.privacyPolicyText,
      privacyPolicyUrl: event.privacyPolicyUrl,
      moderatorName: event.moderatorName,
      moderatorEmail: tryDecryptPII(event.moderatorEmail),
      moderatorOrganization: event.moderatorOrganization,
      moderatorOrganizationLogoUrl: event.moderatorOrganizationLogoUrl,
      moderatorPublicListed: event.moderatorPublicListed,
      moderatorPhotoId: event.moderatorPhotoId,
      eventType: event.eventType,
      accessMode: event.accessMode,
      requireOrganization: event.requireOrganization,
      requireOrganizationRole: event.requireOrganizationRole,
      requireOrganizationType: event.requireOrganizationType,
    },
    organizers: event.organizers.map((o) => ({
      id: o.id,
      name: o.name,
      logoUrl: o.logoUrl,
      websiteUrl: o.websiteUrl,
    })),
    eventModerators: event.additionalMods.map((m) => ({
      id: m.id,
      name: tryDecryptPII(m.name) ?? m.name,
      email: tryDecryptPII(m.email),
      role: m.role as 'MODERATOR' | 'SPEAKER',
      personId: null,
      organizer: m.organizer,
      organization: m.organization,
      organizationLogoUrl: m.organizationLogoUrl,
      publicListed: m.publicListed,
      photoId: m.photoId,
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
    questionnaireResponses: {
      pre: pre?._count.responses ?? 0,
      post: post?._count.responses ?? 0,
    },
    agenda: event.agendaItems.map((a) => ({
      id: a.id,
      label: a.label,
      plannedMinutes: a.plannedMinutes,
      speakerGrantId: a.speakerGrantId,
      speakerPrimary: a.speakerPrimary,
    })),
    // Come la rotta che salva il programma: un argomento non piu' da
    // discutere, e l'agenda e' della sala.
    agendaLocked: agendaGiaUsata(event.agendaItems),
  };

  const copiaInBozza = copia !== null && event.status === 'DRAFT';

  return (
    <div className="container py-4">
      {/* Lo staff torna indietro con le briciole; chi ha solo il link del
          moderatore non le ha, e torna alla pagina dell'evento da qui. */}
      {!staffCanManage && (
        <div className="mb-2">
          <Link
            href={percorso(eventAdminPath(id, { viaToken: token }))}
            className="text-decoration-none d-inline-flex align-items-center text-primary"
            style={{ fontSize: '0.9rem' }}
          >
            ← {tNav('eventDetail')}
          </Link>
        </div>
      )}

      <AdminPageHeader title={copiaInBozza ? t('editCopyTitle') : t('editEvent')} />
      {copiaInBozza && (
        <div className="alert alert-info mb-4" role="status">
          {copia === 'prossima' ? t('editCopyNoticeNext') : t('editCopyNoticeSameDates')}
        </div>
      )}

      <EventWizard
        mode="edit"
        copia={copiaInBozza}
        initialStep={initialStep}
        initialSection={initialSection}
        canUseRubrica={session?.role === 'admin' && (await rubricaConPersone())}
        canManageTags={session?.role === 'admin'}
        publicRegistrationEnabled={siteSettings.publicRegistrationEnabled}
        viaToken={staffCanManage ? null : (token ?? null)}
        initialEvent={initialEvent}
        siteTimezone={event.timezone}
        salaAperta={await salaForseAperta(event)}
        enabledLocales={
          Array.isArray(siteSettings.availableLocales) &&
          siteSettings.availableLocales.length > 0
            ? (siteSettings.availableLocales as string[])
            : ['it', 'en']
        }
        defaultLocale={defaultLocale}
        defaultRetentionDays={event.dataRetentionDays}
        capacita={capacitaIstanza(siteSettings)}
        availableTags={tags.map((tg) => ({
          slug: tg.slug,
          name: (tg.name ?? {}) as Record<string, string>,
          color: tg.color,
        }))}
        gdprTemplates={gdprTemplates}
        siteDefaultParseTitleKicker={siteSettings.parseTitleKicker}
        siteDefaultVideoQuality={siteSettings.videoQuality}
        // Letto a runtime come nella sala (lib/jitsi/whiteboard.ts).
        whiteboardInfraReady={resolveWhiteboardInfraReady(
          getPublicEnv('NEXT_PUBLIC_WHITEBOARD_ENABLED'),
        )}
        liveCaptionsAvailable={liveCaptionsAvailable(siteSettings)}
        defaultTargetLocales={siteSettings.aiDefaultTargetLocales}
        aiPipelineEnabled={siteSettings.aiPipelineEnabled}
        // La traduzione al salvataggio la decide il server, per chiunque salvi.
        textTranslationAvailable={traduzioneDisponibile(siteSettings)}
        statoLingueIniziale={statoLingue}
        isSiteAdmin={session?.role === 'admin'}
        campiLiberi={{
          speakersInfo: (event.speakersInfo ?? null) as Record<string, string> | null,
          organizerName: event.organizerName ?? null,
        }}
      />
    </div>
  );
}

// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { EventTemplate } from '@prisma/client';

import type { WizardTemplatePreset } from '@/components/admin/event-wizard/wizard-shell';
import type { PermissionMatrix } from '@/lib/utils/permission-matrix';

/**
 * Le colonne di un modello che non arrivano al wizard, con il motivo. Una colonna
 * nuova va passata da `presetDelModello` o scritta qui: un test le confronta con
 * lo schema, perche' un campo dimenticato non da' errori, e il modello direbbe
 * una cosa mentre l'evento ne fa un'altra.
 */
export const NOT_PRESET_TEMPLATE_FIELDS: Record<string, string> = {
  description: "descrive il modello nell'elenco, non l'evento",
  icon: "l'icona del modello nell'elenco",
  sortOrder: "l'ordine dei modelli nell'elenco",
  isSystem: 'dice da dove viene il modello',
  createdAt: 'data del modello',
  updatedAt: 'data del modello',
};

/**
 * Cio' che di un modello arriva al wizard. E' una whitelist: il modello resta sul
 * server, e un campo nuovo resta invisibile al wizard finche' non lo si nomina
 * qui.
 */
export function presetDelModello(tpl: EventTemplate): WizardTemplatePreset {
  return {
    id: tpl.id,
    name: tpl.name,
    qaEnabled: tpl.qaEnabled,
    chatEnabled: tpl.chatEnabled,
    recordingEnabled: tpl.recordingEnabled,
    autoStartRecording: tpl.autoStartRecording,
    agendaEnabled: tpl.agendaEnabled,
    wordCloudEnabled: tpl.wordCloudEnabled,
    whiteboardEnabled: tpl.whiteboardEnabled,
    liveCaptionsEnabled: tpl.liveCaptionsEnabled,
    waitingRoomEngine: tpl.waitingRoomEngine,
    participantsCanUnmute: tpl.participantsCanUnmute,
    participantsCanStartVideo: tpl.participantsCanStartVideo,
    participantsCanShareScreen: tpl.participantsCanShareScreen,
    maxParticipants: tpl.maxParticipants,
    permissionMatrix: (tpl.permissionMatrix as PermissionMatrix | null) ?? null,
    defaultDurationMinutes: tpl.defaultDurationMinutes,
    aiTranscriptEnabled: tpl.aiTranscriptEnabled,
    aiSummaryEnabled: tpl.aiSummaryEnabled,
    aiTranslationEnabled: tpl.aiTranslationEnabled,
    aiDubbingEnabled: tpl.aiDubbingEnabled,
    multitrackRecordingEnabled: tpl.multitrackRecordingEnabled,
    retainParticipantTracks: tpl.retainParticipantTracks,
    aiTargetLocales: tpl.aiTargetLocales,
    descriptionTemplate:
      (tpl.descriptionTemplate as Record<string, string> | null) ?? null,
    defaultRetentionDays: tpl.defaultRetentionDays,
    defaultExpectedSpeakers: tpl.defaultExpectedSpeakers,
    postEventPublic: tpl.postEventPublic,
    recordingDestination: tpl.recordingDestination,
    offerAddressBook: tpl.offerAddressBook,
    audienceAnonymous: tpl.audienceAnonymous,
    hostsAlwaysRecorded: tpl.hostsAlwaysRecorded,
    postEventShowQA: tpl.postEventShowQA,
  };
}

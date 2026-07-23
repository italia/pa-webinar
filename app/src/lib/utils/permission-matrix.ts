/**
 * Role × feature permission matrix for events.
 *
 * Stored on `Event.permissionMatrix` (JSONB, nullable). When null, the
 * legacy boolean toggles on the Event row are authoritative and the UI
 * renders them. When set, the wizard keeps both in sync on submit so
 * downstream consumers (Jitsi JWT builder, live client, public event page)
 * don't need to know about the matrix.
 *
 * The shape is intentionally flat and human-readable so it can be edited
 * by hand in Prisma Studio if needed.
 */

export type EventRole = 'GUEST' | 'SPEAKER' | 'MODERATOR';
export const EVENT_ROLES: readonly EventRole[] = ['GUEST', 'SPEAKER', 'MODERATOR'] as const;

/**
 * Features managed by the matrix. `qa` and `chat` are visibility-only (can
 * the role see the panel); `mic`, `video`, `share` are AV grants (can the
 * role unmute / turn camera on / screen-share); `recording_control` gates
 * the start/stop recording buttons.
 */
export type EventFeature =
  | 'qa'
  | 'chat'
  | 'mic'
  | 'video'
  | 'share'
  | 'recording_control';

// Chat is listed before Q&A: it is the primary audience-interaction channel
// (live feedback #10 "manteniamo solo chat"), so it renders as the first row in
// the admin permissions wizard and the leftmost live tab. Consumers iterate by
// key, so the order is purely presentational.
export const EVENT_FEATURES: readonly EventFeature[] = [
  'chat',
  'qa',
  'mic',
  'video',
  'share',
  'recording_control',
] as const;

export type PermissionMatrix = Record<EventFeature, EventRole[]>;

/**
 * Minimal invariant: a moderator can always do everything. The UI
 * enforces this too, but we also clamp on write so a stale client can't
 * lock moderators out.
 */
export function withModeratorInvariant(matrix: PermissionMatrix): PermissionMatrix {
  const clamped = {} as PermissionMatrix;
  for (const feature of EVENT_FEATURES) {
    const roles = new Set(matrix[feature] ?? []);
    roles.add('MODERATOR');
    clamped[feature] = Array.from(roles).sort() as EventRole[];
  }
  return clamped;
}

/**
 * Build a matrix from the legacy boolean toggles. This is what we use
 * when opening the wizard on an event that was created before the matrix
 * existed — the UI shows the equivalent matrix, and saving the wizard
 * writes both the matrix AND keeps the booleans in sync.
 */
export function matrixFromToggles(toggles: {
  qaEnabled: boolean;
  chatEnabled: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
}): PermissionMatrix {
  return withModeratorInvariant({
    qa: toggles.qaEnabled
      ? ['GUEST', 'SPEAKER', 'MODERATOR']
      : ['SPEAKER', 'MODERATOR'],
    chat: toggles.chatEnabled
      ? ['GUEST', 'SPEAKER', 'MODERATOR']
      : ['MODERATOR'],
    mic: toggles.participantsCanUnmute
      ? ['GUEST', 'SPEAKER', 'MODERATOR']
      : ['SPEAKER', 'MODERATOR'],
    video: toggles.participantsCanStartVideo
      ? ['GUEST', 'SPEAKER', 'MODERATOR']
      : ['SPEAKER', 'MODERATOR'],
    share: toggles.participantsCanShareScreen
      ? ['GUEST', 'SPEAKER', 'MODERATOR']
      : ['SPEAKER', 'MODERATOR'],
    recording_control: ['MODERATOR'],
  });
}

/**
 * Project a matrix back onto the legacy boolean toggles so any code path
 * that still reads them stays correct.
 */
export function togglesFromMatrix(matrix: PermissionMatrix) {
  const guestCan = (f: EventFeature) => matrix[f]?.includes('GUEST') ?? false;
  return {
    qaEnabled: guestCan('qa'),
    chatEnabled: guestCan('chat'),
    participantsCanUnmute: guestCan('mic'),
    participantsCanStartVideo: guestCan('video'),
    participantsCanShareScreen: guestCan('share'),
  };
}

export function defaultMatrix(): PermissionMatrix {
  // Chat-on / Q&A-off by default for a blank event (live feedback #10: chat is
  // the primary channel). Q&A stays available for a moderator to re-enable
  // per-event; the Questions subsystem is unchanged.
  return matrixFromToggles({
    qaEnabled: false,
    chatEnabled: true,
    participantsCanUnmute: false,
    participantsCanStartVideo: false,
    participantsCanShareScreen: false,
  });
}

/**
 * Accepts `unknown` (e.g. from Prisma's JsonValue) and returns a valid
 * matrix, discarding unknown keys/roles. Returns null if the input can't
 * be read as an object.
 */
export function coerceMatrix(input: unknown): PermissionMatrix | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const out = {} as PermissionMatrix;
  for (const feature of EVENT_FEATURES) {
    const value = raw[feature];
    if (!Array.isArray(value)) {
      out[feature] = feature === 'recording_control' ? ['MODERATOR'] : ['MODERATOR'];
      continue;
    }
    out[feature] = value.filter(
      (r): r is EventRole => typeof r === 'string' && (EVENT_ROLES as readonly string[]).includes(r),
    );
  }
  return withModeratorInvariant(out);
}

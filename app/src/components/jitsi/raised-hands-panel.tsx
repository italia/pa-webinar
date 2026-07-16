'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Icon } from 'design-react-kit';

import type { JitsiMeetExternalAPI } from '@/types/jitsi';

import { resolveDisplayName, RETRY_DELAYS_MS } from './raised-hands-resolve';

interface RaisedHand {
  id: string;
  displayName: string;
  raisedAt: number;
  /** Jitsi's raise timestamp (evt.handRaised) — a value shared across all
   *  clients for this raise. Sent with a "lower hand" so the target only
   *  lowers THIS raise, never a later one it re-raised in the meantime. */
  raiseId: number;
}

interface RaisedHandsPanelProps {
  api: JitsiMeetExternalAPI | null;
  /**
   * Display name of the local participant (from our pre-join flow / JWT).
   * Jitsi's `getParticipantsInfo()` returns **remote** participants only,
   * so when the local moderator raises their own hand the lookup by ID
   * comes back empty and the UI falls back to "Partecipante". Passing
   * the name down lets us short-circuit the lookup for the local ID.
   */
  localDisplayName?: string;
  /**
   * When true, hides the "approve mic" / "approve video" action buttons
   * — used to show the same ordered queue to all attendees, so everyone
   *   can see who raised their hand and in what order (addresses the
   *   caffettino feedback where only moderators had this visibility).
   */
  readOnly?: boolean;
  /**
   * F8 — moderator "lower hand": passed ONLY to the full (non-readOnly)
   * moderator instance. When both are present the panel shows an "abbassa
   * mano" button that asks the raiser's own client (via the control channel)
   * to lower its hand. The readOnly attendee instance gets neither, so the
   * button never renders for participants.
   */
  eventId?: string;
  moderatorToken?: string;
}

export default function RaisedHandsPanel({
  api,
  localDisplayName = '',
  readOnly = false,
  eventId,
  moderatorToken,
}: RaisedHandsPanelProps) {
  const t = useTranslations('live.moderator');
  const [hands, setHands] = useState<RaisedHand[]>([]);
  const handsRef = useRef<Map<string, RaisedHand>>(new Map());
  const localIdRef = useRef<string | null>(null);
  const [, setTick] = useState(0);

  const syncHands = useCallback(() => {
    const arr = Array.from(handsRef.current.values()).sort(
      (a, b) => a.raisedAt - b.raisedAt,
    );
    setHands(arr);
  }, []);

  useEffect(() => {
    if (!api) return;

    const retryTimers = new Set<ReturnType<typeof setTimeout>>();

    // Capture the local participant id as soon as Jitsi joins the
    // conference — needed to map a local "raiseHandUpdated" event back
    // to the name we already know (getParticipantsInfo excludes self).
    const onConferenceJoined = (evt: { id: string }) => {
      localIdRef.current = evt.id;
    };

    // For moderators the panel mounts *lazily*, i.e. after
    // `videoConferenceJoined` has already fired, so the listener above
    // never runs and `localIdRef` would stay null — leaving the
    // moderator's own raised hand resolving to empty (getParticipantsInfo
    // excludes self, so the scan can't recover it either). The
    // getDisplayName accessor used inside resolveDisplayName still works
    // for self in most Jitsi builds, and the staggered retries + periodic
    // sweep below give late presence another chance; the localDisplayName
    // short-circuit additionally kicks in once the local id is known.

    // Schedule staggered re-resolves for an entry whose name is still empty
    // (MUC presence in JWT rooms arrives after the raiseHandUpdated event).
    const scheduleRetries = (id: string) => {
      RETRY_DELAYS_MS.forEach((delay) => {
        const timer = setTimeout(() => {
          retryTimers.delete(timer);
          const entry = handsRef.current.get(id);
          if (!entry || entry.displayName) return; // gone or already resolved
          const retried = resolveDisplayName(api, id, localIdRef.current, localDisplayName);
          if (retried) {
            handsRef.current.set(id, { ...entry, displayName: retried });
            syncHands();
          }
        }, delay);
        retryTimers.add(timer);
      });
    };

    const onRaiseHand = (evt: { id: string; handRaised: number }) => {
      if (evt.handRaised > 0) {
        const name = resolveDisplayName(api, evt.id, localIdRef.current, localDisplayName);
        handsRef.current.set(evt.id, {
          id: evt.id,
          displayName: name,
          raisedAt: Date.now(),
          raiseId: evt.handRaised,
        });
        syncHands();

        // If name was empty, retry after MUC presence propagates.
        if (!name) {
          scheduleRetries(evt.id);
        }
      } else {
        handsRef.current.delete(evt.id);
        syncHands();
      }
    };

    const onParticipantLeft = (evt: { id: string }) => {
      handsRef.current.delete(evt.id);
      syncHands();
    };

    // Update display names when they change (handles late JWT propagation)
    const onDisplayNameChange = (evt: { id: string; displayname: string }) => {
      const entry = handsRef.current.get(evt.id);
      if (entry && evt.displayname) {
        handsRef.current.set(evt.id, { ...entry, displayName: evt.displayname });
        syncHands();
      }
    };

    api.addListener('videoConferenceJoined', onConferenceJoined);
    api.addListener('raiseHandUpdated', onRaiseHand);
    api.addListener('participantLeft', onParticipantLeft);
    api.addListener('displayNameChange', onDisplayNameChange);

    return () => {
      retryTimers.forEach(clearTimeout);
      retryTimers.clear();
      api.removeListener('videoConferenceJoined', onConferenceJoined);
      api.removeListener('raiseHandUpdated', onRaiseHand);
      api.removeListener('participantLeft', onParticipantLeft);
      api.removeListener('displayNameChange', onDisplayNameChange);
    };
  }, [api, syncHands, localDisplayName]);

  // Refresh elapsed-time display periodically, and on every tick re-resolve
  // any raiser whose name is still empty. `displayNameChange` only fires on
  // an explicit name *change*, not on the initial MUC presence that
  // populates JWT rooms — this sweep closes that gap for names that arrived
  // after the staggered retries gave up.
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((n) => n + 1);
      if (!api) return;
      let changed = false;
      for (const [id, entry] of handsRef.current) {
        if (entry.displayName) continue;
        const resolved = resolveDisplayName(api, id, localIdRef.current, localDisplayName);
        if (resolved) {
          handsRef.current.set(id, { ...entry, displayName: resolved });
          changed = true;
        }
      }
      if (changed) syncHands();
    }, 10_000);
    return () => clearInterval(interval);
  }, [api, syncHands, localDisplayName]);

  const handleApproveAll = useCallback(
    (id: string) => {
      if (!api) return;
      api.executeCommand('askToUnmute', id);
      api.executeCommand('approveVideo', id);
    },
    [api],
  );

  const handleApproveAudioOnly = useCallback(
    (id: string) => {
      if (!api) return;
      api.executeCommand('askToUnmute', id);
    },
    [api],
  );

  // F8: ask the raiser's OWN client to lower its hand (the IFrame API can't
  // lower a remote hand). Fire-and-forget: we do NOT optimistically remove the
  // entry here — that would desync the moderator's view from the other panels
  // (the flaw of the earlier "mark handled" attempt). When the target lowers
  // its hand, Jitsi's raiseHandUpdated(0) removes the entry from EVERY panel
  // naturally. If the signal doesn't deliver (offline / stale id), the hand
  // stays queued (correct — it wasn't lowered) and the moderator can retry.
  const handleLowerHand = useCallback(
    (id: string, raiseId: number) => {
      if (!eventId || !moderatorToken) return;
      fetch(`/api/events/${eventId}/hand-raises/lower`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({ targetEndpointId: id, raiseId }),
      }).catch(() => {
        /* best-effort, like chat; moderator can click again */
      });
    },
    [eventId, moderatorToken],
  );

  const canLowerHand = !readOnly && !!eventId && !!moderatorToken;

  if (hands.length === 0) {
    // In read-only mode (visible to non-moderators) hide completely when
    // nobody has raised a hand — a permanent "nessuna mano alzata" strip
    // would be visual noise for ordinary attendees. Moderators still get
    // the placeholder so they know the widget is alive.
    if (readOnly) return null;
    return (
      <div
        className="text-white px-3 py-2 small text-center"
        style={{ background: 'rgba(26,26,46,0.85)' }}
      >
        {t('noRaisedHands')}
      </div>
    );
  }

  return (
    <div
      className="text-white px-3 py-2"
      style={{ background: 'rgba(26,26,46,0.85)' }}
    >
      <div className="d-flex flex-wrap gap-2 align-items-center">
        {hands.map((h, idx) => {
          const elapsed = Math.floor((Date.now() - h.raisedAt) / 1000);
          const mins = Math.floor(elapsed / 60);
          const secs = elapsed % 60;
          const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

          return (
            <div
              key={h.id}
              className="d-flex align-items-center gap-1 rounded px-2 py-1"
              style={{ backgroundColor: 'rgba(255,193,7,0.2)' }}
            >
              <span
                className="badge rounded-pill"
                style={{
                  fontSize: '0.65rem',
                  backgroundColor: idx === 0 ? '#0066CC' : 'rgba(255,255,255,0.2)',
                  color: '#fff',
                  minWidth: 18,
                }}
                aria-label={`posizione ${idx + 1}`}
                title={`Posizione ${idx + 1} in coda`}
              >
                #{idx + 1}
              </span>
              <span style={{ fontSize: '0.9rem' }}>&#9995;</span>
              <span className="small fw-semibold">
                {h.displayName || t('participantFallback')}
              </span>
              <span className="small" style={{ color: 'rgba(255,255,255,0.6)' }}>
                ({timeStr})
              </span>
              {!readOnly && (
                <>
                  <Button
                    color="success"
                    size="xs"
                    className="px-1 py-0 ms-1"
                    onClick={() => handleApproveAll(h.id)}
                    aria-label={t('approveAll')}
                    title={t('approveAll')}
                    style={{ lineHeight: 1 }}
                  >
                    <Icon icon="it-microphone" size="xs" />
                  </Button>
                  <Button
                    color="light"
                    size="xs"
                    className="px-1 py-0"
                    onClick={() => handleApproveAudioOnly(h.id)}
                    aria-label={t('audioOnly')}
                    title={t('audioOnly')}
                    style={{ lineHeight: 1, fontSize: '0.65rem' }}
                  >
                    <Icon icon="it-hearing" size="xs" />
                  </Button>
                  {canLowerHand && (
                    <Button
                      color="primary"
                      size="xs"
                      className="px-1 py-0"
                      onClick={() => handleLowerHand(h.id, h.raiseId)}
                      aria-label={t('lowerHand')}
                      title={t('lowerHand')}
                      style={{ lineHeight: 1 }}
                    >
                      <Icon icon="it-check" size="xs" />
                    </Button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef } from 'react';

import { useRouter } from '@/i18n/navigation';

/**
 * Slides the admin session (POST /api/admin/refresh) while an admin is actively
 * working, so a long event-management session never expires mid-work — and, if
 * the session HAS expired (server returns 401), sends the operator straight to
 * the login screen instead of leaving a half-authorized admin UI.
 *
 * Design:
 *  - Refresh only when the tab is VISIBLE and there has been user activity in
 *    the last ACTIVITY_WINDOW. A walked-away laptop (no interaction) therefore
 *    stops refreshing and the session decays to its idle TTL ceiling.
 *  - On a 401 from the refresh (session already gone), redirect to /admin/login.
 *  - Also runs one attempt on refocus, so returning to a tab whose session
 *    lapsed while it was hidden bounces to login immediately.
 *
 * Mounted only for authenticated admins (see admin/layout.tsx).
 */
const INTERVAL_MS = 10 * 60_000; // check every 10 min
const ACTIVITY_WINDOW_MS = 30 * 60_000; // refresh only if active in the last 30 min

export default function AdminSessionKeepAlive() {
  const router = useRouter();
  const lastActivityRef = useRef(Date.now());
  const inFlightRef = useRef(false);

  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    activityEvents.forEach((e) =>
      window.addEventListener(e, bump, { passive: true }),
    );

    const attempt = async () => {
      if (inFlightRef.current) return;
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivityRef.current > ACTIVITY_WINDOW_MS) return;
      inFlightRef.current = true;
      try {
        const res = await fetch('/api/admin/refresh', {
          method: 'POST',
          cache: 'no-store',
        });
        if (res.status === 401) {
          router.replace('/admin/login');
        }
      } catch {
        /* transient network error — try again on the next tick */
      } finally {
        inFlightRef.current = false;
      }
    };

    const id = setInterval(attempt, INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        // Returning to the tab counts as activity; attempt a refresh so an
        // expired-while-hidden session redirects to login right away.
        lastActivityRef.current = Date.now();
        void attempt();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      activityEvents.forEach((e) => window.removeEventListener(e, bump));
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return null;
}

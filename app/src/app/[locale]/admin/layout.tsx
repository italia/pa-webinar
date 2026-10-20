import type { ReactNode } from 'react';
import { cookies } from 'next/headers';

import { getStaffSession } from '@/lib/auth/staff-session';
import AdminNav from '@/components/admin/admin-nav';
import AdminBreadcrumb from '@/components/admin/admin-breadcrumb';
import AdminSessionKeepAlive from '@/components/admin/admin-session-keepalive';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { UploadsAvailabilityProvider } from '@/components/ui/uploads-availability';
import { getFilesStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

interface AdminLayoutProps {
  children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const cookieStore = await cookies();
  // Menu e briciole per tutto lo staff; il menu sa quale ruolo ha davanti
  // (ADR-014).
  const session = await getStaffSession(cookieStore);
  // Il caricamento di file chiede lo storage e una sessione dello staff (la
  // rotta lo pretende): con il solo link di conduzione si incolla un link.
  const senzaCaricamento =
    getFilesStorage() === null ? 'storage' : session ? null : 'sessione';

  return (
    <ToastProvider>
      <ConfirmProvider>
        {session && (
          <>
            <AdminSessionKeepAlive />
            <AdminNav role={session.role} />
            <AdminBreadcrumb role={session.role} />
          </>
        )}
        {/* Dove non si puo' caricare, i campi «file o link» offrono il link. */}
        <UploadsAvailabilityProvider
          available={senzaCaricamento === null}
          reason={senzaCaricamento}
        >
          {/* Il bersaglio del «vai al contenuto della pagina» del menu. */}
          <div id="admin-content" className="admin-form-surface" tabIndex={-1}>
            {children}
          </div>
        </UploadsAvailabilityProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

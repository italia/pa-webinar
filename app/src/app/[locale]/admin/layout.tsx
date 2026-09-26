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

  return (
    <ToastProvider>
      <ConfirmProvider>
        {session && (
          <>
            <AdminSessionKeepAlive />
            <AdminNav role={session.role} />
            <AdminBreadcrumb />
          </>
        )}
        {/* Senza storage per i file i campi "file o URL" offrono solo l'URL. */}
        <UploadsAvailabilityProvider available={getFilesStorage() !== null}>
          <div className="admin-form-surface">{children}</div>
        </UploadsAvailabilityProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

import type { ReactNode } from 'react';
import { cookies } from 'next/headers';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import AdminNav from '@/components/admin/admin-nav';
import AdminBreadcrumb from '@/components/admin/admin-breadcrumb';

export const dynamic = 'force-dynamic';

interface AdminLayoutProps {
  children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const cookieStore = await cookies();
  const isAdmin = await isAdminAuthenticated(cookieStore);

  return (
    <>
      {isAdmin && (
        <>
          <AdminNav />
          <AdminBreadcrumb />
        </>
      )}
      {children}
    </>
  );
}

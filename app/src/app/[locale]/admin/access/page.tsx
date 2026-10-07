import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import StaffAccess from '@/components/admin/staff-access';

interface Props {
  searchParams: Promise<{ t?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.staffLogin');
  return { title: t('title') };
}

export default async function StaffAccessPage({ searchParams }: Props) {
  const { t } = await searchParams;
  return <StaffAccess token={t ?? ''} />;
}

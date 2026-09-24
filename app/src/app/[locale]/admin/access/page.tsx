import StaffAccess from '@/components/admin/staff-access';

interface Props {
  searchParams: Promise<{ t?: string }>;
}

export default async function StaffAccessPage({ searchParams }: Props) {
  const { t } = await searchParams;
  return <StaffAccess token={t ?? ''} />;
}

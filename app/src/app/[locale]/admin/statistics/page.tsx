import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';

export default async function AnalyticsRedirect() {
  const locale = await getLocale();
  redirect(`/${locale}/admin/events/statistics`);
}

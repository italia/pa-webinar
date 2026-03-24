'use client';

import { useTranslations } from 'next-intl';
import { Badge } from 'design-react-kit';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'secondary',
  PUBLISHED: 'primary',
  LIVE: 'success',
  ENDED: 'warning',
  ARCHIVED: 'dark',
};

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const t = useTranslations('events.status');
  const color = STATUS_COLORS[status] ?? 'secondary';

  return (
    <Badge color={color} pill className="px-3 py-1">
      {t(status as 'DRAFT' | 'PUBLISHED' | 'LIVE' | 'ENDED' | 'ARCHIVED')}
    </Badge>
  );
}

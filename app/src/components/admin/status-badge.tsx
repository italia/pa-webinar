'use client';

import { useTranslations } from 'next-intl';
import { Badge } from 'design-react-kit';

/** Ogni valore di `EventStatus`, con il colore del badge. */
const STATUS_COLORS = {
  DRAFT: 'secondary',
  PUBLISHED: 'primary',
  PROVISIONING: 'info',
  LIVE: 'success',
  IDLE: 'info',
  ENDED: 'warning',
  ARCHIVED: 'dark',
} as const;

type KnownStatus = keyof typeof STATUS_COLORS;

function isKnownStatus(status: string): status is KnownStatus {
  return Object.prototype.hasOwnProperty.call(STATUS_COLORS, status);
}

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const t = useTranslations('events.status');
  const known = isKnownStatus(status);

  return (
    <Badge color={known ? STATUS_COLORS[status] : 'secondary'} pill className="px-3 py-1">
      {known ? t(status) : status}
    </Badge>
  );
}

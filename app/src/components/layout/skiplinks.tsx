'use client';

import { useTranslations } from 'next-intl';
import {
  Skiplink as SkiplinkBase,
  SkiplinkItem as SkiplinkItemBase,
} from 'design-react-kit';

export function Skiplink() {
  const t = useTranslations('nav');

  return (
    <SkiplinkBase>
      <SkiplinkItemBase href="#main-content">
        {t('skipToContent')}
      </SkiplinkItemBase>
      <SkiplinkItemBase href="#footer">
        {t('skipToFooter')}
      </SkiplinkItemBase>
    </SkiplinkBase>
  );
}

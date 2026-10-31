'use client';

import { useTranslations } from 'next-intl';

/**
 * I ruoli dell'evento, dal piu' ampio, con che cosa fa ciascuno. Sta nel
 * passo in cui si decide chi ha quale ruolo, sempre in vista: non dentro un
 * menu, ne' in un altro passo.
 */
export default function RuoliEvento() {
  const t = useTranslations('admin.wizard.step2');
  return (
    <section className="wizard-roles mb-4" aria-labelledby="wiz-roles-title">
      <h3
        id="wiz-roles-title"
        className="h6 fw-semibold mb-2"
        style={{ color: 'var(--app-text)' }}
      >
        {t('rolesHeading')}
      </h3>
      <dl className="wizard-roles__list mb-0">
        {(['organizer', 'moderator', 'speaker', 'guest'] as const).map((r) => (
          <div key={r} className="wizard-roles__item">
            <dt>{t(`roleInfo.${r}.name`)}</dt>
            <dd>{t(`roleInfo.${r}.desc`)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

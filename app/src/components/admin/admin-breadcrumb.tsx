'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Link, percorso, usePathname } from '@/i18n/navigation';

import { catena, type StaffRole } from './admin-nav-model';

/**
 * Le briciole: sezione, voce, dettaglio, dalla stessa struttura del menu.
 * Una pagina d'ingresso di sezione non ne ha: il menu basta a orientarsi.
 */
export default function AdminBreadcrumb({ role = 'admin' }: { role?: StaffRole }) {
  const pathname = usePathname();
  const params = useParams<Record<string, string>>() ?? {};
  const searchParams = useSearchParams();
  const t = useTranslations('admin.nav');

  // Chi e' entrato col link del moderatore (`?token=`) non ha accesso alle
  // pagine dello staff: le briciole porterebbero a pagine negate.
  if (searchParams?.get('token')) return null;

  const anelli = catena(pathname, role);
  if (anelli.length < 2) return null;

  // Un anello con segnaposto (il singolo evento, sopra la sua modifica) si
  // riempie con i parametri dell'indirizzo corrente; la mappa del router fa
  // il resto.
  const href = (pattern: string) =>
    percorso(pattern.replace(/\[([^\]]+)\]/g, (_, nome: string) => encodeURIComponent(params[nome] ?? '')));

  return (
    <nav className="admin-breadcrumb" aria-label={t('breadcrumbAriaLabel')}>
      <div className="container">
        <ol className="breadcrumb mb-0">
          {anelli.map((a, i) => {
            const ultimo = i === anelli.length - 1;
            return (
              <li
                key={`${a.labelKey}-${i}`}
                className={`breadcrumb-item${ultimo ? ' active' : ''}`}
                aria-current={ultimo ? 'page' : undefined}
              >
                {ultimo ? t(a.labelKey) : <Link href={href(a.href)}>{t(a.labelKey)}</Link>}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

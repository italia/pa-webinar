import type { ReactNode } from 'react';

/**
 * L'intestazione di ogni pagina dell'amministrazione: titolo, sottotitolo,
 * azioni. Una sola forma, invece di cinque varianti di h1 con margini e colori
 * diversi; il titolo e' di norma il nome della pagina nel menu
 * (`adminPageTitle`), cosi' menu, briciole e titolo dicono la stessa cosa.
 */
export default function AdminPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="admin-page-header">
      <div className="admin-page-header__text">
        <h1 className="admin-page-header__title">{title}</h1>
        {subtitle && <p className="admin-page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="admin-page-header__actions">{actions}</div>}
    </header>
  );
}

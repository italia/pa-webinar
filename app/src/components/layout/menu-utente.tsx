'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { useTendina } from '@/hooks/use-tendina';
import { Link, usePathname, useRouter } from '@/i18n/navigation';

export interface StaffIntestazione {
  ruolo: 'admin' | 'organizer';
  /** Il nome dell'account; null con la chiave dell'istanza. */
  nome: string | null;
}

function iniziali(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => (Array.from(p)[0] ?? '').toUpperCase())
    .join('');
}

/**
 * L'area utente dello slim header, come nell'header completo dei modelli di
 * Designers Italia: chi e' entrato (nome e ruolo), l'amministrazione e
 * l'uscita. Su ogni pagina, pubblica o dell'amministrazione.
 */
export default function MenuUtente({ staff }: { staff: StaffIntestazione }) {
  const t = useTranslations('nav');
  const tLogin = useTranslations('admin.login');
  const router = useRouter();
  const { aperta, setAperta, chiudi, contenitore, pulsante } = useTendina();
  const id = useId();
  const nome = staff.nome?.trim() || t('instanceKey');
  const ruolo = staff.ruolo === 'admin' ? t('roleAdmin') : t('roleOrganizer');
  const [uscitaFallita, setUscitaFallita] = useState(false);
  // Si chiude cambiando pagina, e l'errore di un'uscita mancata non resta.
  const pathname = usePathname();
  useEffect(() => {
    chiudi();
  }, [pathname, chiudi]);
  useEffect(() => {
    if (!aperta) setUscitaFallita(false);
  }, [aperta]);

  async function esci() {
    setUscitaFallita(false);
    // Uscire deve funzionare: se il server non risponde lo si dice, nella
    // tendina, e la pagina non finge che la sessione sia chiusa.
    const ok = await fetch('/api/admin/logout', { method: 'POST' }).then(
      (r) => r.ok,
      () => false
    );
    if (!ok) {
      setUscitaFallita(true);
      return;
    }
    chiudi();
    router.push('/admin/login');
    router.refresh();
  }

  return (
    <div ref={contenitore} className="it-access-top-wrapper ms-3 dropdown menu-utente">
      <button
        ref={pulsante}
        type="button"
        className="btn btn-primary btn-icon btn-full menu-utente__pulsante"
        aria-expanded={aperta}
        aria-controls={id}
        onClick={() => setAperta(!aperta)}
      >
        <span className="rounded-icon menu-utente__iniziali" aria-hidden="true">
          {staff.nome?.trim() ? (
            iniziali(staff.nome)
          ) : (
            <Icon icon="it-key" size="xs" color="primary" />
          )}
        </span>
        <span className="d-none d-lg-inline">{nome}</span>
        <span className="visually-hidden d-lg-none">{nome}</span>
        <span className="visually-hidden">{`, ${ruolo}`}</span>
        <Icon icon="it-expand" size="xs" color="white" className="d-none d-lg-inline" />
      </button>
      <div
        className={`dropdown-menu menu-utente__elenco${aperta ? ' show' : ''}`}
        id={id}
      >
        <div className="link-list-wrapper">
          <ul className="link-list">
            <li>
              <span className="list-item menu-utente__chi" aria-hidden="true">
                <strong>{nome}</strong>
                <small>{ruolo}</small>
              </span>
            </li>
            <li>
              <span className="divider" />
            </li>
            <li>
              <Link
                href="/admin/events"
                className="dropdown-item list-item"
                onClick={chiudi}
              >
                <Icon icon="it-tool" size="sm" className="me-2" />
                <span>{t('admin')}</span>
              </Link>
            </li>
            <li>
              <button type="button" className="dropdown-item list-item" onClick={esci}>
                <Icon icon="it-logout" size="sm" className="me-2" />
                <span>{tLogin('logout')}</span>
              </button>
            </li>
            {uscitaFallita && (
              <li>
                <p className="small text-danger px-3 mb-0" role="alert">
                  {t('signOutFailed')}
                </p>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

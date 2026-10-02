import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// Il modulo del menu e' un componente: qui servono solo le sue costanti.
vi.mock('@/i18n/navigation', () => ({ Link: () => null, usePathname: () => '/admin' }));
vi.mock('@/components/admin/admin-logout-button', () => ({ default: () => null }));

import {
  LINK_INTESTAZIONE,
  LINK_PIEDE_EVENTI,
} from '@/components/layout/public-links';
import { routing } from '@/i18n/routing';

import {
  EVENTS_SUB_NAV,
  MAIN_SECTIONS,
  MONITORING_SUB_NAV,
  PUBLICATIONS_SUB_NAV,
  QUESTIONNAIRES_SUB_NAV,
  RECORDINGS_SUB_NAV,
  REGISTRATIONS_SUB_NAV,
  SETTINGS_SUB_NAV,
  STAFF_SUB_NAV,
} from './admin-nav';

/**
 * Raggiungibilita': ogni pagina ha un link che ci porta. Il test diventa rosso
 * quando una pagina nuova nasce orfana o quando si toglie l'ultimo link verso
 * una pagina esistente.
 */

const RIGHE_ADMIN = {
  MAIN_SECTIONS,
  EVENTS_SUB_NAV,
  REGISTRATIONS_SUB_NAV,
  STAFF_SUB_NAV,
  RECORDINGS_SUB_NAV,
  PUBLICATIONS_SUB_NAV,
  MONITORING_SUB_NAV,
  SETTINGS_SUB_NAV,
  QUESTIONNAIRES_SUB_NAV,
};

const percorsiStatici = Object.keys(routing.pathnames).filter((p) => !p.includes('['));

/** Pagine admin raggiunte da altro che il menu, con il perche'. */
const ESENZIONI_ADMIN: Record<string, string> = {
  '/admin': 'home dello staff: link «Amministrazione» nell’intestazione',
  '/admin/login': 'accesso: ci porta il middleware',
  '/admin/access': 'atterraggio del link monouso arrivato per email',
};

/** Pagine pubbliche raggiunte da altro che intestazione e piè di pagina. */
const ESENZIONI_PUBBLICHE: Record<string, string> = {
  '/privacy/my-data/erasure': 'raggiunta da «I miei dati»',
  '/rubrica/opt-out': 'link nelle email della rubrica',
};

describe('menu dello staff', () => {
  it('ogni pagina statica /admin sta nel menu o fra le esenzioni', () => {
    const nelMenu = new Set(Object.values(RIGHE_ADMIN).flat().map((v) => v.href as string));
    const orfane = percorsiStatici
      .filter((p) => p === '/admin' || p.startsWith('/admin/'))
      .filter((p) => !nelMenu.has(p) && !(p in ESENZIONI_ADMIN));
    expect(orfane).toEqual([]);
  });

  it('«Staff e accessi» è una voce di primo livello e porta alle utenze', () => {
    const voce = MAIN_SECTIONS.find((v) => v.labelKey === 'staffAccess');
    expect(voce?.href).toBe('/admin/organizers');
    expect(STAFF_SUB_NAV.map((v) => v.href)).toEqual(['/admin/organizers', '/admin/moderators']);
    // Il sotto-menu delle persone non porta piu' alle chiavi dello staff.
    const persone = REGISTRATIONS_SUB_NAV.map((v) => v.href as string);
    expect(persone).not.toContain('/admin/organizers');
    expect(persone).not.toContain('/admin/moderators');
  });

  it.each(Object.entries(RIGHE_ADMIN))('in %s nessuna icona si ripete', (_nome, riga) => {
    const icone = riga.map((v) => v.icon);
    expect(new Set(icone).size).toBe(icone.length);
  });
});

describe('navigazione del sito pubblico', () => {
  const sorgente = ['pa-header.tsx', 'pa-footer.tsx']
    .map((f) => readFileSync(path.join(__dirname, '../layout', f), 'utf8'))
    .join('\n');

  it('ogni pagina pubblica statica ha un link in intestazione o piè di pagina', () => {
    const neiLink = new Set(
      [...LINK_INTESTAZIONE, ...LINK_PIEDE_EVENTI].map((l) => l.href as string),
    );
    const orfane = percorsiStatici
      .filter((p) => p !== '/admin' && !p.startsWith('/admin/'))
      .filter(
        (p) =>
          !neiLink.has(p) && !sorgente.includes(`href="${p}"`) && !(p in ESENZIONI_PUBBLICHE),
      );
    expect(orfane).toEqual([]);
  });

  it('il calendario compare in intestazione solo se è pubblico', () => {
    const calendario = LINK_INTESTAZIONE.find((l) => l.href === '/calendar');
    expect(calendario?.soloSe).toBe('calendarPublic');
  });
});

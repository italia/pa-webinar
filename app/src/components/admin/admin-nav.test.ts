import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LINK_INTESTAZIONE,
  LINK_PIEDE_EVENTI,
} from '@/components/layout/public-links';
import messages from '@/i18n/messages/it.json';
import { routing } from '@/i18n/routing';

import {
  SEZIONI,
  VOCI_ORGANIZZATORE,
  catena,
  nomePagina,
  sezioniPerRuolo,
} from './admin-nav-model';

/**
 * Raggiungibilita': ogni pagina ha un link che ci porta. Il test diventa rosso
 * quando una pagina nuova nasce orfana o quando si toglie l'ultimo link verso
 * una pagina esistente.
 */

const percorsiStatici = Object.keys(routing.pathnames).filter((p) => !p.includes('['));

/** Pagine admin raggiunte da altro che il menu, con il perche'. */
const ESENZIONI_ADMIN: Record<string, string> = {
  '/admin': 'ingresso: rimanda all’elenco degli eventi',
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
    const nelMenu = new Set(SEZIONI.flatMap((s) => [s.href, ...s.voci.map((v) => v.href)]) as string[]);
    const orfane = percorsiStatici
      .filter((p) => p === '/admin' || p.startsWith('/admin/'))
      .filter((p) => !nelMenu.has(p) && !(p in ESENZIONI_ADMIN));
    expect(orfane).toEqual([]);
  });

  it('ogni sezione porta a una delle sue voci, e ogni voce sta sotto una sua radice', () => {
    for (const s of SEZIONI) {
      expect(s.voci.map((v) => v.href)).toContain(s.href);
      for (const v of s.voci) {
        expect(s.radici.some((r) => v.href === r || v.href.startsWith(`${r}/`))).toBe(true);
      }
    }
  });

  it('nessuna icona si ripete fra intestazione, sezioni e voci di una stessa sezione', () => {
    // L'intestazione mostra i link pubblici e «Amministrazione».
    const intestazione = [...LINK_INTESTAZIONE.map((l) => l.icon), 'it-tool'].filter(Boolean);
    const sezioni = SEZIONI.map((s) => s.icon);
    expect(new Set(sezioni).size).toBe(sezioni.length);
    for (const s of SEZIONI) {
      const visibili = [...intestazione, ...sezioni, ...s.voci.map((v) => v.icon)];
      expect(new Set(visibili).size, s.labelKey).toBe(visibili.length);
    }
  });

  it('chi organizza vede eventi e video, con il glossario', () => {
    const sezioni = sezioniPerRuolo('organizer');
    expect(sezioni.map((s) => s.labelKey)).toEqual(['events', 'video']);
    expect(sezioni.flatMap((s) => s.voci.map((v) => v.href))).toEqual([...VOCI_ORGANIZZATORE]);
  });

  it('le briciole seguono il menu, anche per le pagine fuori dalla radice della sezione', () => {
    expect(catena('/admin/events').map((a) => a.labelKey)).toEqual(['events']);
    expect(catena('/admin/calendar').map((a) => a.labelKey)).toEqual(['events', 'calendar']);
    expect(catena('/admin/events/[id]/edit').map((a) => a.labelKey)).toEqual([
      'events',
      'eventDetail',
      'eventEdit',
    ]);
    expect(catena('/admin/rubrica/[id]').map((a) => a.labelKey)).toEqual([
      'people',
      'rubrica',
      'rubricaDetail',
    ]);
    expect(catena('/admin/glossary', 'organizer').map((a) => a.labelKey)).toEqual(['video', 'glossary']);
    expect(catena('/admin/publications/new').map((a) => a.labelKey)).toEqual(['video', 'publicationsNew']);
    // Chi organizza non ha la sezione delle impostazioni.
    expect(catena('/admin/settings/tags', 'organizer')).toEqual([]);
    expect(nomePagina('/admin/settings')).toBe('settingsGeneral');
    expect(nomePagina('/admin/events')).toBe('eventsList');
    expect(nomePagina('/admin/events/[id]')).toBe('eventDetail');
  });

  it('ogni etichetta del menu esiste fra i messaggi', () => {
    const nav = (messages as { admin: { nav: Record<string, string> } }).admin.nav;
    const chiavi = SEZIONI.flatMap((s) => [s.labelKey, ...s.voci.map((v) => v.labelKey)]);
    for (const k of chiavi) expect(nav[k], k).toBeTruthy();
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

import { describe, it, expect } from 'vitest';

import { routing } from '@/i18n/routing';

import { localizedPath, localizedUrl } from './localized-url';

describe('localizedPath', () => {
  it('traduce i segmenti per l’italiano e lascia l’inglese com’è', () => {
    expect(localizedPath('/events/incontro', 'it')).toBe('/it/eventi/incontro');
    expect(localizedPath('/events/incontro', 'en')).toBe('/en/events/incontro');
  });

  it('le sottopagine seguono la pagina madre', () => {
    // Era il difetto: l'helper traduceva `/events` in `/eventi` per intero,
    // ma il router non conosceva `/eventi/<slug>/password`, e il link portava
    // a un 404.
    expect(localizedPath('/events/x/password', 'it')).toBe('/it/eventi/x/password');
    expect(localizedPath('/events/x/questionnaire/POST_EVENT', 'it')).toBe(
      '/it/eventi/x/questionario/POST_EVENT',
    );
    expect(localizedPath('/privacy/my-data/erasure', 'it')).toBe(
      '/it/privacy/i-miei-dati/cancellazione',
    );
  });

  it('query e frammento passano intatti', () => {
    expect(localizedPath('/events/x/live?token=abc', 'it')).toBe('/it/eventi/x/live?token=abc');
    expect(localizedPath('/events/x#programma', 'it')).toBe('/it/eventi/x#programma');
  });

  it('usa la stessa mappa del router, compresi i segmenti che la vecchia tabella non aveva', () => {
    expect(localizedPath('/security', 'it')).toBe('/it/sicurezza');
    expect(localizedPath('/admin/events/calls', 'it')).toBe('/it/admin/eventi/chiamate-rapide');
  });

  it('un percorso sconosciuto passa com’è', () => {
    expect(localizedPath('/qualcosa/di/nuovo', 'it')).toBe('/it/qualcosa/di/nuovo');
  });

  it('una lingua senza traduzione propria usa il percorso interno', () => {
    expect(localizedPath('/events/x', 'fr')).toBe('/fr/events/x');
  });

  it('indirizzo completo', () => {
    expect(localizedUrl('https://webinar.example.it', '/events/x', 'it')).toBe(
      'https://webinar.example.it/it/eventi/x',
    );
  });
});

describe('mappa degli indirizzi', () => {
  it('ogni pagina dell’applicazione è dichiarata', async () => {
    // Una pagina non dichiarata vive solo al suo indirizzo inglese: il link
    // costruito dal router non compila, e quello scritto a mano in italiano
    // porta a un 404. Si aggiunge qui la riga nella mappa, non un'eccezione.
    const { readdirSync } = await import('node:fs');
    const path = await import('node:path');
    const radice = path.resolve(__dirname, '../../app/[locale]');
    const pagine = (readdirSync(radice, { recursive: true }) as string[])
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => f === 'page.tsx' || f.endsWith('/page.tsx'))
      .map((f) => '/' + f.replace(/\/?page\.tsx$/, ''))
      .map((f) => (f === '/' ? '/' : f.replace(/\/$/, '')))
      .sort();
    expect(pagine.length).toBeGreaterThan(20);
    const dichiarate = new Set(Object.keys(routing.pathnames));
    expect(pagine.filter((p) => !dichiarate.has(p))).toEqual([]);
  });
});

describe('riconoscimento delle forme localizzate', () => {
  it('un indirizzo già in italiano porta alla stessa pagina interna', async () => {
    // Le voci del footer si salvano come le vede chi le digita: se il
    // riconoscimento accettasse solo la forma inglese, `/accessibilita`
    // finirebbe trattato come un sito esterno.
    const { riconosci } = await import('@/i18n/percorsi');
    expect(riconosci('/accessibilita')?.pathname).toBe('/accessibility');
    expect(riconosci('/note-legali')?.pathname).toBe('/legal-notice');
    expect(riconosci('/eventi/x/registrazione')).toMatchObject({
      pathname: '/events/[slug]/registration',
      params: { slug: 'x' },
    });
    expect(riconosci('/admin/eventi/chiamate-rapide')?.pathname).toBe('/admin/events/calls');
  });
});

describe('indirizzi scritti a mano', () => {
  it('un % malformato non fa cadere chi disegna la pagina', async () => {
    const { riconosci } = await import('@/i18n/percorsi');
    expect(riconosci('/events/sconto-50%')).toMatchObject({
      pathname: '/events/[slug]',
      params: { slug: 'sconto-50%' },
    });
  });

  it('il frammento resta nell’indirizzo', async () => {
    const { riconosci } = await import('@/i18n/percorsi');
    expect(riconosci('/privacy#cookie')).toMatchObject({ pathname: '/privacy', hash: 'cookie' });
    expect(riconosci('/sconosciuto')).toBeNull();
  });
});

describe('briciole di pane', () => {
  it('ogni pagina dell’amministrazione ha un’etichetta', async () => {
    // Una pagina senza etichetta non compare nella catena: la breadcrumb
    // indicherebbe come pagina corrente la sezione madre, e il pulsante
    // «indietro» salterebbe un livello.
    const { readFileSync, readdirSync } = await import('node:fs');
    const path = await import('node:path');
    const sorgente = readFileSync(
      path.resolve(__dirname, '../../components/admin/admin-breadcrumb.tsx'),
      'utf-8',
    );
    const radice = path.resolve(__dirname, '../../app/[locale]/admin');
    const pagine = (readdirSync(radice, { recursive: true }) as string[])
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => f === 'page.tsx' || f.endsWith('/page.tsx'))
      .map((f) => ('/admin/' + f.replace(/\/?page\.tsx$/, '')).replace(/\/$/, ''))
      // Le porte d'ingresso non hanno briciole: non si sta dentro l'area.
      .filter((p) => p !== '/admin/login' && p !== '/admin/access');
    expect(pagine.filter((p) => !sorgente.includes(`'${p}':`))).toEqual([]);
  });
});

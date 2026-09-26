import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Presidio sui confini dei ruoli (ADR-014).
 *
 * Una rotta o una pagina dell'amministrazione nasce senza sapere del ruolo
 * organizzatore. Questi test pretendono che ognuna dichiari chi la usa, e che
 * aprirne una all'organizzatore sia una scelta scritta qui — non l'effetto
 * collaterale di una guardia copiata da un'altra rotta.
 */

const APP = path.resolve(__dirname, '../../app');

function file(dir: string, nome: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => f === nome || f.endsWith(`/${nome}`))
    .map((f) => path.join(dir, f));
}

const rel = (f: string) => path.relative(APP, f).replace(/\\/g, '/');

const GUARDIE_STAFF = /\b(requireStaff|requireEventManager|requireRecordingManager|requireSpeakerManager)\(/;
const GUARDIA_ADMIN = /\b(isAdminAuthenticated|requireAdmin)\(/;

/** Le rotte dell'area che l'organizzatore puo' usare, ciascuna col suo perche'. */
const ROTTE_ORGANIZZATORE: Record<string, string> = {
  'api/admin/assets/upload-url/route.ts': 'locandine e immagini dei propri eventi',
  'api/admin/events/bulk-archive/route.ts': 'filtrata sui propri eventi',
  'api/admin/events/bulk-delete/route.ts': 'filtrata sui propri eventi',
  'api/admin/events/instant/route.ts': 'le proprie chiamate rapide',
  'api/admin/events/[id]/analytics/route.ts': 'proprio evento',
  'api/admin/events/[id]/duplicate/route.ts': 'proprio evento; la copia e’ sua',
  'api/admin/events/[id]/generate-ai/route.ts': 'proprio evento',
  'api/admin/events/[id]/invitations/route.ts': 'proprio evento',
  'api/admin/events/[id]/invitations/[invId]/route.ts': 'proprio evento',
  'api/admin/events/[id]/materials/route.ts': 'proprio evento',
  'api/admin/events/[id]/materials/[materialId]/route.ts': 'proprio evento',
  'api/admin/events/[id]/questionnaires/route.ts': 'proprio evento',
  'api/admin/events/[id]/questionnaires/[placement]/route.ts': 'proprio evento',
  'api/admin/events/[id]/tags/route.ts': 'proprio evento',
  'api/admin/postprod/route.ts': 'registrazioni dei propri eventi',
  'api/admin/postprod/recordings/[id]/archive/route.ts': 'registrazione di un proprio evento',
  'api/admin/postprod/recordings/[id]/cancel/route.ts': 'registrazione di un proprio evento',
  'api/admin/postprod/recordings/[id]/details/route.ts': 'registrazione di un proprio evento',
  'api/admin/postprod/recordings/[id]/generate-ai/route.ts': 'registrazione di un proprio evento',
  'api/admin/postprod/recordings/[id]/media/route.ts': 'registrazione di un proprio evento',
  'api/admin/postprod/recordings/[id]/reliability/route.ts': 'registrazione di un proprio evento',
  'api/admin/postprod/recordings/[id]/rerun/route.ts': 'registrazione di un proprio evento',
  'api/admin/postprod/recordings/[id]/summary/route.ts': 'registrazione di un proprio evento',
  'api/admin/postprod/recordings/[id]/tracks/route.ts': 'registrazione di un proprio evento',
  'api/admin/postprod/recordings/[id]/transcript/route.ts': 'registrazione di un proprio evento',
  'api/admin/postprod/recordings/[id]/translations/route.ts': 'registrazione di un proprio evento',
  'api/admin/postprod/speakers/[id]/route.ts': 'relatore di un proprio evento',
  'api/admin/publications/upload-url/route.ts': 'firma il caricamento della registrazione',
  'api/admin/publications/upload-url/multipart/route.ts': 'chiude o annulla il caricamento della registrazione',
  'api/admin/publications/[id]/route.ts': 'PATCH: pubblicazione del proprio evento',
  'api/admin/question-templates/route.ts': 'solo lettura, per comporre i propri questionari',
  'api/admin/recordings/route.ts': 'registrazioni dei propri eventi',
  'api/admin/tags/route.ts': 'solo lettura, per etichettare i propri eventi',
};

/** Rotte dell'area senza guardia, ciascuna col suo perche'. */
const ROTTE_SENZA_GUARDIA: Record<string, string> = {
  'api/admin/login/route.ts': 'e’ la porta d’ingresso',
  'api/admin/logout/route.ts': 'chiude la sessione di chiunque',
  'api/admin/refresh/route.ts': 'rinnova la sessione che c’e’, col suo ruolo',
};

describe('rotte dell’amministrazione', () => {
  const rotte = file(path.join(APP, 'api/admin'), 'route.ts');

  it('ogni rotta dichiara chi la usa', () => {
    expect(rotte.length).toBeGreaterThan(50);
    const scoperte = rotte
      .filter((f) => !GUARDIA_ADMIN.test(readFileSync(f, 'utf-8')))
      .filter((f) => !GUARDIE_STAFF.test(readFileSync(f, 'utf-8')))
      .map(rel)
      .filter((r) => !(r in ROTTE_SENZA_GUARDIA));
    expect(scoperte).toEqual([]);
  });

  it('solo le rotte in elenco si aprono all’organizzatore', () => {
    const aperte = rotte
      .filter((f) => GUARDIE_STAFF.test(readFileSync(f, 'utf-8')))
      .map(rel)
      .sort();
    expect(aperte).toEqual(Object.keys(ROTTE_ORGANIZZATORE).sort());
  });
});

describe('pagine dell’amministrazione', () => {
  const pagine = file(path.join(APP, '[locale]/admin'), 'page.tsx');

  it('nessuna rimanda al login chi e’ gia’ entrato', () => {
    expect(pagine.length).toBeGreaterThan(30);
    // `isAdminAuthenticated` + rinvio al login era lo schema di ogni pagina:
    // con un organizzatore dentro diventa un giro senza uscita. Si usano
    // `soloAdmin` / `staffOLogin`, che distinguono «non entrato» da «non
    // abbastanza».
    const vecchie = pagine
      .filter((f) => GUARDIA_ADMIN.test(readFileSync(f, 'utf-8')))
      .map(rel);
    expect(vecchie).toEqual([]);
  });

  it('ogni pagina dichiara chi la vede', () => {
    const DICHIARA = /\b(soloAdmin|staffOLogin|getStaffSession)\(/;
    const ECCEZIONI: Record<string, string> = {
      '[locale]/admin/login/page.tsx': 'la porta d’ingresso',
      '[locale]/admin/access/page.tsx': 'l’atterraggio del link per email',
      '[locale]/admin/events/[id]/edit/page.tsx': 'si apre solo col token del moderatore',
    };
    const mute = pagine
      .map(rel)
      .filter((r) => !(r in ECCEZIONI))
      .filter((r) => !DICHIARA.test(readFileSync(path.join(APP, r), 'utf-8')));
    expect(mute).toEqual([]);
  });
});

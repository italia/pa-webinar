// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockManager, mockRegCount, mockEventAccess } = vi.hoisted(() => ({
  mockManager: vi.fn(),
  mockRegCount: vi.fn(),
  mockEventAccess: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { registration: { count: mockRegCount } } }));
vi.mock('@/lib/auth/staff-session', () => ({ isEventManager: mockManager }));
vi.mock('@/lib/auth/app-secret', () => ({
  tryGetAppSecret: () => 'segreto-di-prova-abbastanza-lungo-per-hmac',
}));
vi.mock('@/lib/event-session', () => ({
  eventAccessCookieName: (id: string) => `event_access_${id}`,
  verifyEventAccess: mockEventAccess,
}));

import {
  accessoRegistrazione,
  apertaAgliIscritti,
  pubblicazioneAperta,
  vedeVideo,
  visioneRegistrazione,
  type AccessoRegistrazione,
  type EventoPerVisione,
} from './audience';
import { issueViewingToken, viewingCookieName } from './viewing';

type Cookies = Parameters<typeof accessoRegistrazione>[1];
const barattolo = (valori: Record<string, string> = {}) =>
  ({
    get: (nome: string) =>
      nome in valori ? { name: nome, value: valori[nome]! } : undefined,
  }) as unknown as Cookies;

const NOW = new Date('2026-10-21T15:00:00Z');
const evento = (over: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  recordingPublished: true,
  transcriptPublished: false,
  recordingAudience: 'PUBLIC' as 'PUBLIC' | 'REGISTRANTS',
  recordingDestination: null as 'PUBLIC' | 'REGISTRANTS' | null,
  postEventPublic: true,
  postEventPublicUntil: null as Date | null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockManager.mockResolvedValue(false);
  mockRegCount.mockResolvedValue(0);
  mockEventAccess.mockResolvedValue(null);
});

describe('pubblicazioneAperta', () => {
  it('pubblicata nella finestra post-evento', () => {
    expect(pubblicazioneAperta(evento(), NOW)).toBe(true);
    expect(
      pubblicazioneAperta(
        evento({ recordingPublished: false, transcriptPublished: true }),
        NOW
      )
    ).toBe(true);
  });
  it("chiusa se non pubblicata, se la pagina post-evento e' ritirata o la finestra e' passata", () => {
    expect(pubblicazioneAperta(evento({ recordingPublished: false }), NOW)).toBe(false);
    expect(pubblicazioneAperta(evento({ postEventPublic: false }), NOW)).toBe(false);
    expect(
      pubblicazioneAperta(
        evento({ postEventPublicUntil: new Date('2026-10-20T00:00:00Z') }),
        NOW
      )
    ).toBe(false);
  });
});

describe('accessoRegistrazione', () => {
  it('per tutti: chiunque, senza leggere la sessione', async () => {
    expect(await accessoRegistrazione(evento(), barattolo(), NOW)).toBe('pubblico');
    expect(mockManager).not.toHaveBeenCalled();
  });

  it("lo staff che gestisce l'evento vede anche prima della pubblicazione", async () => {
    mockManager.mockResolvedValue(true);
    expect(
      await accessoRegistrazione(evento({ recordingPublished: false }), barattolo(), NOW)
    ).toBe('staff');
  });

  it('non pubblicata: nessun altro', async () => {
    expect(
      await accessoRegistrazione(evento({ recordingPublished: false }), barattolo(), NOW)
    ).toBeNull();
  });

  it("solo iscritti: chi ha il cookie della visione di un'iscrizione esistente", async () => {
    mockRegCount.mockResolvedValue(1);
    const cookie = { [viewingCookieName('ev-1')]: issueViewingToken('ev-1', 'reg-1')! };
    expect(
      await accessoRegistrazione(
        evento({ recordingAudience: 'REGISTRANTS' }),
        barattolo(cookie),
        NOW
      )
    ).toBe('iscritto');
    expect(mockRegCount).toHaveBeenCalledWith({
      where: { id: 'reg-1', eventId: 'ev-1' },
    });
  });

  it("solo iscritti: chi ha il cookie d'accesso dell'evento, anche senza essere entrato in sala", async () => {
    mockEventAccess.mockResolvedValue('tok-1');
    mockRegCount.mockResolvedValue(1);
    expect(
      await accessoRegistrazione(
        evento({ recordingAudience: 'REGISTRANTS' }),
        barattolo({ event_access_ev_1: 'x' }),
        NOW
      )
    ).toBe('iscritto');
    expect(mockRegCount).toHaveBeenCalledWith({
      where: { accessToken: 'tok-1', eventId: 'ev-1' },
    });
  });

  it("solo iscritti: senza prova, o con un'iscrizione cancellata, niente", async () => {
    expect(
      await accessoRegistrazione(
        evento({ recordingAudience: 'REGISTRANTS' }),
        barattolo(),
        NOW
      )
    ).toBeNull();
    const cookie = { [viewingCookieName('ev-1')]: issueViewingToken('ev-1', 'reg-1')! };
    expect(
      await accessoRegistrazione(
        evento({ recordingAudience: 'REGISTRANTS' }),
        barattolo(cookie),
        NOW
      )
    ).toBeNull();
  });

  it('solo iscritti: un token manomesso o di un altro evento non vale', async () => {
    mockRegCount.mockResolvedValue(1);
    const altro = { [viewingCookieName('ev-1')]: issueViewingToken('ev-2', 'reg-1')! };
    const manomesso = {
      [viewingCookieName('ev-1')]: `${issueViewingToken('ev-1', 'reg-1')!}x`,
    };
    expect(
      await accessoRegistrazione(
        evento({ recordingAudience: 'REGISTRANTS' }),
        barattolo(altro),
        NOW
      )
    ).toBeNull();
    expect(
      await accessoRegistrazione(
        evento({ recordingAudience: 'REGISTRANTS' }),
        barattolo(manomesso),
        NOW
      )
    ).toBeNull();
  });

  it('finestra post-evento chiusa: anche gli iscritti restano fuori, lo staff no', async () => {
    mockRegCount.mockResolvedValue(1);
    const cookie = { [viewingCookieName('ev-1')]: issueViewingToken('ev-1', 'reg-1')! };
    const chiuso = evento({ recordingAudience: 'REGISTRANTS', postEventPublic: false });
    expect(await accessoRegistrazione(chiuso, barattolo(cookie), NOW)).toBeNull();
    mockManager.mockResolvedValue(true);
    expect(await accessoRegistrazione(chiuso, barattolo(cookie), NOW)).toBe('staff');
  });
});

describe('registrazione riservata su un evento con destinazione', () => {
  const riservata = evento({
    recordingAudience: 'REGISTRANTS',
    recordingDestination: 'REGISTRANTS',
    postEventPublic: false,
  });
  const cookie = { [viewingCookieName('ev-1')]: issueViewingToken('ev-1', 'reg-1')! };

  it('con la pagina privata la pubblicazione resta aperta agli iscritti', () => {
    expect(pubblicazioneAperta(riservata, NOW)).toBe(true);
    expect(
      pubblicazioneAperta({ ...riservata, recordingPublished: false, transcriptPublished: true }, NOW)
    ).toBe(true);
  });

  it("l'iscritto la vede, e chi non prova l'iscrizione no", async () => {
    mockRegCount.mockResolvedValue(1);
    expect(await accessoRegistrazione(riservata, barattolo(cookie), NOW)).toBe('iscritto');
    expect(await accessoRegistrazione(riservata, barattolo(), NOW)).toBeNull();
  });

  it('dopo la pulizia dei dati resta lo staff', async () => {
    mockRegCount.mockResolvedValue(0);
    expect(await accessoRegistrazione(riservata, barattolo(cookie), NOW)).toBeNull();
    mockManager.mockResolvedValue(true);
    expect(await accessoRegistrazione(riservata, barattolo(cookie), NOW)).toBe('staff');
  });

  it('non pubblicata, o oltre la finestra, resta chiusa', () => {
    expect(pubblicazioneAperta({ ...riservata, recordingPublished: false }, NOW)).toBe(false);
    expect(
      pubblicazioneAperta(
        { ...riservata, postEventPublicUntil: new Date('2026-10-20T00:00:00Z') },
        NOW
      )
    ).toBe(false);
  });

  it('vale per il pubblico degli iscritti con qualunque destinazione dichiarata', () => {
    expect(
      pubblicazioneAperta({ ...riservata, recordingDestination: 'PUBLIC' }, NOW)
    ).toBe(true);
  });

  it('un video per tutti dipende ancora dalla pagina', () => {
    expect(
      pubblicazioneAperta(
        { ...riservata, recordingAudience: 'PUBLIC', recordingDestination: 'PUBLIC' },
        NOW
      )
    ).toBe(false);
  });

  it('senza destinazione la pagina privata chiude anche agli iscritti, come sempre', async () => {
    mockRegCount.mockResolvedValue(1);
    const senza = { ...riservata, recordingDestination: null };
    expect(pubblicazioneAperta(senza, NOW)).toBe(false);
    expect(await accessoRegistrazione(senza, barattolo(cookie), NOW)).toBeNull();
  });

  it('apertaAgliIscritti dice quando la pagina nascosta non ferma gli iscritti', () => {
    expect(apertaAgliIscritti(riservata, NOW)).toBe(true);
    expect(apertaAgliIscritti({ ...riservata, postEventPublic: true }, NOW)).toBe(true);
    expect(apertaAgliIscritti({ ...riservata, recordingDestination: 'PUBLIC' }, NOW)).toBe(true);
    expect(apertaAgliIscritti({ ...riservata, recordingDestination: null }, NOW)).toBe(false);
    expect(apertaAgliIscritti({ ...riservata, recordingAudience: 'PUBLIC' }, NOW)).toBe(false);
    expect(apertaAgliIscritti({ ...riservata, recordingPublished: false }, NOW)).toBe(false);
    expect(
      apertaAgliIscritti(
        { ...riservata, postEventPublicUntil: new Date('2026-10-20T00:00:00Z') },
        NOW
      )
    ).toBe(false);
  });
});

describe('cosa vede chi apre una pagina dell\'evento', () => {
  const concluso = (over: Partial<EventoPerVisione> = {}): EventoPerVisione => ({
    id: 'ev-1',
    status: 'ENDED',
    recordingPublished: true,
    transcriptPublished: false,
    recordingAudience: 'PUBLIC',
    recordingDestination: null,
    postEventPublic: true,
    postEventPublicUntil: null,
    ...over,
  });
  const ANTEPRIMA = { chiesta: true, paginaVisibile: true };

  it('il video lo vede chi ha accesso, se pubblicato', () => {
    expect(vedeVideo(concluso(), 'pubblico', undefined, NOW)).toBe(true);
    expect(vedeVideo(concluso({ recordingAudience: 'REGISTRANTS' }), 'iscritto', undefined, NOW)).toBe(true);
    expect(vedeVideo(concluso(), null, undefined, NOW)).toBe(false);
  });

  it('la sola trascrizione pubblicata non mostra il video', () => {
    const trascrizione = concluso({ recordingPublished: false, transcriptPublished: true });
    expect(visioneRegistrazione(trascrizione, 'pubblico', undefined, NOW)).toMatchObject({
      registrazione: true,
      video: false,
    });
  });

  it('lo staff vede il pubblicato; il resto solo chiedendo l\'anteprima', () => {
    const nascosta = concluso({ recordingPublished: false });
    expect(vedeVideo(concluso(), 'staff', undefined, NOW)).toBe(true);
    expect(vedeVideo(nascosta, 'staff', undefined, NOW)).toBe(false);
    expect(visioneRegistrazione(nascosta, 'staff', ANTEPRIMA, NOW)).toMatchObject({
      anteprimaStaff: true,
      video: true,
    });
  });

  it('senza anteprima chiesta lo staff non vede una pagina che il pubblico non vede', () => {
    const privata = concluso({ postEventPublic: false });
    expect(vedeVideo(privata, 'staff', undefined, NOW)).toBe(false);
    expect(
      visioneRegistrazione(privata, 'staff', { chiesta: true, paginaVisibile: false }, NOW).anteprimaStaff
    ).toBe(true);
  });

  it('chi non e\' iscritto sa che la registrazione e\' riservata', () => {
    const riservata = concluso({ recordingAudience: 'REGISTRANTS' });
    expect(visioneRegistrazione(riservata, null, undefined, NOW).soloIscritti).toBe(true);
    expect(visioneRegistrazione(riservata, 'iscritto', undefined, NOW).soloIscritti).toBe(false);
    expect(
      visioneRegistrazione(concluso({ recordingAudience: 'REGISTRANTS', recordingPublished: false }), null, undefined, NOW)
        .soloIscritti
    ).toBe(false);
  });

  it('solo a evento concluso: non in diretta, non su un evento archiviato', () => {
    for (const status of ['DRAFT', 'PUBLISHED', 'PROVISIONING', 'LIVE', 'IDLE', 'ARCHIVED'] as const) {
      for (const accesso of ['pubblico', 'iscritto', 'staff'] as const) {
        expect(visioneRegistrazione(concluso({ status }), accesso, ANTEPRIMA, NOW)).toEqual({
          anteprimaStaff: false,
          registrazione: false,
          video: false,
          soloIscritti: false,
        });
        expect(vedeVideo(concluso({ status }), accesso, ANTEPRIMA, NOW)).toBe(false);
      }
    }
  });

  it("l'iscritto vede il video di un evento riservato con la pagina privata", () => {
    const riservata = concluso({
      recordingAudience: 'REGISTRANTS',
      recordingDestination: 'REGISTRANTS',
      postEventPublic: false,
    });
    expect(vedeVideo(riservata, 'iscritto', undefined, NOW)).toBe(true);
    expect(vedeVideo(riservata, 'staff', undefined, NOW)).toBe(true);
    expect(vedeVideo(riservata, null, undefined, NOW)).toBe(false);
  });

  /**
   * La regola come la scrive la pagina dell'evento. Le prove la confrontano con
   * tutte le combinazioni, cosi' la pagina adotta la funzione senza cambiare
   * risultato.
   */
  function comeLaPagina(
    event: EventoPerVisione,
    accessoDato: AccessoRegistrazione,
    chiedeAnteprima: boolean,
    paginaVisibile: boolean
  ) {
    const accesso = event.status === 'ENDED' ? accessoDato : null;
    const aperta = pubblicazioneAperta(event, NOW);
    const previewForStaff = accesso === 'staff' && chiedeAnteprima && (!aperta || !paginaVisibile);
    const vedeRegistrazione =
      accesso === 'pubblico' || accesso === 'iscritto' || (accesso === 'staff' && (aperta || previewForStaff));
    const videoVisibile = vedeRegistrazione && (event.recordingPublished || previewForStaff);
    const recordingForRegistrants =
      event.status === 'ENDED' && aperta && event.recordingAudience === 'REGISTRANTS' && !vedeRegistrazione;
    return { previewForStaff, vedeRegistrazione, videoVisibile, recordingForRegistrants };
  }

  /** La pubblicazione come era prima della destinazione. */
  const apertaSenzaDestinazione = (e: EventoPerVisione): boolean =>
    (e.recordingPublished || e.transcriptPublished) &&
    e.postEventPublic &&
    (!e.postEventPublicUntil || e.postEventPublicUntil >= NOW);

  function* combinazioni(): Generator<EventoPerVisione> {
    const si = [false, true];
    for (const status of ['DRAFT', 'PUBLISHED', 'PROVISIONING', 'LIVE', 'IDLE', 'ENDED', 'ARCHIVED'] as const) {
      for (const recordingPublished of si) {
        for (const transcriptPublished of si) {
          for (const recordingAudience of ['PUBLIC', 'REGISTRANTS'] as const) {
            for (const recordingDestination of [null, 'PUBLIC', 'REGISTRANTS'] as const) {
              for (const postEventPublic of si) {
                for (const postEventPublicUntil of [
                  null,
                  new Date('2026-10-20T00:00:00Z'),
                  new Date('2026-10-22T00:00:00Z'),
                ]) {
                  yield concluso({
                    status,
                    recordingPublished,
                    transcriptPublished,
                    recordingAudience,
                    recordingDestination,
                    postEventPublic,
                    postEventPublicUntil,
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  it('in ogni combinazione da\' lo stesso risultato della pagina', () => {
    let provate = 0;
    for (const event of combinazioni()) {
      for (const accesso of ['pubblico', 'iscritto', 'staff', null] as const) {
        for (const chiesta of [false, true]) {
          for (const paginaVisibile of [false, true]) {
            const pagina = comeLaPagina(event, accesso, chiesta, paginaVisibile);
            expect(visioneRegistrazione(event, accesso, { chiesta, paginaVisibile }, NOW)).toEqual({
              anteprimaStaff: pagina.previewForStaff,
              registrazione: pagina.vedeRegistrazione,
              video: pagina.videoVisibile,
              soloIscritti: pagina.recordingForRegistrants,
            });
            expect(vedeVideo(event, accesso, { chiesta, paginaVisibile }, NOW)).toBe(pagina.videoVisibile);
            provate++;
          }
        }
      }
    }
    expect(provate).toBe(7 * 2 * 2 * 2 * 3 * 2 * 3 * 4 * 2 * 2);
  });

  it('senza destinazione la pubblicazione resta quella di sempre', () => {
    for (const event of combinazioni()) {
      if (event.recordingDestination == null) {
        expect(pubblicazioneAperta(event, NOW)).toBe(apertaSenzaDestinazione(event));
      }
    }
  });

  it('il pubblico degli iscritti di un evento con destinazione non dipende da postEventPublic', () => {
    for (const event of combinazioni()) {
      if (event.recordingDestination != null && event.recordingAudience === 'REGISTRANTS') {
        const accesa = { ...event, postEventPublic: true };
        const spenta = { ...event, postEventPublic: false };
        expect(pubblicazioneAperta(spenta, NOW)).toBe(pubblicazioneAperta(accesa, NOW));
        for (const accesso of ['pubblico', 'iscritto', 'staff', null] as const) {
          expect(vedeVideo(spenta, accesso, undefined, NOW)).toBe(vedeVideo(accesa, accesso, undefined, NOW));
        }
      }
    }
  });

  it('un evento con destinazione e video per tutti dipende ancora da postEventPublic', () => {
    for (const event of combinazioni()) {
      if (event.recordingDestination != null && event.recordingAudience === 'PUBLIC') {
        expect(pubblicazioneAperta(event, NOW)).toBe(apertaSenzaDestinazione(event));
      }
    }
  });
});

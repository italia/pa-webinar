// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import fs from 'fs';
import path from 'path';

import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import type { SchedaPrivacy } from '@/lib/events/privacy-sheet';

import WaitingRoom from './waiting-room';

// Il kit grafico e' quello vero (vedi l'alias in vitest.config.ts): il
// pulsante, il campo e la casella sono gli stessi della pagina.

vi.mock('@/i18n/navigation', async () => {
  const { createElement } = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: unknown; children?: unknown }) =>
      createElement('a', { href: String(href), ...rest }, children as never),
    percorso: (p: string) => p,
  };
});

// Fotocamera, chat e riproduttori non c'entrano con l'ingresso.
vi.mock('@/components/live/device-check', () => ({ default: () => null }));
vi.mock('@/components/live/chat-panel', () => ({ default: () => null }));
vi.mock('@/components/live/audio-player', () => ({ default: () => null }));
vi.mock('@/components/events/video-player', () => ({ default: () => null }));

// La piazza: al posto del gioco, un segnaposto che consegna al test il
// callback con cui il cancello chiede di entrare.
const piazza = vi.hoisted(() => ({
  onEnterLive: null as null | ((name: string, prefs: unknown) => unknown),
}));
vi.mock('next/dynamic', () => ({
  default: () =>
    function PiazzaFinta(props: { onEnterLive: (name: string, prefs: unknown) => unknown }) {
      piazza.onEnterLive = props.onEnterLive;
      return null;
    },
}));

type Props = ComponentProps<typeof WaitingRoom>;
type Evento = Props['event'];

const oraPiu = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

const eventoLive: Evento = {
  title: 'Evento di prova',
  slug: 'evento-di-prova',
  waitingRoomEngine: 'CLASSIC',
  startsAt: oraPiu(-5),
  endsAt: oraPiu(55),
  status: 'LIVE',
  maxParticipants: 100,
  recordingEnabled: false,
  chatEnabled: false,
  timezone: 'Europe/Rome',
};

let container: HTMLDivElement;
let root: Root;
let onEnterLive: ReturnType<typeof vi.fn<Props['onEnterLive']>>;

function albero(props: Partial<Props> = {}) {
  return (
    <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
      {/* L'installazione del chart, salvo dove la prova dice altro: senza, la sala
          non promette niente ('visibili'). */}
      <WaitingRoom
        event={eventoLive}
        role="guest"
        jvbReady
        defaultName=""
        onEnterLive={onEnterLive}
        partecipanti="solo-voce"
        {...props}
      />
    </NextIntlClientProvider>
  );
}

function render(props: Partial<Props> = {}) {
  act(() => {
    root.render(albero(props));
  });
}

const $ = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);

function pulsante(testo: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll('button')).find((el) =>
    el.textContent?.includes(testo),
  );
  if (!b) throw new Error(`nessun pulsante «${testo}»`);
  return b;
}

function premi(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

function scrivi(sel: string, valore: string) {
  const el = $<HTMLInputElement>(sel);
  if (!el) throw new Error(`nessun campo ${sel}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, valore);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const t = messages.waiting;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom non implementa lo scorrimento.
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  piazza.onEnterLive = null;
  onEnterLive = vi.fn<Props['onEnterLive']>();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('sala d\'attesa — pubblico anonimo', () => {
  const anonimo: Evento = { ...eventoLive, audienceAnonymous: true };
  const conPiazza: Evento = { ...eventoLive, waitingRoomEngine: 'GAME' };
  const senzaPulsante = () =>
    Array.from(container.querySelectorAll('button')).every(
      (b) => !b.textContent?.includes(t.backToGarden),
    );
  const conIndirizzo = (cerca: string) => window.history.replaceState(null, '', `/${cerca}`);

  afterEach(() => conIndirizzo(''));

  it('la piazza non si apre, nemmeno con il parametro', () => {
    conIndirizzo('?engine=phaser');
    render({ event: { ...conPiazza, audienceAnonymous: true } });
    expect($('.wr-piazza-card')).toBeNull();
    expect(piazza.onEnterLive).toBeNull();
    expect(senzaPulsante()).toBe(true);
  });

  it('il pulsante per riaprirla non c\'e\'', () => {
    render({ event: anonimo });
    expect(senzaPulsante()).toBe(true);
  });

  it('altrove il pulsante resta', () => {
    window.localStorage.setItem('pawebinar.arcade.classic', '1');
    render({ event: conPiazza });
    expect(senzaPulsante()).toBe(false);
  });

  it('la foto non si offre: in sala non si vedrebbe', async () => {
    const lettura = vi.fn(async (_url: string) =>
      Response.json({ canUpload: true, needsEmailProof: false, photo: null }),
    );
    vi.stubGlobal('fetch', lettura);
    render({ event: anonimo, chatToken: 'token-iscritto', role: 'participant' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(lettura.mock.calls.some(([url]) => String(url).includes('profile-photo'))).toBe(false);
    render({ event: eventoLive, chatToken: 'token-iscritto', role: 'participant' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(lettura.mock.calls.some(([url]) => String(url).includes('profile-photo'))).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('sala d\'attesa — nome mancante a sala aperta', () => {
  it('il pulsante si preme, dice cosa manca e non fa entrare', () => {
    render();
    const nome = $<HTMLInputElement>('#waiting-name')!;
    const avviso = $('#waiting-name-required');
    expect(avviso?.textContent).toContain(t.nameRequiredToEnter);
    expect(nome.getAttribute('aria-describedby')).toBe('waiting-name-help waiting-name-required');
    expect(nome.hasAttribute('aria-invalid')).toBe(false);

    const entra = pulsante(t.joinNowBtn);
    expect(entra.disabled).toBe(false);
    expect(entra.getAttribute('aria-describedby')).toBe('waiting-name-required');

    premi(entra);
    expect(onEnterLive).not.toHaveBeenCalled();
    expect(nome.getAttribute('aria-invalid')).toBe('true');
    // Dopo il tentativo il nome mancante e' un errore: rosso, sul campo.
    expect(nome.classList.contains('is-invalid')).toBe(true);
    expect(nome.closest('.wr-name-field')?.classList.contains('wr-name-field--insist')).toBe(true);
    expect(document.activeElement).toBe(nome);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('scritto il nome l\'avviso sparisce e si entra con quel nome', () => {
    render();
    scrivi('#waiting-name', '  Relatore 1 ');
    expect($('#waiting-name-required')).toBeNull();
    const entra = pulsante(t.joinNowBtn);
    expect(entra.hasAttribute('aria-describedby')).toBe(false);

    premi(entra);
    expect(onEnterLive).toHaveBeenCalledTimes(1);
    expect(onEnterLive).toHaveBeenCalledWith('Relatore 1', { cameraOn: false, micOn: false });
    expect(window.localStorage.getItem('pawebinar.participant.name')).toBe('Relatore 1');
  });

  it('all\'apertura della sala lo annuncia a voce, invece di invitare a entrare', () => {
    render({ jvbReady: false });
    expect($('#waiting-name-required')).toBeNull();
    render({ jvbReady: true });
    const stato = Array.from(container.querySelectorAll('[role="status"]')).map(
      (el) => el.textContent,
    );
    expect(stato).toContain(t.roomOpenNameMissing);
  });

  it('dalla registrazione in corso si torna al modulo, con il fuoco sul nome', () => {
    render({ event: { ...eventoLive, tempRecordingUrl: 'https://example.org/r.mp4' } });
    premi(pulsante(t.watchCatchup));
    expect($('#waiting-name')).toBeNull();

    premi(pulsante(t.switchToLive));
    expect(onEnterLive).not.toHaveBeenCalled();
    const nome = $<HTMLInputElement>('#waiting-name')!;
    expect(nome.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(nome);
  });
});

describe('sala d\'attesa — gli altri campi che trattengono', () => {
  it('la trascrizione dei propri interventi si chiede ma non ferma l\'ingresso', () => {
    render({
      role: 'participant',
      defaultName: 'Relatore 1',
      event: { ...eventoLive, multitrackRecordingEnabled: true },
    });
    const consenso = $<HTMLInputElement>('#waiting-multitrack-consent')!;
    expect(consenso.checked).toBe(false);
    expect($('#waiting-multitrack-consent-nota')?.textContent).toBe(
      messages.gdpr.consent.multitrackOptionalShort,
    );

    // Senza spunta si entra lo stesso, e senza consenso.
    premi(pulsante(t.joinNowBtn));
    expect(onEnterLive).toHaveBeenLastCalledWith('Relatore 1', { cameraOn: false, micOn: false });
  });

  it.each([
    ['visibili', messages.gdpr.consent.multitrackOptional],
    ['solo-voce', messages.gdpr.consent.multitrackOptionalShort],
    ['assente', messages.gdpr.consent.multitrackOptionalShort],
  ] as const)('con la voce %s la nota dice solo cio\' che vale per il video', (partecipanti, nota) => {
    render({
      role: 'participant',
      defaultName: 'Relatore 1',
      partecipanti,
      event: { ...eventoLive, multitrackRecordingEnabled: true },
    });
    expect($('#waiting-multitrack-consent-nota')?.textContent).toBe(nota);
  });

  it('in ogni lingua la nota breve e\' la nota intera senza la frase sul video', () => {
    const cartella = path.resolve(__dirname, '../../i18n/messages');
    const cataloghi = fs.readdirSync(cartella).filter((nome) => nome.endsWith('.json'));
    expect(cataloghi).toHaveLength(24);
    for (const nome of cataloghi) {
      const catalogo = JSON.parse(fs.readFileSync(path.join(cartella, nome), 'utf8'));
      const { multitrackOptional: intera, multitrackOptionalShort: breve } = catalogo.gdpr.consent;
      expect(intera.startsWith(breve), nome).toBe(true);
      expect(breve.length, nome).toBeLessThan(intera.length);
    }
  });

  it('con la spunta il consenso viaggia con l\'ingresso, anche per chi modera', () => {
    render({
      role: 'moderator',
      defaultName: 'Relatore 1',
      event: { ...eventoLive, captionsTranscript: true },
    });
    premi($<HTMLInputElement>('#waiting-multitrack-consent')!);
    premi(pulsante(t.joinNowBtn));
    // Il server ne conserva la prova, e decide voce per voce.
    expect(onEnterLive).toHaveBeenCalledWith('Relatore 1', {
      cameraOn: false,
      micOn: false,
      multitrackConsent: true,
    });
  });

  it('chi non deve dare il consenso entra senza la casella', () => {
    render({
      role: 'moderator',
      defaultName: 'Relatore 1',
      multitrackConsentExempt: true,
      event: { ...eventoLive, multitrackRecordingEnabled: true },
    });
    expect($('#waiting-multitrack-consent')).toBeNull();
    premi(pulsante(t.joinNowBtn));
    expect(onEnterLive).toHaveBeenCalledTimes(1);
  });

  it('l\'ospite non deve lasciare un\'email per entrare', () => {
    render();
    expect($('#waiting-email')).toBeNull();
    scrivi('#waiting-name', 'Relatore 1');
    premi(pulsante(t.joinNowBtn));
    expect(onEnterLive).toHaveBeenCalledTimes(1);
  });
});

describe('sala d\'attesa — la sala che non e\' pronta resta distinta dal nome', () => {
  it('ponte video in accensione: pulsante spento, il nome non si chiede', () => {
    render({ jvbReady: false });
    expect(pulsante(t.roomNotReadyButton).disabled).toBe(true);
    expect(() => pulsante(t.joinNowBtn)).toThrow();
    expect($('#waiting-name-required')).toBeNull();
  });

  it('evento non ancora avviato: «Apertura alle …» spento, il nome non si chiede', () => {
    render({ event: { ...eventoLive, status: 'PUBLISHED', startsAt: oraPiu(30), endsAt: oraPiu(90) } });
    expect(pulsante('Apertura alle').disabled).toBe(true);
    expect($('#waiting-name-required')).toBeNull();
  });

  it('sala accesa in anticipo e pronta: conto alla rovescia e «Apertura alle …», non «in allestimento»', () => {
    const serverTime = new Date().toISOString();
    render({
      event: { ...eventoLive, status: 'PROVISIONING', startsAt: oraPiu(10), endsAt: oraPiu(70) },
      warmup: { phase: 'starting', startedAt: serverTime, serverTime, bridgePronto: true },
    });
    expect(container.textContent).toContain(t.startsIn);
    expect(container.textContent).toContain('La sala è pronta: si apre alle');
    expect(container.textContent).toContain(t.warmup.readyBeforeStartDetail);
    expect(pulsante('Apertura alle').disabled).toBe(true);
    expect(container.textContent).not.toContain(t.warmingUpButton);
  });

  it('sala in accensione dopo l\'orario d\'inizio: resta «in allestimento»', () => {
    const serverTime = new Date().toISOString();
    render({
      event: { ...eventoLive, status: 'PROVISIONING', startsAt: oraPiu(-1), endsAt: oraPiu(59) },
      warmup: { phase: 'starting', startedAt: serverTime, serverTime, bridgePronto: false },
    });
    expect(pulsante(t.warmingUpButton).disabled).toBe(true);
    expect(container.textContent).not.toContain('La sala è pronta');
  });

  it('il nome non ancora letto dal browser non si segnala come mancante', () => {
    // Il disegno lato server precede la lettura del nome salvato: un campo
    // vuoto li' non vuol dire che il nome manchi.
    expect(renderToString(albero())).not.toContain(t.nameRequiredToEnter);

    window.localStorage.setItem('pawebinar.participant.name', 'Relatore 1');
    render();
    expect($<HTMLInputElement>('#waiting-name')?.value).toBe('Relatore 1');
    expect($('#waiting-name-required')).toBeNull();
  });
});

describe('sala d\'attesa — il cancello della piazza', () => {
  const eventoPiazza: Evento = { ...eventoLive, waitingRoomEngine: 'GAME' };

  it('senza nome respinge, lo dice sopra la scena e porta al campo', () => {
    render({ event: eventoPiazza });
    premi(pulsante(t.enterGardenTitle));
    expect($('.wr-piazza-hint')?.textContent).toBe(t.nameRequiredToEnter);

    expect(piazza.onEnterLive).toBeTypeOf('function');
    act(() => {
      expect(() => piazza.onEnterLive?.('', { cameraOn: false, micOn: false })).toThrow();
    });
    expect(onEnterLive).not.toHaveBeenCalled();
    expect(document.activeElement).toBe($('#waiting-name'));
  });

  it('con il nome si entra con i dati della pagina, non con quelli del gioco', () => {
    render({ event: eventoPiazza, defaultName: 'Relatore 1' });
    premi(pulsante(t.enterGardenTitle));
    expect($('.wr-piazza-hint')?.textContent).toBe(t.gardenGateHint);

    act(() => {
      piazza.onEnterLive?.('Altro nome', { cameraOn: true, micOn: true });
    });
    expect(onEnterLive).toHaveBeenCalledWith('Relatore 1', { cameraOn: false, micOn: false });
  });
});

describe('sala d\'attesa — pagina aperta da http://', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fuori da un contesto sicuro lo dice, con il link all\'indirizzo https', () => {
    vi.stubGlobal('isSecureContext', false);
    render({ defaultName: 'Relatore 1' });
    const tl = messages.live;
    expect(container.textContent).toContain(tl.insecureContextTitle);
    const link = Array.from(container.querySelectorAll<HTMLAnchorElement>('a')).find((a) =>
      a.href.startsWith('https://'),
    );
    expect(link?.href).toBe(`https://${window.location.hostname}${window.location.pathname}`);
    // Il testo mostra solo l'host: l'indirizzo completo può portare un token.
    expect(link?.textContent).toBe(
      tl.insecureContextLink.replace('{host}', window.location.hostname),
    );
  });

  it('in un contesto sicuro nessun avviso', () => {
    vi.stubGlobal('isSecureContext', true);
    render({ defaultName: 'Relatore 1' });
    expect(container.textContent).not.toContain(messages.live.insecureContextTitle);
  });
});

describe('sala d\'attesa — avviso di registrazione', () => {
  it('compare solo quando la registrazione può avvenire (lo decide LiveEventClient)', () => {
    render({ event: { ...eventoLive, recordingEnabled: true } });
    expect(container.textContent).toContain(t.recordingNotice);
    render({ event: { ...eventoLive, recordingEnabled: false } });
    expect(container.textContent).not.toContain(t.recordingNotice);
  });

  it('di solo ascolto informa e non chiede niente', () => {
    render({ event: { ...eventoLive, recordingEnabled: true }, recordingListenOnly: true });
    expect(container.textContent).toContain(messages.gdpr.consent.recordingNoticeVoice);
    expect($('#waiting-recording-consent')).toBeNull();
    // Dove la voce non si puo' escludere, resta l'avviso di sempre, e il nome
    // puo' comparire.
    render({
      event: { ...eventoLive, recordingEnabled: true },
      recordingListenOnly: true,
      partecipanti: 'visibili',
    });
    expect(container.textContent).toContain(messages.gdpr.consent.recordingNotice);
    expect(container.textContent).toContain(messages.gdpr.consent.namesMayAppear);
    // Dove chi partecipa non entra mai nel video lo dice.
    render({
      event: { ...eventoLive, recordingEnabled: true },
      recordingListenOnly: true,
      partecipanti: 'esclusi',
    });
    expect(container.textContent).toContain(messages.gdpr.consent.recordingHostsOnly);
    expect(container.textContent).not.toContain(messages.gdpr.consent.namesMayAppear);
  });
});

describe('sala d\'attesa — chiamata rapida che registra', () => {
  it('annuncia che si entra fuori dalla registrazione e la domanda arriva in sala', () => {
    render({
      event: { ...eventoLive, recordingEnabled: true },
      eventType: 'INSTANT',
      recordingAskedInRoom: true,
    });
    expect(container.textContent).toContain(t.recordingNoticeInstant);
    expect(container.textContent).not.toContain(t.recordingNotice);
    expect($('#waiting-recording-consent')).toBeNull();
  });

  it("dove chi partecipa non entra mai nel video annuncia solo chi conduce, e la trascrizione vale da sola", () => {
    render({
      role: 'guest',
      defaultName: 'Ospite',
      event: { ...eventoLive, recordingEnabled: true, multitrackRecordingEnabled: true },
      eventType: 'INSTANT',
      recordingAskedInRoom: true,
      partecipanti: 'esclusi',
    });
    expect(container.textContent).toContain(t.recordingNoticeInstantHostsOnly);
    expect(container.textContent).not.toContain(t.recordingNoticeInstant);
    expect($('#waiting-recording-consent')).toBeNull();
    expect($('#waiting-multitrack-consent')).not.toBeNull();
  });

  it('la trascrizione non si chiede: senza il consenso alla registrazione non varrebbe', () => {
    render({
      role: 'guest',
      defaultName: 'Ospite',
      event: { ...eventoLive, recordingEnabled: true, multitrackRecordingEnabled: true },
      eventType: 'INSTANT',
      recordingAskedInRoom: true,
    });
    expect($('#waiting-multitrack-consent')).toBeNull();
  });
});

describe('sala d\'attesa — consenso alla registrazione', () => {
  const evento: Evento = { ...eventoLive, recordingEnabled: true };

  it('chi non l\'ha dato all\'iscrizione lo da\' qui, e la spunta viaggia con l\'ingresso', () => {
    render({ event: evento, defaultName: 'Relatore 1', recordingConsentRequired: true });
    expect(container.textContent).toContain(t.recordingConsentIntro);
    premi($<HTMLInputElement>('#waiting-recording-consent')!);
    premi(pulsante(t.joinNowBtn));
    // Il consenso viaggia con l'ingresso: il server ne conserva la prova.
    expect(onEnterLive).toHaveBeenCalledWith('Relatore 1', {
      cameraOn: false,
      micOn: false,
      recordingConsent: true,
      recordingConsentDestination: null,
    });
  });

  it('senza la spunta si entra lo stesso, e la sala dice cosa succede', () => {
    render({ event: evento, defaultName: 'Relatore 1', recordingConsentRequired: true });
    expect(container.textContent).toContain(messages.gdpr.consent.recordingOptionalVoice);
    premi(pulsante(t.joinNowBtn));
    expect(onEnterLive).toHaveBeenCalledWith('Relatore 1', { cameraOn: false, micOn: false });
  });

  it('dove la voce non si puo\' togliere dal video dice che si resta in ascolto', () => {
    render({ event: evento, defaultName: 'Relatore 1', recordingConsentRequired: true, partecipanti: 'visibili' });
    expect(container.textContent).toContain(messages.gdpr.consent.recordingOptionalListenOnly);
  });

  it("senza sapere cosa garantisce l'installazione non promette niente", () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <WaitingRoom
            event={evento}
            role="guest"
            jvbReady
            defaultName="Relatore 1"
            onEnterLive={onEnterLive}
            recordingConsentRequired
          />
        </NextIntlClientProvider>,
      );
    });
    expect(container.textContent).toContain(t.recordingConsentIntroVisible);
    expect(container.textContent).not.toContain(t.recordingConsentIntro);
  });

  it("dove chi partecipa puo' comparire non promette che volto e nome restano fuori", () => {
    render({
      event: evento,
      defaultName: 'Relatore 1',
      recordingConsentRequired: true,
      recordingDestination: 'REGISTRANTS',
      partecipanti: 'visibili',
    });
    const g = messages.gdpr.consent;
    expect(container.textContent).toContain(t.recordingConsentTitleVisible);
    expect(container.textContent).toContain(t.recordingConsentIntroVisible);
    expect(container.textContent).toContain(g.namesMayAppear);
    expect($('label[for="waiting-recording-consent"]')?.textContent).toBe(g.recordingVisibleReserved);
    expect(container.textContent).not.toContain(t.recordingConsentIntro);
    expect(container.textContent).not.toContain(g.recordingReserved);
  });

  it('chi l\'ha gia\' dato entra con un clic, senza casella', () => {
    render({ event: evento, defaultName: 'Relatore 1', recordingConsentRequired: false });
    expect($('#waiting-recording-consent')).toBeNull();
    premi(pulsante(t.joinNowBtn));
    expect(onEnterLive).toHaveBeenCalledWith('Relatore 1', { cameraOn: false, micOn: false });
  });

  it('il testo scelto per l\'evento prende il posto di quello predefinito', () => {
    render({
      event: evento,
      recordingConsentRequired: true,
      recordingConsentText: 'Testo dell\'ente sulla registrazione.',
    });
    expect(container.textContent).toContain('Testo dell\'ente sulla registrazione.');
    expect(container.textContent).not.toContain(t.recordingConsentIntro);
  });

  it('accanto al consenso c\'e\' l\'informativa: il testo dell\'evento si apre sul posto', () => {
    render({
      event: evento,
      recordingConsentRequired: true,
      privacy: { url: '/it/privacy', testo: 'Informativa dell\'evento.' },
    });
    expect(container.textContent).not.toContain('Informativa dell\'evento.');
    premi(pulsante(messages.registration.gdprLink));
    expect(container.textContent).toContain('Informativa dell\'evento.');
  });

  it('senza testo dell\'evento l\'informativa e\' un link', () => {
    render({ event: evento, recordingConsentRequired: true, privacy: { url: '/it/privacy' } });
    const link = Array.from(container.querySelectorAll<HTMLAnchorElement>('a')).find(
      (a) => a.textContent === messages.registration.gdprLink,
    );
    expect(link?.getAttribute('href')).toBe('/it/privacy');
  });

  it('con la registrazione per partecipante si chiedono entrambi, e nessuno ferma', () => {
    render({
      event: { ...evento, multitrackRecordingEnabled: true },
      defaultName: 'Relatore 1',
      recordingConsentRequired: true,
    });
    premi($<HTMLInputElement>('#waiting-recording-consent')!);
    premi($<HTMLInputElement>('#waiting-multitrack-consent')!);
    premi(pulsante(t.joinNowBtn));
    expect(onEnterLive).toHaveBeenCalledWith('Relatore 1', {
      cameraOn: false,
      micOn: false,
      recordingConsent: true,
      recordingConsentDestination: null,
      multitrackConsent: true,
    });
  });

  it('il consenso non chiude la piazza: dal cancello si entra', () => {
    render({
      event: { ...evento, waitingRoomEngine: 'GAME' },
      defaultName: 'Relatore 1',
      recordingConsentRequired: true,
    });
    premi(pulsante(t.enterGardenTitle));
    act(() => {
      piazza.onEnterLive?.('', { cameraOn: false, micOn: false });
    });
    expect(onEnterLive).toHaveBeenCalled();
  });
});

/**
 * Il ciclo di vita visto dalla sala d'attesa: il moderatore può sempre aprire
 * la sala, anche quando è rimasta in preparazione o in pausa senza nessuno che
 * la porti a LIVE; senza scaler non si promette un'accensione che non c'è; e
 * un evento mai aperto oltre la sua fine non dice «attendi l'organizzatore».
 */
describe('sala d\'attesa — ciclo di vita', () => {
  const avvio = vi.fn(async () => undefined);
  const inPreparazione: Evento = {
    ...eventoLive,
    status: 'PROVISIONING',
    startsAt: oraPiu(-1),
    endsAt: oraPiu(59),
  };

  it.each(['PROVISIONING', 'IDLE'] as const)(
    'in %s il moderatore ha «Avvia evento»',
    (status) => {
      render({ event: { ...inPreparazione, status }, role: 'moderator', onStartEvent: avvio });
      expect(pulsante(t.startEventButton).disabled).toBe(false);
    },
  );

  it('chi partecipa non ha «Avvia evento»', () => {
    render({ event: inPreparazione, role: 'participant', onStartEvent: avvio });
    expect(() => pulsante(t.startEventButton)).toThrow();
  });

  it('senza scaler dice quando si apre la sala, non una stima di accensione', () => {
    render({
      event: inPreparazione,
      warmup: { phase: 'scheduled', startedAt: null, serverTime: new Date().toISOString() },
    });
    expect(container.textContent).toContain(t.warmup.scheduled);
    expect(container.textContent).toContain(t.warmup.scheduledDetail);
    expect(container.textContent).not.toContain(t.warmup.honestHint);
  });

  it('con lo scaler resta la stima di accensione', () => {
    render({
      event: inPreparazione,
      warmup: { phase: 'queued', startedAt: null, serverTime: new Date().toISOString() },
    });
    expect(container.textContent).toContain(t.warmup.honestHint);
  });

  it('un evento mai aperto oltre la sua fine: nessuna attesa, nessun avvio', () => {
    render({
      event: { ...eventoLive, status: 'PUBLISHED', startsAt: oraPiu(-90), endsAt: oraPiu(-30) },
      role: 'moderator',
      onStartEvent: avvio,
    });
    expect(container.textContent).toContain(t.notHeldTitle);
    expect(container.textContent).not.toContain(t.startingSoon);
    expect(() => pulsante(t.startEventButton)).toThrow();
    expect($('#waiting-name')).toBeNull();
  });

  it.each(['PROVISIONING', 'IDLE'] as const)(
    'anche %s oltre la fine: niente preparazione in corso, nessun avvio',
    (status) => {
      render({
        event: { ...eventoLive, status, startsAt: oraPiu(-90), endsAt: oraPiu(-30) },
        role: 'moderator',
        onStartEvent: avvio,
        warmup: { phase: 'queued', startedAt: null, serverTime: new Date().toISOString() },
      });
      expect(container.textContent).toContain(t.notHeldTitle);
      expect(container.textContent).not.toContain(t.warmup.honestHint);
      expect(() => pulsante(t.startEventButton)).toThrow();
    },
  );

  it('passata l\'ora d\'inizio non dice «Apertura alle …»: aspetta l\'avvio', () => {
    render({ event: { ...eventoLive, status: 'PUBLISHED', startsAt: oraPiu(-5), endsAt: oraPiu(55) } });
    expect(() => pulsante('Apertura alle')).toThrow();
    expect(pulsante(t.waitingForStartButton).disabled).toBe(true);
  });

  it('chi modera ha «Avvia evento», non un «Apertura alle …» spento', () => {
    render({
      event: { ...eventoLive, status: 'PUBLISHED', startsAt: oraPiu(30), endsAt: oraPiu(90) },
      role: 'moderator',
      onStartEvent: avvio,
    });
    expect(pulsante(t.startEventButton).disabled).toBe(false);
    expect(() => pulsante('Apertura alle')).toThrow();
  });

  it('dopo «Avvia evento» chi modera entra senza un secondo clic', async () => {
    const pubblicato: Evento = { ...eventoLive, status: 'PUBLISHED', startsAt: oraPiu(-1), endsAt: oraPiu(59) };
    window.localStorage.setItem('pawebinar.participant.name', 'Moderatore 1');
    render({ event: pubblicato, role: 'moderator', onStartEvent: avvio });
    await act(async () => {
      pulsante(t.startEventButton).click();
    });
    expect(onEnterLive).not.toHaveBeenCalled();
    render({ event: { ...pubblicato, status: 'LIVE' }, role: 'moderator', onStartEvent: avvio });
    expect(onEnterLive).toHaveBeenCalledTimes(1);
    expect(onEnterLive.mock.calls[0]?.[0]).toBe('Moderatore 1');
  });

  it('dopo «Avvia evento» non entra da solo se il ponte non e\' pronto', async () => {
    const pubblicato: Evento = { ...eventoLive, status: 'PUBLISHED', startsAt: oraPiu(-1), endsAt: oraPiu(59) };
    window.localStorage.setItem('pawebinar.participant.name', 'Moderatore 1');
    render({ event: pubblicato, role: 'moderator', onStartEvent: avvio });
    await act(async () => {
      pulsante(t.startEventButton).click();
    });
    render({ event: { ...pubblicato, status: 'LIVE' }, role: 'moderator', onStartEvent: avvio, jvbReady: false });
    expect(onEnterLive).not.toHaveBeenCalled();
  });

  it('dopo «Avvia evento» non entra da solo se la domanda sulla trascrizione e\' da vedere', async () => {
    const pubblicato: Evento = { ...eventoLive, status: 'PUBLISHED', startsAt: oraPiu(-1), endsAt: oraPiu(59) };
    window.localStorage.setItem('pawebinar.participant.name', 'Moderatore 1');
    const conTrascrizione: Evento = { ...pubblicato, captionsTranscript: true };
    render({ event: conTrascrizione, role: 'moderator', onStartEvent: avvio });
    await act(async () => {
      pulsante(t.startEventButton).click();
    });
    render({ event: { ...conTrascrizione, status: 'LIVE' }, role: 'moderator', onStartEvent: avvio });
    expect(onEnterLive).not.toHaveBeenCalled();
  });

  it('se la sala diventa LIVE prima della risposta dell\'avvio, entra lo stesso', async () => {
    const pubblicato: Evento = { ...eventoLive, status: 'PUBLISHED', startsAt: oraPiu(-1), endsAt: oraPiu(59) };
    window.localStorage.setItem('pawebinar.participant.name', 'Moderatore 1');
    let risolvi: () => void = () => {};
    const avvioLento = vi.fn(() => new Promise<void>((r) => { risolvi = r; }));
    render({ event: pubblicato, role: 'moderator', onStartEvent: avvioLento });
    act(() => {
      pulsante(t.startEventButton).click();
    });
    render({ event: { ...pubblicato, status: 'LIVE' }, role: 'moderator', onStartEvent: avvioLento });
    expect(onEnterLive).toHaveBeenCalledTimes(1);
    await act(async () => {
      risolvi();
    });
    expect(onEnterLive).toHaveBeenCalledTimes(1);
  });

  it('passata l\'ora d\'inizio, un\'accensione lunga si dice, senza un «Riprova» che non farebbe niente', () => {
    const ora = Date.now();
    render({
      event: { ...inPreparazione, startsAt: oraPiu(-8) },
      warmup: {
        phase: 'starting',
        startedAt: new Date(ora - 7 * 60_000).toISOString(),
        serverTime: new Date(ora).toISOString(),
      },
    });
    expect(container.textContent).toContain(t.warmup.slow);
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('Riprova'))).toBe(false);
  });

  it('una sala preparata prima dell\'inizio non e\' «lenta»', () => {
    const ora = Date.now();
    render({
      event: { ...inPreparazione, startsAt: oraPiu(5), endsAt: oraPiu(65) },
      warmup: {
        phase: 'starting',
        startedAt: new Date(ora - 10 * 60_000).toISOString(),
        serverTime: new Date(ora).toISOString(),
      },
    });
    expect(container.textContent).not.toContain(t.warmup.slow);
  });

  it('prima della fine resta l\'attesa di sempre', () => {
    render({
      event: { ...eventoLive, status: 'PUBLISHED', startsAt: oraPiu(-5), endsAt: oraPiu(55) },
    });
    expect(container.textContent).toContain(t.startingSoon);
    expect(container.textContent).not.toContain(t.notHeldTitle);
  });
});

describe('sala d\'attesa — evento concluso', () => {
  it('niente buone pratiche per entrare in una sala già chiusa', () => {
    render({ event: { ...eventoLive, status: 'ENDED', startsAt: oraPiu(-90), endsAt: oraPiu(-30) } });
    expect(container.textContent).toContain(t.endedTitle);
    expect(container.textContent).not.toContain(t.netiquetteTitle);
  });

  it('prima della fine le buone pratiche restano', () => {
    render();
    expect(container.textContent).toContain(t.netiquetteTitle);
  });
});

describe('sala d\'attesa — il nome di chi entra dal proprio link d\'iscrizione', () => {
  it('non si modifica e dice che e\' quello dell\'iscrizione', () => {
    render({ role: 'participant', defaultName: 'Anna Bianchi', nomeDellIscrizione: true });
    const campo = $<HTMLInputElement>('#waiting-name')!;
    expect(campo.readOnly).toBe(true);
    expect(campo.value).toBe('Anna Bianchi');
    expect($('#waiting-name-help')?.textContent).toBe(t.registeredNameHelp);
    expect(campo.getAttribute('aria-describedby')).toContain('waiting-name-help');
  });

  it('senza nome (link inoltrato) resta da scrivere', () => {
    render({ role: 'participant', defaultName: '', nomeDellIscrizione: true });
    expect($<HTMLInputElement>('#waiting-name')!.readOnly).toBe(false);
  });

  it('chi conduce lo puo\' sempre cambiare', () => {
    render({ role: 'moderator', conduce: true, defaultName: 'Relatore 1', nomeDellIscrizione: true });
    expect($<HTMLInputElement>('#waiting-name')!.readOnly).toBe(false);
  });

  it('un nome dell\'iscrizione troppo corto per entrare resta da correggere', () => {
    render({ role: 'participant', defaultName: 'A ', nomeDellIscrizione: true });
    expect($<HTMLInputElement>('#waiting-name')!.readOnly).toBe(false);
  });
});

describe('sala d\'attesa — consenso alla registrazione di chi conduce o interviene', () => {
  const evento: Evento = { ...eventoLive, recordingEnabled: true, multitrackRecordingEnabled: true };
  const conduce = {
    role: 'moderator' as const,
    conduce: true,
    conduceDaIncarico: true,
    defaultName: 'Relatore 1',
    event: evento,
    recordingConsentRequired: true,
    recordingConsentOptional: true,
  };

  it('facoltativo: dice cosa succede senza, e si entra lo stesso', () => {
    render(conduce);
    expect(container.textContent).toContain(messages.gdpr.consent.recordingOptionalVoice);
    expect(container.textContent).not.toContain(messages.gdpr.consent.recordingOptionalListenOnly);
    premi(pulsante(t.joinNowBtn));
    expect(onEnterLive).toHaveBeenCalledWith('Relatore 1', { cameraOn: false, micOn: false });
  });

  it('la trascrizione dei propri interventi si apre solo dopo il consenso alla registrazione', () => {
    render(conduce);
    const trascrizione = $<HTMLInputElement>('#waiting-multitrack-consent')!;
    expect(trascrizione.disabled).toBe(true);
    expect(trascrizione.getAttribute('aria-describedby')).toContain('waiting-recording-consent-required');

    premi($<HTMLInputElement>('#waiting-recording-consent')!);
    expect($<HTMLInputElement>('#waiting-multitrack-consent')!.disabled).toBe(false);
    premi($<HTMLInputElement>('#waiting-multitrack-consent')!);
    premi(pulsante(t.joinNowBtn));
    expect(onEnterLive).toHaveBeenCalledWith('Relatore 1', {
      cameraOn: false,
      micOn: false,
      recordingConsent: true,
      recordingConsentDestination: null,
      multitrackConsent: true,
    });
  });

  it('togliendo il consenso alla registrazione, la trascrizione non parte', () => {
    render(conduce);
    premi($<HTMLInputElement>('#waiting-recording-consent')!);
    premi($<HTMLInputElement>('#waiting-multitrack-consent')!);
    premi($<HTMLInputElement>('#waiting-recording-consent')!);
    expect($<HTMLInputElement>('#waiting-multitrack-consent')!.checked).toBe(false);
    premi(pulsante(t.joinNowBtn));
    expect(onEnterLive).toHaveBeenCalledWith('Relatore 1', { cameraOn: false, micOn: false });
  });
});

describe('sala d\'attesa — il testo segue la destinazione', () => {
  const evento: Evento = { ...eventoLive, recordingEnabled: true };
  const g = messages.gdpr.consent;
  const etichetta = () => $('label[for="waiting-recording-consent"]')?.textContent;
  const ingresso = { event: evento, defaultName: 'Relatore 1', recordingConsentRequired: true };

  it('la casella dichiara dove va il video', () => {
    render({ ...ingresso, recordingDestination: 'REGISTRANTS' });
    expect(etichetta()).toBe(g.recordingReserved);
    render({ ...ingresso, recordingDestination: 'PUBLIC' });
    expect(etichetta()).toBe(g.recordingPublic);
    render({ ...ingresso, recordingDestination: null });
    expect(etichetta()).toBe(g.recording);
  });

  it('senza video lo dice sopra e nella casella, qualunque sia la destinazione', () => {
    render({ ...ingresso, recordingDestination: 'PUBLIC', partecipanti: 'assente' });
    expect(etichetta()).toBe(g.recordingNoVideo);
    expect(container.textContent).toContain(t.recordingConsentIntroNoVideo);
    expect(container.textContent).not.toContain(t.recordingConsentIntro);
  });

  it('su un evento anonimo la registrazione contiene lo pseudonimo, non il nome', () => {
    render({ ...ingresso, event: { ...evento, audienceAnonymous: true } });
    expect(container.textContent).toContain(t.recordingConsentIntroAnonymous);
    expect(container.textContent).not.toContain(t.recordingConsentIntro);
  });

  it('chi conduce un evento anonimo resta col nome, anche nella registrazione', () => {
    render({ ...ingresso, event: { ...evento, audienceAnonymous: true }, conduce: true });
    expect(container.textContent).toContain(t.recordingConsentIntro);
    expect(container.textContent).not.toContain(t.recordingConsentIntroAnonymous);
  });

  it('senza video il testo scelto per l\'evento non si mostra: direbbe il contrario della casella', () => {
    render({ ...ingresso, partecipanti: 'assente', recordingConsentText: 'Testo dell\'ente.' });
    expect(container.textContent).not.toContain('Testo dell\'ente.');
    expect(container.textContent).toContain(t.recordingConsentIntroNoVideo);
  });

  it('con un video il testo scelto per l\'evento resta', () => {
    render({ ...ingresso, partecipanti: 'visibili', recordingConsentText: 'Testo dell\'ente.' });
    expect(container.textContent).toContain('Testo dell\'ente.');
    expect(container.textContent).not.toContain(t.recordingConsentIntro);
  });

  it('il consenso viaggia con il testo su cui si e\' spuntata la casella', () => {
    render({ ...ingresso, recordingDestination: 'PUBLIC' });
    premi($<HTMLInputElement>('#waiting-recording-consent')!);
    premi(pulsante(t.joinNowBtn));
    expect(onEnterLive).toHaveBeenCalledWith('Relatore 1', {
      cameraOn: false,
      micOn: false,
      recordingConsent: true,
      recordingConsentDestination: 'PUBLIC',
    });
  });

  it('la spunta resta legata al testo letto, anche se quello mostrato cambia dopo', () => {
    render({ ...ingresso, recordingDestination: 'REGISTRANTS' });
    premi($<HTMLInputElement>('#waiting-recording-consent')!);
    render({ ...ingresso, recordingDestination: 'PUBLIC' });
    expect(etichetta()).toBe(g.recordingPublic);
    premi(pulsante(t.joinNowBtn));
    expect(onEnterLive.mock.calls[0]?.[1]).toMatchObject({
      recordingConsentDestination: 'REGISTRANTS',
    });
  });

  it('il testo vuoto viaggia come null, non come campo assente', () => {
    render({ ...ingresso, recordingDestination: null });
    premi($<HTMLInputElement>('#waiting-recording-consent')!);
    premi(pulsante(t.joinNowBtn));
    expect(onEnterLive.mock.calls[0]?.[1]).toHaveProperty('recordingConsentDestination', null);
  });

  it('chi conduce ed e\' sempre nel video legge dove va', () => {
    const conduce = { event: evento, defaultName: 'Relatore 1', recordingHostAlways: true };
    render({ ...conduce, recordingDestination: 'REGISTRANTS' });
    expect(container.textContent).toContain(g.recordingHostAlwaysReserved);
    render({ ...conduce, recordingDestination: 'PUBLIC' });
    expect(container.textContent).toContain(g.recordingHostAlwaysPublic);
    render({ ...conduce, recordingDestination: null });
    expect(container.textContent).toContain(g.recordingHostAlways);
  });
});

describe('sala d\'attesa — trascrizione', () => {
  const g = messages.gdpr.consent;
  const etichetta = () => $('label[for="waiting-multitrack-consent"]')?.textContent;

  it('si chiede anche quando parte dal video', () => {
    render({ event: { ...eventoLive, trascrizioneVideo: true }, defaultName: 'Relatore 1' });
    expect(etichetta()).toBe(g.multitrack);
  });

  it('dove le tracce si conservano il testo non ne promette la cancellazione', () => {
    render({
      event: { ...eventoLive, multitrackRecordingEnabled: true, tracceConservate: true },
      defaultName: 'Relatore 1',
    });
    expect(etichetta()).toBe(g.multitrackRetained);
  });

  it('dove si avvisa soltanto e la voce si toglie, non si chiede', () => {
    render({
      event: { ...eventoLive, trascrizioneVideo: true },
      defaultName: 'Relatore 1',
      recordingListenOnly: true,
    });
    expect($('#waiting-multitrack-consent')).toBeNull();
  });

  it('chi l\'ha gia\' data non la rivede', () => {
    render({
      event: { ...eventoLive, trascrizioneVideo: true },
      defaultName: 'Relatore 1',
      multitrackConsentExempt: true,
    });
    expect($('#waiting-multitrack-consent')).toBeNull();
  });
});

describe('sala d\'attesa — la scheda privacy', () => {
  const sheet = messages.gdpr.sheet;
  const gdprLink = messages.registration.gdprLink;
  const SCHEDA: SchedaPrivacy = {
    registrazione: {
      modo: 'manuale',
      destinazione: 'PUBLIC',
      chiNonAcconsente: 'restaFuori',
      conduceSempre: false,
      partecipanti: null,
    },
    trascrizione: { chiesta: false, sottotitoli: false, tracce: null, dalVideo: false },
    sottotitoli: { attivi: true, testoConservato: false },
    ia: { sintesi: true, traduzione: false, doppiaggio: false, elaborabileDopo: false },
    chat: { attiva: true, domandeAttive: true, esitoDomande: 'soloTesto' },
    elencoVisibile: true,
    pseudonimi: false,
    conservazione: { giorniDati: 30, registrazione: { giorni: null, video: true } },
    rubrica: null,
  };
  const SENZA_REGISTRAZIONE: SchedaPrivacy = {
    ...SCHEDA,
    registrazione: {
      modo: 'nessuna',
      destinazione: null,
      chiNonAcconsente: null,
      conduceSempre: false,
      partecipanti: null,
    },
  };
  const eventoConAvvisi: Evento = {
    ...eventoLive,
    recordingEnabled: true,
    aiPostprodEnabled: true,
    liveCaptions: true,
  };
  const linkInformativa = () =>
    Array.from(container.querySelectorAll<HTMLAnchorElement>('a')).filter(
      (a) => a.textContent === gdprLink,
    );

  it('compare aperta, con il testo intero, senza caselle da spuntare', () => {
    render({ event: eventoConAvvisi, schedaPrivacy: SCHEDA });
    expect($('#waiting-recording-consent')).toBeNull();
    expect(container.textContent).toContain(sheet.title);
    expect(container.textContent).toContain(sheet.recording.manual);
    expect(container.textContent).toContain(sheet.chat.messages);
    expect(container.querySelector('details .wr-facts--frasi')).toBeNull();
  });

  it('assorbe l\'avviso AI e quello dei sottotitoli, senza ripeterli', () => {
    render({ event: eventoConAvvisi, schedaPrivacy: SCHEDA });
    expect(container.textContent).not.toContain(t.aiNoticeTitle);
    expect(container.textContent).not.toContain(t.aiNotice);
    expect(container.textContent).not.toContain(t.captionsNoticeTitle);
    expect(container.textContent).toContain(sheet.ai.summary);
    expect(container.textContent).toContain(sheet.ai.accuracy);
    expect(container.textContent?.split(t.captionsNotice)).toHaveLength(2);
  });

  it('il testo dell\'amministrazione finisce nella scheda', () => {
    render({
      event: { ...eventoConAvvisi, aiConsentDisclosure: 'Testo scritto dall\'ente.' },
      schedaPrivacy: SCHEDA,
    });
    expect(container.textContent).toContain('Testo scritto dall\'ente.');
    expect(container.textContent).not.toContain(sheet.ai.summary);
  });

  it('senza scheda, come sulle chiamate rapide, gli avvisi restano', () => {
    render({ event: eventoConAvvisi, schedaPrivacy: null });
    expect(container.textContent).not.toContain(sheet.title);
    expect(container.textContent).toContain(t.aiNotice);
    expect(container.textContent).toContain(t.captionsNotice);
  });

  it('il link all\'informativa sta accanto alla scheda anche senza caselle', () => {
    render({ event: eventoLive, schedaPrivacy: SCHEDA, privacy: { url: '/it/privacy' } });
    expect($('.wr-consensi')).toBeNull();
    expect(linkInformativa()).toHaveLength(1);
    expect(linkInformativa()[0]?.getAttribute('href')).toBe('/it/privacy');
  });

  it('con le caselle il link non sta dentro il blocco dei consensi, e compare una volta', () => {
    render({
      event: { ...eventoLive, recordingEnabled: true },
      schedaPrivacy: SCHEDA,
      recordingConsentRequired: true,
      privacy: { url: '/it/privacy' },
    });
    expect($('.wr-consensi')).not.toBeNull();
    expect($('.wr-consensi .wr-consensi__privacy')).toBeNull();
    expect(linkInformativa()).toHaveLength(1);
  });

  it('il testo dell\'informativa si apre sul posto anche senza caselle', () => {
    render({
      event: eventoLive,
      schedaPrivacy: SCHEDA,
      privacy: { url: '/it/privacy', testo: 'Informativa dell\'evento.' },
    });
    premi(pulsante(gdprLink));
    expect(container.textContent).toContain('Informativa dell\'evento.');
    expect(container.querySelectorAll('#wr-consensi-informativa')).toHaveLength(1);
  });

  it('senza scheda e senza caselle il link non compare da solo', () => {
    render({ event: eventoLive, privacy: { url: '/it/privacy' } });
    expect(linkInformativa()).toHaveLength(0);
  });

  it('sta prima del pulsante per entrare, sotto i consensi', () => {
    render({
      event: { ...eventoLive, recordingEnabled: true },
      schedaPrivacy: SCHEDA,
      recordingConsentRequired: true,
      defaultName: 'Relatore 1',
    });
    const segue = (prima: Node, dopo: Node) =>
      (prima.compareDocumentPosition(dopo) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const titolo = Array.from(container.querySelectorAll('h2')).find(
      (h) => h.textContent === sheet.title,
    ) as Node;
    expect(segue($('.wr-consensi') as Node, titolo)).toBe(true);
    expect(segue(titolo, pulsante(t.enterNow))).toBe(true);
  });

  it('a evento concluso non compare', () => {
    render({ event: { ...eventoConAvvisi, status: 'ENDED' }, schedaPrivacy: SCHEDA });
    expect(container.textContent).not.toContain(sheet.title);
    expect(container.textContent).not.toContain(t.aiNotice);
  });

  it('un evento mai tenuto non ha una scheda', () => {
    render({
      event: { ...eventoConAvvisi, status: 'PUBLISHED', endsAt: oraPiu(-30), startsAt: oraPiu(-90) },
      schedaPrivacy: SCHEDA,
    });
    expect(container.textContent).toContain(t.notHeldTitle);
    expect(container.textContent).not.toContain(sheet.title);
  });

  it('il riepilogo resta di una riga, e non promette una registrazione certa', () => {
    render({ event: { ...eventoLive, recordingEnabled: true }, schedaPrivacy: SCHEDA });
    expect(container.textContent).toContain(t.recordingNotice);
    expect(t.recordingNotice).not.toMatch(/viene registrato/);
    expect(t.recordingNotice).not.toBe(sheet.recording.manual);
  });

  it('di solo ascolto, il riepilogo non ripete la frase della scheda', () => {
    render({
      event: { ...eventoLive, recordingEnabled: true },
      schedaPrivacy: {
        ...SCHEDA,
        registrazione: { ...SCHEDA.registrazione, chiNonAcconsente: 'avvisoVoce' },
      },
      recordingListenOnly: true,
    });
    expect(container.textContent).toContain(t.recordingNotice);
    expect(container.textContent).not.toContain(messages.gdpr.consent.recordingNoticeVoice);
    expect(container.textContent).toContain(sheet.recording.audienceNoticeVoice);
  });

  it('se la scheda dice che non si registra niente, il riepilogo non lo annuncia', () => {
    render({
      event: { ...eventoLive, recordingEnabled: true },
      schedaPrivacy: SENZA_REGISTRAZIONE,
      partecipanti: 'assente',
    });
    expect(container.textContent).toContain(sheet.recording.none);
    expect(container.textContent).not.toContain(t.recordingNotice);
    expect($('.wr-fact__rec')).toBeNull();
  });

  it('chi conduce ed e\' sempre nel video tiene la sua riga', () => {
    render({
      event: { ...eventoLive, recordingEnabled: true },
      schedaPrivacy: SCHEDA,
      recordingHostAlways: true,
      recordingDestination: 'PUBLIC',
    });
    expect(container.textContent).toContain(messages.gdpr.consent.recordingHostAlwaysPublic);
    expect(container.textContent).not.toContain(t.recordingNotice);
  });

  it('non cambia cio\' che ferma l\'ingresso', () => {
    render({
      event: { ...eventoLive, recordingEnabled: true },
      schedaPrivacy: SCHEDA,
      recordingConsentRequired: true,
      defaultName: 'Relatore 1',
    });
    premi(pulsante(t.enterNow));
    expect(onEnterLive).toHaveBeenCalledTimes(1);
  });
});

describe('sala d\'attesa — video a evento concluso', () => {
  const concluso: Evento = { ...eventoLive, status: 'ENDED', endsAt: oraPiu(-5) };
  const link = () =>
    Array.from(container.querySelectorAll('a')).find((a) =>
      a.textContent?.includes(t.endedWatchRecording),
    );

  it('il link porta alla rotta del video', () => {
    render({ event: { ...concluso, videoDisponibile: true } });
    expect(link()?.getAttribute('href')).toBe(`/api/events/${concluso.slug}/recording`);
  });

  it('senza il diritto di vederlo il link non c\'e\'', () => {
    render({ event: { ...concluso, videoDisponibile: false } });
    expect(link()).toBeUndefined();
    render({ event: concluso });
    expect(link()).toBeUndefined();
  });

  it('a evento concluso nessuna casella', () => {
    render({ event: { ...concluso, trascrizioneVideo: true }, recordingConsentRequired: true });
    expect($('#waiting-multitrack-consent')).toBeNull();
    expect($('#waiting-recording-consent')).toBeNull();
  });
});

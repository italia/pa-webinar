import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

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
      <WaitingRoom
        event={eventoLive}
        participantCount={0}
        role="guest"
        jvbReady
        defaultName=""
        onEnterLive={onEnterLive}
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
    expect(nome.classList.contains('is-invalid')).toBe(true);
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
  it('senza consenso alla registrazione per partecipante non si entra', () => {
    render({
      role: 'participant',
      defaultName: 'Relatore 1',
      event: { ...eventoLive, multitrackRecordingEnabled: true },
    });
    const entra = pulsante(t.joinNowBtn);
    expect(entra.getAttribute('aria-describedby')).toBe('waiting-multitrack-consent-required');

    premi(entra);
    expect(onEnterLive).not.toHaveBeenCalled();
    const consenso = $<HTMLInputElement>('#waiting-multitrack-consent')!;
    expect(document.activeElement).toBe(consenso);

    premi(consenso);
    premi(pulsante(t.joinNowBtn));
    expect(onEnterLive).toHaveBeenCalledTimes(1);
    expect(onEnterLive).toHaveBeenCalledWith('Relatore 1', { cameraOn: false, micOn: false });
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

  it('email non valida: non si entra e il fuoco va sull\'email', () => {
    render();
    scrivi('#waiting-name', 'Relatore 1');
    scrivi('#waiting-email', 'non-una-email');
    const entra = pulsante(t.joinNowBtn);
    expect(entra.getAttribute('aria-describedby')).toBe('waiting-email-invalid');

    premi(entra);
    expect(onEnterLive).not.toHaveBeenCalled();
    expect(document.activeElement).toBe($('#waiting-email'));
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

  it('prima della fine resta l\'attesa di sempre', () => {
    render({
      event: { ...eventoLive, status: 'PUBLISHED', startsAt: oraPiu(-5), endsAt: oraPiu(55) },
    });
    expect(container.textContent).toContain(t.startingSoon);
    expect(container.textContent).not.toContain(t.notHeldTitle);
  });
});

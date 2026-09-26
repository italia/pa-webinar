import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

/**
 * I pulsanti della scheda pubblica li decide il server: se l'evento accetta
 * iscrizioni (con l'ora del server, non con lo stato soltanto) e se c'è un
 * questionario post-evento a cui invitare. Qui si verifica che il client li
 * rispetti: un pulsante che porta a una pagina 404, o un invito che chiede al
 * server un questionario inesistente, è peggio di nessun pulsante.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  percorso: (p: string) => p,
}));
// Figli pesanti o con richieste di rete propri: qui conta solo se compaiono.
vi.mock('@/components/events/post-event-feedback-invite', () => ({
  default: () => <div data-testid="invito-questionario" />,
}));
vi.mock('@/components/events/add-to-calendar', () => ({
  default: () => <div data-testid="aggiungi-al-calendario" />,
}));
vi.mock('@/components/events/post-event-tabs', () => ({ default: () => null }));
vi.mock('@/components/events/video-player', () => ({ default: () => null }));
vi.mock('@/components/events/bookmarks-panel', () => ({ default: () => null }));
vi.mock('@/components/ui/markdown', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <p>{content}</p>,
}));

import EventDetailClient from './event-detail-client';

const SLUG = 'evento-di-prova';
const HOUR = 3600_000;
const detail = messages.events.detail;

let container: HTMLDivElement;
let root: Root;

function evento(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: '22222222-2222-4222-8222-222222222222',
    slug: SLUG,
    title: { it: 'Evento di prova' },
    description: { it: 'Descrizione' },
    startsAt: new Date(now + 2 * HOUR).toISOString(),
    endsAt: new Date(now + 4 * HOUR).toISOString(),
    timezone: 'Europe/Rome',
    maxParticipants: 100,
    registrationCount: 0,
    status: 'PUBLISHED',
    recordingUrl: null,
    qaEnabled: false,
    chatEnabled: false,
    privacyPolicyUrl: null,
    speakersInfo: null,
    organizerName: null,
    imageUrl: null,
    postEventShowFeedback: true,
    ...over,
  };
}

function disegna(props: {
  event: ReturnType<typeof evento>;
  registrationOpen: boolean;
  hasRoomAccess?: boolean;
  invalidToken?: boolean;
  hasPostEventQuestionnaire?: boolean;
}) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <EventDetailClient locale="it" appUrl="https://example.org" {...props} />
      </NextIntlClientProvider>
    );
  });
}

function link(href: string): HTMLAnchorElement | null {
  return container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 }))
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('scheda pubblica — iscrizione', () => {
  it('evento in programma: pulsante d’iscrizione e promemoria di calendario', () => {
    disegna({ event: evento(), registrationOpen: true });
    expect(link(`/events/${SLUG}/registration`)?.textContent).toContain(detail.register);
    expect(
      container.querySelector('[data-testid="aggiungi-al-calendario"]')
    ).not.toBeNull();
    expect(container.textContent).not.toContain(detail.registrationEnded);
  });

  it('oltre l’orario di fine senza che la sala si sia aperta: niente iscrizione, evento concluso', () => {
    // Lo stato è ancora PUBLISHED (il giro del ciclo di vita non è passato),
    // ma il server dice che l'iscrizione è chiusa.
    disegna({
      event: evento({
        startsAt: new Date(Date.now() - 3 * HOUR).toISOString(),
        endsAt: new Date(Date.now() - HOUR).toISOString(),
      }),
      registrationOpen: false,
    });
    expect(link(`/events/${SLUG}/registration`)).toBeNull();
    expect(container.textContent).not.toContain(detail.register);
    expect(container.textContent).toContain(detail.registrationEnded);
    // Il badge dice «Concluso», non «Pubblicato».
    expect(container.textContent).toContain(messages.events.status.ENDED);
    expect(container.textContent).not.toContain(messages.events.status.PUBLISHED);
    expect(container.querySelector('[data-testid="aggiungi-al-calendario"]')).toBeNull();
  });

  it('chi si era iscritto non trova l’ingresso a una sala che non si apre più', () => {
    disegna({
      event: evento({ endsAt: new Date(Date.now() - HOUR).toISOString() }),
      registrationOpen: false,
      hasRoomAccess: true,
    });
    expect(link(`/events/${SLUG}/live`)).toBeNull();
    expect(container.textContent).not.toContain(detail.registered);
  });

  it('link personale non valido su un evento oltre la fine: non invita a iscriversi di nuovo', () => {
    disegna({
      event: evento({ endsAt: new Date(Date.now() - HOUR).toISOString() }),
      registrationOpen: false,
      invalidToken: true,
    });
    expect(container.textContent).toContain(detail.invalidTokenTitle);
    expect(container.textContent).not.toContain(detail.invalidTokenBody);
  });

  it('con l’iscrizione aperta il link personale non valido invita a iscriversi di nuovo', () => {
    disegna({ event: evento(), registrationOpen: true, invalidToken: true });
    expect(container.textContent).toContain(detail.invalidTokenBody);
  });
});

describe('scheda pubblica — invito al questionario post-evento', () => {
  const concluso = () =>
    evento({
      status: 'ENDED',
      startsAt: new Date(Date.now() - 4 * HOUR).toISOString(),
      endsAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    });

  it('compare quando l’evento ha un questionario', () => {
    disegna({
      event: concluso(),
      registrationOpen: false,
      hasPostEventQuestionnaire: true,
    });
    expect(container.querySelector('[data-testid="invito-questionario"]')).not.toBeNull();
  });

  it('senza questionario non compare', () => {
    disegna({
      event: concluso(),
      registrationOpen: false,
      hasPostEventQuestionnaire: false,
    });
    expect(container.querySelector('[data-testid="invito-questionario"]')).toBeNull();
  });

  it('con il feedback pubblico spento non compare nemmeno se il questionario c’è', () => {
    disegna({
      event: { ...concluso(), postEventShowFeedback: false },
      registrationOpen: false,
      hasPostEventQuestionnaire: true,
    });
    expect(container.querySelector('[data-testid="invito-questionario"]')).toBeNull();
  });

  it('un evento concluso non si presenta come «terminato senza sala»', () => {
    disegna({ event: concluso(), registrationOpen: false });
    expect(container.textContent).not.toContain(detail.registrationEnded);
    expect(container.textContent).toContain(detail.eventEnded);
  });
});

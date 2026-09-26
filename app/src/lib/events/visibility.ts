import type { EventStatus, Prisma } from '@prisma/client';

/**
 * Visibilità pubblica degli eventi per stato.
 *
 * PROVISIONING e IDLE sono fasi di vita NORMALI di un evento schedulato:
 * il pre-warm del bridge prima dell'inizio (PROVISIONING, anche 30' prima
 * via scaler) e la pausa senza traffico (IDLE, torna LIVE alla prima
 * visita). In quelle fasi la pagina evento, i listing, la sitemap, i
 * reminder e la registrazione devono continuare a funzionare: un
 * partecipante che apre il link pubblico 10 minuti prima dell'inizio non
 * deve trovare un 404.
 *
 * Due guardie sugli stati di warm-up:
 * - le instant call (eventType INSTANT) restano fuori dalle superfici
 *   pubbliche quando sono parcheggiate: sono chiamate link-only, non
 *   eventi a calendario;
 * - endsAt deve essere nel futuro: la transizione a ENDED la fa il giro
 *   del ciclo di vita (lib/events/lifecycle-tick), e se il suo conduttore
 *   è fermo o sospeso un evento FINITO ma incagliato in IDLE non deve
 *   tornare "in arrivo" e registrabile.
 */

/** Stati sempre visibili pubblicamente, per qualunque tipo di evento. */
export const ALWAYS_PUBLIC_STATUSES: EventStatus[] = ['PUBLISHED', 'LIVE', 'ENDED'];

/** Stati di warm-up/pausa: pubblici SOLO per eventi schedulati non finiti. */
export const WARMUP_STATUSES: EventStatus[] = ['PROVISIONING', 'IDLE'];

/**
 * Stati in cui la registrazione può essere aperta. Per le superfici CLIENT,
 * che ricevono solo eventi già passati dal filtro server (eventType/endsAt
 * inclusi): lato server usare SEMPRE isEventOpenForRegistration.
 */
export const REGISTRABLE_STATUSES: EventStatus[] = [
  'PUBLISHED',
  'PROVISIONING',
  'IDLE',
  'LIVE',
];

interface EventLike {
  status: string;
  eventType: string | null;
  endsAt: Date | string;
}

/**
 * Campi che governano la visibilità pubblica DOPO la fine dell'evento.
 * `postEventPublic` è il toggle admin "pagina post-evento visibile";
 * `postEventPublicUntil`, se valorizzato, è la scadenza oltre la quale la
 * pagina non è più pubblica. Sono richiesti solo da isEventPubliclyVisible
 * (che deve poter negare l'accesso a un ENDED spento/scaduto) — i controlli
 * di warm-up/registrazione non ne hanno bisogno.
 */
interface PostEventVisibilityFields {
  postEventPublic: boolean;
  postEventPublicUntil: Date | string | null;
}

// `now` e' facoltativo in tutte le funzioni che dipendono dall'ora: il server
// usa l'orologio, un Client Component passa l'istante del rendering sul server
// cosi' che la prima passata nel browser dia lo stesso risultato.
function isWarmupPubliclyVisible(event: EventLike, now: number = Date.now()): boolean {
  return (
    (WARMUP_STATUSES as string[]).includes(event.status) &&
    event.eventType !== 'INSTANT' &&
    new Date(event.endsAt).getTime() > now
  );
}

/**
 * True se la pagina post-evento (ENDED) deve restare pubblica: richiede il
 * toggle attivo e, se impostata, una scadenza ancora futura. Un evento
 * concluso con `postEventPublic=false` o finestra scaduta torna 404 (e sparisce
 * dai listing) — coerente con come `lib/ai/access.ts` gestisce già la finestra
 * per i download di registrazione/AI.
 */
function isEndedPostEventVisible(
  event: PostEventVisibilityFields,
  now: number = Date.now(),
): boolean {
  if (!event.postEventPublic) return false;
  if (
    event.postEventPublicUntil != null &&
    new Date(event.postEventPublicUntil).getTime() <= now
  ) {
    return false;
  }
  return true;
}

/**
 * True se l'evento ha una PAGINA pubblica, cioè una scheda con descrizione,
 * relatori e iscrizione.
 *
 * Una chiamata istantanea non ce l'ha: è usa-e-getta e si apre dal link, quindi
 * finché è viva non ha senso pubblicarne una scheda — chi ha il link entra in
 * sala, chi non ce l'ha non deve trovare niente. L'unica scheda che resta
 * sensata è quella DOPO: la pagina post-evento con la registrazione, che però
 * l'amministratore deve accendere di proposito (le nuove chiamate nascono con
 * `postEventPublic` spento).
 *
 * Deliberatamente distinta da `isEventPubliclyVisible`: quella risponde «si può
 * stare in questa stanza», e la usano le superfici DENTRO la sala — materiali,
 * canale live. Confonderle spegnerebbe il canale realtime delle istantanee.
 */
export function isEventPageVisible(
  event: EventLike & PostEventVisibilityFields,
  now: number = Date.now(),
): boolean {
  if (event.eventType === 'INSTANT' && event.status !== 'ENDED') return false;
  return isEventPubliclyVisible(event, now);
}

/** True se la pagina pubblica dell'evento deve essere raggiungibile. */
export function isEventPubliclyVisible(
  event: EventLike & PostEventVisibilityFields,
  now: number = Date.now(),
): boolean {
  if (event.status === 'ENDED') {
    return isEndedPostEventVisible(event, now);
  }
  return (
    (ALWAYS_PUBLIC_STATUSES as string[]).includes(event.status) ||
    isWarmupPubliclyVisible(event, now)
  );
}

/**
 * True se l'evento accetta nuove registrazioni (pagina + POST API).
 *
 * Un evento non ancora aperto (PUBLISHED, o in warm-up) la accetta solo fino a
 * `endsAt`: oltre, è un evento che non si è tenuto, qualunque stato abbia
 * ancora — la chiusura la fa il giro del ciclo di vita, e fra la fine e il suo
 * passaggio nessuno deve potersi iscrivere né ricevere una conferma. Un evento
 * LIVE resta aperto anche oltre `endsAt`: la grace e le sale a tempo
 * indefinito lo tengono legittimamente in corso, e a chiuderlo è lo stesso
 * giro.
 */
export function isEventOpenForRegistration(
  event: EventLike,
  now: number = Date.now(),
): boolean {
  if (event.status === 'LIVE') return true;
  if (event.status === 'PUBLISHED') return new Date(event.endsAt).getTime() > now;
  return isWarmupPubliclyVisible(event, now);
}

/**
 * Frammento Prisma `where` per le superfici pubbliche (listing, home,
 * sitemap, calendario, API pubblica). `includeEnded: false` per le
 * superfici solo-futuro (home). Da combinare con altre condizioni via
 * spread: le chiavi extra vanno in AND con l'OR restituito.
 */
export function publicEventStatusWhere(opts?: {
  includeEnded?: boolean;
}): Prisma.EventWhereInput {
  const now = new Date();
  // Le superfici solo-futuro (home, calendario pubblico) non mostrano un
  // evento mai aperto oltre la sua fine: fra `endsAt` e il passaggio del giro
  // del ciclo di vita che lo chiude, occuperebbe il posto di un evento vero
  // in arrivo. LIVE resta: è in corso (grace compresa), e lo chiude il giro.
  const onlyUpcoming = opts?.includeEnded === false;
  const or: Prisma.EventWhereInput[] = onlyUpcoming
    ? [
        { status: 'LIVE', eventType: { not: 'INSTANT' } },
        {
          status: { in: ['PUBLISHED', ...WARMUP_STATUSES] },
          eventType: { not: 'INSTANT' },
          endsAt: { gt: now },
        },
      ]
    : [
        // Le istantanee restano fuori: sono chiamate link-only, e una in corso
        // comparirebbe in home, negli elenchi, nella sitemap e nel calendario
        // pubblico come se fosse un evento a cui iscriversi.
        { status: { in: ['PUBLISHED', 'LIVE'] }, eventType: { not: 'INSTANT' } },
        {
          status: { in: WARMUP_STATUSES },
          eventType: { not: 'INSTANT' },
          endsAt: { gt: now },
        },
      ];
  // ENDED events are public only while the post-event page is enabled and its
  // (optional) window hasn't expired — same gate as isEventPubliclyVisible, so
  // an event hidden on its page also drops out of listings/sitemap/API.
  if (opts?.includeEnded !== false) {
    or.push({
      status: 'ENDED',
      postEventPublic: true,
      OR: [
        { postEventPublicUntil: null },
        { postEventPublicUntil: { gt: now } },
      ],
    });
  }
  return { OR: or };
}

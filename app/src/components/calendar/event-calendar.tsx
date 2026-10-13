'use client';

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { useTranslations, useLocale, useFormatter } from 'next-intl';
import { Button, Spinner } from 'design-react-kit';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import multiMonthPlugin from '@fullcalendar/multimonth';
import listPlugin from '@fullcalendar/list';
import bgLocale from '@fullcalendar/core/locales/bg';
import csLocale from '@fullcalendar/core/locales/cs';
import daLocale from '@fullcalendar/core/locales/da';
import deLocale from '@fullcalendar/core/locales/de';
import elLocale from '@fullcalendar/core/locales/el';
import esLocale from '@fullcalendar/core/locales/es';
import etLocale from '@fullcalendar/core/locales/et';
import fiLocale from '@fullcalendar/core/locales/fi';
import frLocale from '@fullcalendar/core/locales/fr';
import hrLocale from '@fullcalendar/core/locales/hr';
import huLocale from '@fullcalendar/core/locales/hu';
import itLocale from '@fullcalendar/core/locales/it';
import ltLocale from '@fullcalendar/core/locales/lt';
import lvLocale from '@fullcalendar/core/locales/lv';
import nlLocale from '@fullcalendar/core/locales/nl';
import plLocale from '@fullcalendar/core/locales/pl';
import ptLocale from '@fullcalendar/core/locales/pt';
import roLocale from '@fullcalendar/core/locales/ro';
import skLocale from '@fullcalendar/core/locales/sk';
import slLocale from '@fullcalendar/core/locales/sl';
import svLocale from '@fullcalendar/core/locales/sv';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, DatesSetArg, EventClickArg, EventContentArg, EventMountArg } from '@fullcalendar/core';

import { Icon } from '@/components/ui/icon';
import { Link, percorso } from '@/i18n/navigation';
import { eventAdminPath } from '@/lib/events/admin-links';
import { localizedPath } from '@/lib/utils/localized-url';
import { hexWithAlpha, inchiostroEtichetta } from '@/lib/utils/tag-color';

// Le lingue del portale che il calendario conosce (l'inglese e' gia' dentro;
// irlandese e maltese non ci sono e restano in inglese per giorni e mesi):
// solo queste, non tutte le oltre cento del pacchetto.
const LINGUE_CALENDARIO = [bgLocale, csLocale, daLocale, deLocale, elLocale, esLocale, etLocale, fiLocale, frLocale, hrLocale, huLocale, itLocale, ltLocale, lvLocale, nlLocale, plLocale, ptLocale, roLocale, skLocale, slLocale, svLocale];

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  DRAFT: { bg: '#E9ECEF', border: 'var(--app-muted)', text: 'var(--app-text)' },
  PUBLISHED: { bg: '#E8F0FE', border: 'var(--app-primary)', text: 'var(--app-primary)' },
  // Testi piu' scuri dei bordi: sul fondo chiaro devono arrivare a 4,5:1.
  LIVE: { bg: '#D4EDDA', border: '#008758', text: '#00603F' },
  ENDED: { bg: '#FFF3CD', border: '#A66300', text: '#7A4A00' },
  ARCHIVED: { bg: '#E9ECEF', border: '#6C757D', text: '#495057' },
};

/** Il colore di un evento senza etichette nel calendario pubblico. */
const COLORE_SENZA_ETICHETTA = '#0066CC';
/** Il colore di un'etichetta a cui le impostazioni non ne danno uno. */
const COLORE_ETICHETTA_NEUTRA = '#516B7E';

/** Sul telefono la griglia del mese taglia i titoli: si parte dall'elenco. */
function vistaIniziale(): ViewType {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 767.98px)').matches
    ? 'listMonth'
    : 'dayGridMonth';
}

type ViewType = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'multiMonthYear' | 'listMonth';

interface EtichettaCalendario {
  slug: string;
  name: string;
  color: string | null;
}

interface CalendarEvent {
  id: string;
  slug: string;
  /** Il titolo senza il sopratitolo, se l'evento lo mostra. */
  title: string;
  kicker?: string | null;
  tags?: EtichettaCalendario[];
  start: string;
  end: string;
  status: string;
  eventType: string;
  registrationCount?: number;
  /** Solo per lo staff: la pagina pubblica dell'evento si apre. */
  hasPublicPage?: boolean;
}

/** Il colore di un evento pubblico: la sua prima etichetta, o il blu se non ne ha. */
function coloreEtichetta(tag: EtichettaCalendario | undefined): string {
  if (!tag) return COLORE_SENZA_ETICHETTA;
  return tag.color ?? COLORE_ETICHETTA_NEUTRA;
}

/** I colori di un evento nel calendario pubblico: quelli della sua prima etichetta. */
function coloriEtichetta(colore: string) {
  return {
    bg: hexWithAlpha(colore, 0x22 / 255),
    border: colore,
    text: inchiostroEtichetta(colore, 0x22 / 255),
  };
}

interface EventCalendarProps {
  mode: 'admin' | 'public';
  initialEvents?: CalendarEvent[];
}

const COLORI_PREDEFINITI = { bg: '#E9ECEF', border: 'var(--app-muted)', text: 'var(--app-text)' };

/**
 * Nel calendario pubblico il colore dice l'argomento (la prima etichetta);
 * in quello dello staff lo stato, come dice la legenda. In allestimento o in
 * pausa un evento e' ancora «pubblicato».
 */
function coloriDi(evt: CalendarEvent, mode: 'admin' | 'public') {
  if (mode === 'public') return coloriEtichetta(coloreEtichetta(evt.tags?.[0]));
  const stato = evt.status === 'PROVISIONING' || evt.status === 'IDLE' ? 'PUBLISHED' : evt.status;
  return STATUS_COLORS[stato] ?? COLORI_PREDEFINITI;
}

/**
 * Nell'elenco, un clic con Ctrl, Cmd o Maiusc sul link fa quello che fa il
 * browser (scheda o finestra nuova): non deve arrivare alla riga, che il
 * calendario tratta come un link «forzato» e porterebbe via questa scheda.
 */
function fermaClicConModificatori(e: MouseEvent) {
  if (e.ctrlKey || e.metaKey || e.shiftKey) e.stopPropagation();
}

/** Il contenuto di un evento: icone, ora e titolo; nell'elenco anche il link. */
function contenutoEvento(eventInfo: EventContentArg) {
  const { status, eventType } = eventInfo.event.extendedProps;
  const isInstant = eventType === 'INSTANT';
  // Nell'elenco il titolo va a capo: tagliato su una riga allargava la
  // tabella oltre lo schermo del telefono.
  const elenco = eventInfo.view.type.startsWith('list');
  const titolo = (
    <span className={elenco ? undefined : 'text-truncate'}>
      {!elenco && eventInfo.timeText && <span className="fw-semibold me-1">{eventInfo.timeText}</span>}
      {eventInfo.event.title}
    </span>
  );
  return (
    <div
      className="d-flex align-items-center gap-1 px-1"
      style={{
        overflow: 'hidden',
        whiteSpace: elenco ? 'normal' : 'nowrap',
        fontSize: elenco ? '0.88rem' : '0.78rem',
        lineHeight: 1.3,
        cursor: 'pointer',
      }}
    >
      {isInstant && (
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
      )}
      {status === 'LIVE' && (
        <span
          className="rounded-circle d-inline-block flex-shrink-0 pulse-dot"
          style={{ width: 6, height: 6, backgroundColor: '#008758' }}
        />
      )}
      {elenco ? (
        // Nell'elenco il calendario non disegna il link: lo mettiamo noi, per
        // Tab e per il clic sulla riga.
        <a href={eventInfo.event.url} className="calendario-evento-link">
          {titolo}
        </a>
      ) : (
        titolo
      )}
    </div>
  );
}

/** Nell'elenco il link della riga lascia ai modificatori il loro mestiere. */
function montaEvento(info: EventMountArg) {
  info.el.querySelector<HTMLAnchorElement>('a.calendario-evento-link')?.addEventListener('click', fermaClicConModificatori);
}

export default function EventCalendar({ mode, initialEvents = [] }: EventCalendarProps) {
  const t = useTranslations('calendar');
  const tc = useTranslations('common');
  const locale = useLocale();
  const calendarRef = useRef<FullCalendar>(null);
  const contenitore = useRef<HTMLDivElement>(null);
  // Il riquadro dell'evento scelto, accanto all'evento.
  // `apertura` cambia a ogni apertura, anche dello stesso evento: il fuoco
  // ci rientra.
  const [scelto, setScelto] = useState<{ evento: CalendarEvent; ancora: HTMLElement; apertura: number } | null>(null);

  // Il calendario si disegna solo nel browser (event-calendar-lazy), quindi
  // la vista di partenza si sceglie subito: niente doppio caricamento.
  const [vistaDiPartenza] = useState<ViewType>(vistaIniziale);
  const [currentView, setCurrentView] = useState<ViewType>(vistaDiPartenza);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [headerTitle, setHeaderTitle] = useState('');

  // Vale solo la risposta dell'ultima richiesta: una piu' lenta, di un
  // periodo gia' lasciato, non sovrascrive quello in vista.
  const ultimaRichiesta = useRef(0);
  const fetchEvents = useCallback(async (start: string, end: string) => {
    const questa = ++ultimaRichiesta.current;
    setLoading(true);
    try {
      // La lingua della pagina, non quella del browser: titoli ed etichette
      // nella lingua in cui si legge (ed e' anche la chiave delle cache).
      const params = new URLSearchParams({ start, end, mode, locale });
      const res = await fetch(`/api/events/calendar?${params}`);
      if (res.ok) {
        const data: CalendarEvent[] = await res.json();
        if (questa === ultimaRichiesta.current) setEvents(data);
      }
    } catch {
      // silent
    } finally {
      if (questa === ultimaRichiesta.current) setLoading(false);
    }
  }, [mode, locale]);

  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    setHeaderTitle(arg.view.title);
    setScelto(null);
    fetchEvents(arg.startStr, arg.endStr);
  }, [fetchEvents]);

  // Un clic (o Invio sull'evento) apre il riquadro con il riepilogo e i
  // pulsanti per andare all'evento: niente salti di pagina a sorpresa.
  const handleEventClick = useCallback((info: EventClickArg) => {
    // Con Ctrl, Cmd o Maiusc il link fa il suo mestiere (nuova scheda). Nella
    // vista elenco la riga e' un link «forzato» che porterebbe via anche
    // questa scheda: si ferma, e la scheda nuova la apriamo noi.
    const e = info.jsEvent;
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setScelto(null);
      // Fuori dal link (sul resto della riga dell'elenco) il calendario
      // porterebbe via questa scheda: la scheda nuova la apriamo noi.
      if (info.el.classList.contains('fc-list-event') && info.event.url) {
        e.preventDefault();
        window.open(info.event.url, '_blank', 'noopener');
      }
      return;
    }
    info.jsEvent.preventDefault();
    const evento = events.find((x) => x.id === info.event.id);
    if (evento) setScelto((s) => ({ evento, ancora: info.el, apertura: (s?.apertura ?? 0) + 1 }));
  }, [events]);

  const sceltoRef = useRef(scelto);
  sceltoRef.current = scelto;
  const chiudiRiquadro = useCallback((rimettiFuoco: boolean) => {
    const s = sceltoRef.current;
    setScelto(null);
    if (!rimettiFuoco || !s) return;
    // Nell'elenco l'evento e' una riga di tabella: il fuoco va al suo link.
    // Se l'evento non c'e' piu' (era nel riquadro «+N», chiuso con Esc) il
    // fuoco resta nel calendario.
    const focalizzabile = 'a[href], button, [tabindex]';
    const dove = s.ancora.matches(focalizzabile)
      ? s.ancora
      : s.ancora.querySelector<HTMLElement>(focalizzabile);
    if (dove?.isConnected) dove.focus();
    else contenitore.current?.focus();
  }, []);

  // Ogni evento e' un link vero: nella griglia lo disegna il calendario
  // (`url`), nell'elenco eventContent (la riga ne cerca uno per il clic).
  const calendarEvents: EventInput[] = useMemo(() => events.map((evt) => {
    const colors = coloriDi(evt, mode);
    const href = localizedPath(mode === 'admin' ? eventAdminPath(evt.id) : `/events/${evt.slug}`, locale);
    return {
      id: evt.id,
      title: evt.title,
      url: href,
      start: evt.start,
      end: evt.end,
      backgroundColor: colors.bg,
      borderColor: colors.border,
      textColor: colors.text,
      extendedProps: {
        slug: evt.slug,
        status: evt.status,
        eventType: evt.eventType,
        registrationCount: evt.registrationCount,
      },
    };
  }), [events, mode, locale]);

  const changeView = useCallback((view: ViewType) => {
    setCurrentView(view);
    calendarRef.current?.getApi().changeView(view);
  }, []);

  const goToday = useCallback(() => {
    calendarRef.current?.getApi().today();
  }, []);

  const goPrev = useCallback(() => {
    calendarRef.current?.getApi().prev();
  }, []);

  const goNext = useCallback(() => {
    calendarRef.current?.getApi().next();
  }, []);

  useEffect(() => {
    const cal = calendarRef.current?.getApi();
    if (cal) setHeaderTitle(cal.view.title);
  }, []);

  // La legenda pubblica: le etichette che danno davvero il colore (la prima
  // di ciascun evento), per nome, e «senza etichetta» se serve.
  const { etichetteDelPeriodo, qualcunoSenzaEtichetta } = useMemo(() => {
    const viste = new Map<string, EtichettaCalendario>();
    let senza = false;
    for (const e of events) {
      const prima = e.tags?.[0];
      if (prima) viste.set(prima.slug, prima);
      else senza = true;
    }
    return {
      etichetteDelPeriodo: [...viste.values()].sort((a, b) => a.name.localeCompare(b.name, locale)),
      qualcunoSenzaEtichetta: senza,
    };
  }, [events, locale]);

  const viewButtons: { view: ViewType; label: string }[] = [
    { view: 'timeGridDay', label: t('views.day') },
    { view: 'timeGridWeek', label: t('views.week') },
    { view: 'dayGridMonth', label: t('views.month') },
    { view: 'multiMonthYear', label: t('views.year') },
    { view: 'listMonth', label: t('views.list') },
  ];

  return (
    <div className="event-calendar" ref={contenitore} tabIndex={-1}>
      {/* Custom toolbar */}
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div className="d-flex align-items-center gap-2">
          <Button
            color="primary"
            outline
            size="xs"
            onClick={goToday}
            className="px-3"
          >
            {t('today')}
          </Button>
          <div className="btn-group">
            <Button color="link" size="xs" onClick={goPrev} aria-label={t('prev')}>
              <Icon icon="it-arrow-left" size="sm" />
            </Button>
            <Button color="link" size="xs" onClick={goNext} aria-label={t('next')}>
              <Icon icon="it-arrow-right" size="sm" />
            </Button>
          </div>
          <h5 className="mb-0 fw-semibold" style={{ color: 'var(--app-text)', fontSize: '1.1rem' }}>
            {headerTitle}
          </h5>
          {loading && <Spinner active small className="ms-2" />}
        </div>

        <div className="btn-group">
          {viewButtons.map(({ view, label }) => (
            <button
              key={view}
              type="button"
              className={`btn btn-sm ${
                currentView === view
                  ? 'btn-primary'
                  : 'btn-outline-secondary'
              }`}
              onClick={() => changeView(view)}
              style={{ fontSize: '0.78rem', padding: '4px 10px' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'admin' && (
        <div className="d-flex flex-wrap gap-2 mb-3" style={{ fontSize: '0.75rem' }}>
          {Object.entries(STATUS_COLORS).map(([status, colors]) => (
            <span
              key={status}
              className="d-inline-flex align-items-center gap-1 px-2 py-1 rounded-1"
              style={{ backgroundColor: colors.bg, color: colors.text }}
            >
              <span
                className="rounded-circle d-inline-block"
                style={{ width: 8, height: 8, backgroundColor: colors.border }}
              />
              {t(`status.${status}`)}
            </span>
          ))}
        </div>
      )}

      {mode === 'public' && etichetteDelPeriodo.length > 0 && (
        <ul className="calendario-legenda" aria-label={t('legend.title')}>
          {etichetteDelPeriodo.map((tag) => {
            const c = coloriEtichetta(coloreEtichetta(tag));
            return (
              <li key={tag.slug} style={{ backgroundColor: c.bg, color: c.text }}>
                <span className="calendario-legenda__punto" style={{ backgroundColor: c.border }} aria-hidden="true" />
                {tag.name}
              </li>
            );
          })}
          {qualcunoSenzaEtichetta && (
            <li style={{ backgroundColor: coloriEtichetta(COLORE_SENZA_ETICHETTA).bg, color: coloriEtichetta(COLORE_SENZA_ETICHETTA).text }}>
              <span className="calendario-legenda__punto" style={{ backgroundColor: COLORE_SENZA_ETICHETTA }} aria-hidden="true" />
              {t('legend.noTag')}
            </li>
          )}
        </ul>
      )}

      {/* FullCalendar */}
      <div className="fc-bootstrap-italia">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, multiMonthPlugin, listPlugin, interactionPlugin]}
          initialView={vistaDiPartenza}
          // I nomi di giorni e mesi vengono dal pacchetto di lingue del
          // calendario; i testi letti dai lettori di schermo dai nostri.
          locales={LINGUE_CALENDARIO}
          locale={locale}
          moreLinkHint={(n: number) => t('moreLinkHint', { count: n })}
          closeHint={tc('close')}
          noEventsText={t('noEvents')}
          firstDay={1}
          headerToolbar={false}
          // Blocchi colorati anche per gli eventi con l'orario: come «punto»
          // il mese ignorava sfondo e testo, e tutto restava del blu dei link.
          eventDisplay="block"
          height="auto"
          events={calendarEvents}
          datesSet={handleDatesSet}
          eventClick={handleEventClick}
          dayMaxEvents={3}
          moreLinkText={(n) => `+${n}`}
          eventTimeFormat={{
            hour: '2-digit',
            minute: '2-digit',
            meridiem: false,
            hour12: false,
          }}
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
          slotDuration="00:30:00"
          allDaySlot={false}
          nowIndicator={true}
          dayCellClassNames={(arg) => {
            const day = arg.date.getDay();
            return day === 0 || day === 6 ? 'fc-weekend-cell' : '';
          }}
          eventContent={contenutoEvento}
          eventDidMount={montaEvento}
        />
      </div>

      {scelto && (
        <RiquadroEvento
          evento={scelto.evento}
          ancora={scelto.ancora}
          apertura={scelto.apertura}
          contenitore={contenitore.current}
          mode={mode}
          onChiudi={chiudiRiquadro}
        />
      )}

      {/* Custom CSS for Bootstrap Italia integration */}
      <style>{`
        .fc-bootstrap-italia {
          --fc-border-color: #d9dadb;
          --fc-today-bg-color: rgba(0, 102, 204, 0.04);
          --fc-event-border-color: transparent;
          --fc-page-bg-color: #fff;
          --fc-neutral-bg-color: #f8f9fa;
          --fc-list-event-hover-bg-color: rgba(0, 102, 204, 0.06);
          font-family: 'Titillium Web', sans-serif;
        }

        .fc-bootstrap-italia .fc-scrollgrid {
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid #d9dadb;
        }

        .fc-bootstrap-italia .fc-col-header-cell {
          background-color: #f8f9fa;
          padding: 8px 4px;
          font-size: 0.82rem;
          font-weight: 600;
          color: #17324D;
          text-transform: capitalize;
        }

        /* Numeri e nomi dei giorni e numeri delle settimane sono <a> che non
           portano da nessuna parte: il sottolineato dei link del kit li
           faceva sembrare cliccabili. Gli eventi e il «+N» restano link. */
        .fc-bootstrap-italia .fc-daygrid-day-number,
        .fc-bootstrap-italia .fc-col-header-cell-cushion,
        .fc-bootstrap-italia .fc-list-day-text,
        .fc-bootstrap-italia .fc-list-day-side-text {
          text-decoration: none;
        }

        .fc-bootstrap-italia .fc-daygrid-day-number {
          color: #17324D;
          font-size: 0.85rem;
          font-weight: 500;
          padding: 6px 8px;
        }

        .fc-bootstrap-italia .fc-weekend-cell {
          background-color: rgba(90, 118, 138, 0.03);
        }

        /* Niente trasparenza sui numeri: abbasserebbe il contrasto sotto
           il 4,5:1. Il colore attenuato basta a distinguerli. */
        .fc-bootstrap-italia .fc-weekend-cell .fc-daygrid-day-number,
        .fc-bootstrap-italia .fc-day-other .fc-daygrid-day-number {
          color: #516B7E;
          opacity: 1;
        }

        .fc-bootstrap-italia .fc-day-other .fc-daygrid-day-top {
          opacity: 1;
        }

        .fc-bootstrap-italia .fc-daygrid-event {
          border-radius: 4px;
          padding: 1px 2px;
          margin: 1px 2px;
          border-left-width: 3px !important;
          border-left-style: solid !important;
        }

        .fc-bootstrap-italia .fc-daygrid-more-link {
          color: #0066CC;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .fc-bootstrap-italia .fc-timegrid-slot {
          height: 2.5em;
        }

        .fc-bootstrap-italia .fc-timegrid-slot-label {
          font-size: 0.75rem;
          color: #516B7E;
        }

        .fc-bootstrap-italia .fc-list-event:hover td {
          background-color: rgba(0, 102, 204, 0.06);
        }

        .fc-bootstrap-italia .fc-list-day-cushion {
          background-color: #f8f9fa;
          font-weight: 600;
          color: #17324D;
        }

        .fc-bootstrap-italia .fc-multimonth-title {
          font-size: 1rem;
          font-weight: 600;
          color: #17324D;
          text-transform: capitalize;
          padding: 8px;
        }

        .fc-bootstrap-italia .fc-multimonth-daygrid {
          font-size: 0.75rem;
        }

        .fc-bootstrap-italia .fc-day-today .fc-daygrid-day-number {
          background-color: #0066CC;
          color: #fff;
          border-radius: 50%;
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .fc-bootstrap-italia .fc-now-indicator-line {
          border-color: #CC334D;
        }

        .fc-bootstrap-italia .fc-now-indicator-arrow {
          border-color: #CC334D;
        }
      `}</style>
    </div>
  );
}

/**
 * Il riepilogo di un evento sotto l'evento cliccato: sopratitolo e titolo,
 * giorno e orario, etichette e, per lo staff, stato e iscritti; i pulsanti
 * portano alla pagina dell'evento (o a quella di gestione). Si chiude con
 * Esc, con la X, cliccando fuori o cambiando periodo; con Esc e con la X il
 * fuoco torna all'evento.
 */
function RiquadroEvento({
  evento,
  ancora,
  apertura,
  contenitore,
  mode,
  onChiudi,
}: {
  evento: CalendarEvent;
  ancora: HTMLElement;
  apertura: number;
  contenitore: HTMLElement | null;
  mode: 'admin' | 'public';
  onChiudi: (rimettiFuoco: boolean) => void;
}) {
  const t = useTranslations('calendar');
  const tc = useTranslations('common');
  const tStato = useTranslations('events.status');
  const format = useFormatter();
  const riquadro = useRef<HTMLDivElement>(null);
  const [posizione, setPosizione] = useState<{ top: number; left: number } | null>(null);

  // Sotto l'evento, dentro il calendario; sopra, se sotto non c'e' posto.
  useLayoutEffect(() => {
    const el = riquadro.current;
    if (!el || !contenitore) return;
    const misura = () => {
      const a = ancora.getBoundingClientRect();
      const c = contenitore.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const sotto = a.bottom - c.top + 6;
      const sopra = a.top - c.top - r.height - 6;
      const top = a.bottom + r.height + 6 > window.innerHeight && sopra >= 0 ? sopra : sotto;
      const left = Math.max(0, Math.min(a.left - c.left, c.width - r.width));
      setPosizione({ top, left });
    };
    misura();
    window.addEventListener('resize', misura);
    return () => window.removeEventListener('resize', misura);
  }, [ancora, contenitore, evento]);

  // Il fuoco va al riquadro appena e' al suo posto (prima e' nascosto, e un
  // elemento nascosto non lo riceve), perche' chi usa la tastiera lo trovi.
  const posizionato = posizione !== null;
  useEffect(() => {
    if (posizionato) riquadro.current?.focus();
  }, [posizionato, apertura]);

  useEffect(() => {
    const tasto = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onChiudi(true);
    };
    const fuori = (e: MouseEvent) => {
      const dove = e.target as Node;
      if (!riquadro.current?.contains(dove) && !ancora.contains(dove)) onChiudi(false);
    };
    document.addEventListener('keydown', tasto);
    document.addEventListener('mousedown', fuori);
    return () => {
      document.removeEventListener('keydown', tasto);
      document.removeEventListener('mousedown', fuori);
    };
  }, [ancora, onChiudi]);

  const inizio = new Date(evento.start);
  const fine = new Date(evento.end);
  const stessoGiorno = inizio.toDateString() === fine.toDateString();
  // Il fuso del browser, come la griglia del calendario: il riquadro non deve
  // dire un'ora diversa da quella della casella cliccata.
  const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const titoloId = `calendario-riquadro-${evento.id}`;
  const istantanea = evento.eventType === 'INSTANT';
  // La pagina pubblica, solo se si apre davvero (lo dice il server con la
  // regola della pagina).
  const conPagina = evento.hasPublicPage === true;

  return (
    <div
      ref={riquadro}
      className="calendario-riquadro"
      role="dialog"
      aria-labelledby={titoloId}
      tabIndex={-1}
      style={posizione ? { top: posizione.top, left: posizione.left } : { visibility: 'hidden' }}
      // Tab oltre l'ultimo pulsante, o Maiusc+Tab dal primo, chiude il
      // riquadro e torna all'evento: il Tab dopo va all'evento successivo,
      // non in fondo alla pagina (il riquadro e' disegnato dopo il calendario).
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return;
        const pulsanti = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
        );
        const primo = pulsanti[0];
        const ultimo = pulsanti[pulsanti.length - 1];
        const qui = document.activeElement;
        if ((!e.shiftKey && qui === ultimo) || (e.shiftKey && (qui === primo || qui === e.currentTarget))) {
          e.preventDefault();
          onChiudi(true);
        }
      }}
    >
      <button type="button" className="calendario-riquadro__chiudi" aria-label={tc('close')} onClick={() => onChiudi(true)}>
        <Icon icon="it-close" size="sm" />
      </button>
      {evento.kicker && <p className="calendario-riquadro__sopra">{evento.kicker}</p>}
      <h3 id={titoloId} className="calendario-riquadro__titolo">
        {evento.title}
      </h3>
      <p className="calendario-riquadro__quando">
        {format.dateTime(inizio, { weekday: 'long', day: 'numeric', month: 'long', timeZone: fuso })}
        {' · '}
        {format.dateTime(inizio, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: fuso })}
        {' – '}
        {stessoGiorno
          ? format.dateTime(fine, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: fuso })
          : format.dateTime(fine, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: fuso })}
      </p>
      {mode === 'admin' && (
        <p className="calendario-riquadro__stato">
          {evento.status === 'PROVISIONING' || evento.status === 'IDLE'
            ? tStato(evento.status)
            : t(`status.${evento.status as 'DRAFT' | 'PUBLISHED' | 'LIVE' | 'ENDED' | 'ARCHIVED'}`)}
          {!istantanea && evento.registrationCount !== undefined && (
            <> · {t('popover.registrations', { count: evento.registrationCount })}</>
          )}
        </p>
      )}
      {(evento.tags?.length ?? 0) > 0 && (
        <ul className="calendario-riquadro__etichette">
          {evento.tags!.map((tag) => {
            const c = coloriEtichetta(coloreEtichetta(tag));
            return (
              <li key={tag.slug} style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}>
                {tag.name}
              </li>
            );
          })}
        </ul>
      )}
      <div className="calendario-riquadro__azioni">
        {mode === 'admin' ? (
          <>
            <Link href={percorso(eventAdminPath(evento.id))} className="btn btn-primary btn-sm">
              {t('popover.manage')}
            </Link>
            {conPagina && (
              <Link href={percorso(`/events/${evento.slug}`)} className="btn btn-outline-primary btn-sm">
                {t('popover.publicPage')}
              </Link>
            )}
          </>
        ) : (
          <Link href={percorso(`/events/${evento.slug}`)} className="btn btn-primary btn-sm">
            {t('popover.open')}
          </Link>
        )}
      </div>
    </div>
  );
}

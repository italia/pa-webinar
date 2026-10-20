'use client';

/**
 * L'intestazione della pagina pubblica di un evento: copertina, stato,
 * titolo con l'eventuale sopratitolo, etichette, data e ora, relatori e
 * organizzatore scritti a mano; accanto, «Chi organizza e chi interviene»
 * (EventPeople). La usano la pagina dell'evento e, con i dati presi dal
 * modulo, l'anteprima della pagina nella creazione dell'evento: cosi'
 * l'anteprima e' la pagina, non una sua imitazione.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Badge, Row, Col } from 'design-react-kit';

import EventTitle from '@/components/events/event-title';
import PersonPhoto from '@/components/events/person-photo';
import { Icon } from '@/components/ui/icon';
import { useDurataTesto } from '@/hooks/use-durata-testo';
import { Link, percorso } from '@/i18n/navigation';
import type { EntePubblico, PersonaPubblica } from '@/lib/events/public-people';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { initials } from '@/lib/utils/speaker-palette';
import { hexWithAlpha, inchiostroEtichetta } from '@/lib/utils/tag-color';

export interface TagChip {
  slug: string;
  name: Record<string, string>;
  color: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  PUBLISHED: 'var(--app-primary)',
  LIVE: '#008758',
  ENDED: 'var(--app-muted)',
};

interface EventHeaderProps {
  title: string;
  parseTitleKicker: boolean;
  imageUrl: string | null | undefined;
  tags: TagChip[];
  startsAt: Date;
  endsAt: Date;
  /** Lo stato come lo vede il pubblico (PUBLISHED, LIVE, ENDED…). */
  publicStatus: string;
  isLive: boolean;
  /** Relatori scritti a mano, solo se non ci sono persone strutturate. */
  speakers?: string | null;
  /** Organizzatore scritto a mano, solo se non ci sono enti strutturati. */
  organizerName?: string | null;
  /** In anteprima le etichette non portano all'elenco degli eventi. */
  tagLinks?: boolean;
  /** Il titolo e' l'h1 della pagina; in anteprima, dentro un'altra pagina,
   *  e' un paragrafo con lo stesso aspetto. */
  titleAs?: 'h1' | 'p';
  /** La lingua del titolo, se non e' quella della pagina (un titolo non
   *  tradotto, mostrato nella lingua principale). */
  titleLang?: string;
  /** Sotto il titolo: l'avviso di un testo tradotto in automatico. */
  titleNote?: ReactNode;
}

/**
 * La copia sfocata ai lati solo per i JPEG, che non hanno trasparenza (lo
 * sono i ritagli fatti al caricamento): sotto un logo trasparente farebbe un
 * alone. Gli altri formati restano sul fondo pieno.
 */
function senzaTrasparenza(url: string): boolean {
  return /\.jpe?g(?:$|[?#])/i.test(url);
}

function EtichettaEvento({
  href,
  style,
  children,
}: {
  href: ReturnType<typeof percorso> | null;
  style: CSSProperties;
  children: ReactNode;
}) {
  if (!href) return <span style={style}>{children}</span>;
  return (
    <Link href={href} className="text-decoration-none" style={style}>
      {children}
    </Link>
  );
}

export default function EventHeader({
  title,
  parseTitleKicker,
  imageUrl,
  tags,
  startsAt,
  endsAt,
  publicStatus,
  isLive,
  speakers = null,
  organizerName = null,
  tagLinks = true,
  titleAs = 'h1',
  titleLang,
  titleNote = null,
}: EventHeaderProps) {
  const t = useTranslations('events');
  const format = useFormatter();
  const locale = useLocale();
  const durata = useDurataTesto();
  const durataTesto = durata(startsAt, endsAt);
  const accentColor = STATUS_COLOR[publicStatus] ?? STATUS_COLOR.PUBLISHED;

  return (
    <>
      {/* ─── Event header: cover + hero in one cohesive card ─── */}
      <div
        className="mb-5 rounded-3 shadow-sm overflow-hidden"
        style={{ border: '1px solid #e3e9f0' }}
      >
        {/* The admin sets coverImageUrl and imageUrl to the same asset;
            imageUrl carries it here (it also doubles as the post-event video
            poster). */}
        {imageUrl && (
          // La copertina intera (`contain`: una grafica con del testo non si
          // taglia), alta al massimo 340 px; sui lati di un JPEG, invece di
          // due bande vuote, la stessa immagine sfocata riempie il riquadro.
          <div className="event-cover" role="img" aria-label={title}>
            {senzaTrasparenza(imageUrl) && (
              <div
                className="event-cover__sfondo"
                style={{ backgroundImage: `url(${imageUrl})` }}
                aria-hidden="true"
              />
            )}
            {/* Un <img> con il fondo pieno: dove l'immagine e' trasparente
                si vede il fondo, non la copia sfocata. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="event-cover__immagine" src={imageUrl} alt="" />
          </div>
        )}

        {/* ─── Hero content ─── */}
        <div
          className="p-4 p-lg-5"
          style={{
            background: 'linear-gradient(135deg, #F5F7FB 0%, #E8F0FE 100%)',
            borderLeft: `5px solid ${accentColor}`,
          }}
        >
          <div className="d-flex align-items-center gap-2 mb-3">
            {/* In diretta basta il segnale «In corso» con il punto: due
                etichette uguali una accanto all'altra non dicono di piu'. */}
            {!isLive && <StatusPill status={publicStatus} />}
            {isLive && (
              <Badge
                color="success"
                className="px-2 py-1 d-inline-flex align-items-center gap-1"
                style={{ fontSize: '0.75rem' }}
              >
                <span
                  className="rounded-circle d-inline-block pulse-dot"
                  style={{
                    width: 7,
                    height: 7,
                    backgroundColor: '#fff',
                  }}
                />
                {t('card.liveNow')}
              </Badge>
            )}
          </div>

          <EventTitle
            title={title}
            kickerEnabled={parseTitleKicker}
            as={titleAs}
            className={titleAs === 'h1' ? 'mb-3' : 'h1 mb-3'}
            style={{ color: 'var(--app-text)', lineHeight: 1.3 }}
            lang={titleLang}
          />
          {titleNote}

          {tags.length > 0 && (
            <div className="d-flex flex-wrap gap-2 mb-4">
              {tags.map((tag) => {
                const label =
                  getLocalized(tag.name as LocalizedField, locale) || tag.slug;
                const color = tag.color ?? '#516B7E';
                return (
                  <EtichettaEvento
                    key={tag.slug}
                    href={tagLinks ? percorso(`/events?tag=${tag.slug}`) : null}
                    style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: 999,
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      backgroundColor: hexWithAlpha(color, 0x22 / 255),
                      color: inchiostroEtichetta(color, 0x22 / 255),
                      border: `1px solid ${hexWithAlpha(color, 0x44 / 255)}`,
                    }}
                  >
                    {label}
                  </EtichettaEvento>
                );
              })}
            </div>
          )}

          <Row className="g-3 g-lg-4">
            <Col xs={12} md="auto">
              <div className="d-flex align-items-center">
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center me-3 flex-shrink-0"
                  style={{
                    width: 44,
                    height: 44,
                    backgroundColor: 'rgba(0,102,204,0.1)',
                  }}
                >
                  <Icon icon="it-calendar" className="text-primary" />
                </div>
                <div>
                  <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                    {format.dateTime(startsAt, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.9rem' }}>
                    {format.dateTime(startsAt, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' – '}
                    {format.dateTime(endsAt, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' · '}
                    {durataTesto}
                  </div>
                </div>
              </div>
            </Col>
            {/* I campi di testo libero restano per gli eventi che non hanno
                persone o enti strutturati. */}
            {speakers && (
              <Col xs={12} md="auto">
                <div className="d-flex align-items-center">
                  <div
                    className="rounded-circle d-flex align-items-center justify-content-center me-3 flex-shrink-0"
                    style={{
                      width: 44,
                      height: 44,
                      backgroundColor: 'rgba(0,102,204,0.1)',
                    }}
                  >
                    <Icon icon="it-user" className="text-primary" />
                  </div>
                  <div>
                    <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                      {t('detail.speakers')}
                    </div>
                    {/* Un relatore per riga, come li scrive chi crea l'evento:
                        senza `pre-line` gli a capo sparivano e i nomi si
                        fondevano in una riga sola. */}
                    <div
                      className="text-muted"
                      style={{ fontSize: '0.9rem', whiteSpace: 'pre-line' }}
                    >
                      {speakers}
                    </div>
                  </div>
                </div>
              </Col>
            )}
            {organizerName && (
              <Col xs={12} md="auto">
                <div className="d-flex align-items-center">
                  <div
                    className="rounded-circle d-flex align-items-center justify-content-center me-3 flex-shrink-0"
                    style={{
                      width: 44,
                      height: 44,
                      backgroundColor: 'rgba(0,102,204,0.1)',
                    }}
                  >
                    <Icon icon="it-pa" className="text-primary" />
                  </div>
                  <div>
                    <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                      {t('detail.organizer')}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.9rem' }}>
                      {organizerName}
                    </div>
                  </div>
                </div>
              </Col>
            )}
          </Row>
        </div>
      </div>
    </>
  );
}

export function StatusPill({ status }: { status: string }) {
  const t = useTranslations('events.status');
  const colorMap: Record<string, { bg: string; fg: string }> = {
    PUBLISHED: { bg: '#E8F0FE', fg: 'var(--app-primary)' },
    LIVE: { bg: '#D4EDDA', fg: '#155724' },
    ENDED: { bg: '#E9ECEF', fg: 'var(--app-muted)' },
    DRAFT: { bg: '#FFF3CD', fg: '#856404' },
    ARCHIVED: { bg: '#E9ECEF', fg: 'var(--app-muted)' },
  };
  const fallback = { bg: '#FFF3CD', fg: '#856404' };
  const c = colorMap[status] ?? fallback;
  return (
    <Badge
      color=""
      className="px-2 py-1 fw-semibold"
      style={{ fontSize: '0.72rem', backgroundColor: c.bg, color: c.fg }}
    >
      {/* Per il pubblico un evento pubblicato e' un evento «in programma»:
          «Pubblicato» e' una parola di chi lo gestisce. */}
      {status === 'PUBLISHED'
        ? t('UPCOMING')
        : t(status as 'DRAFT' | 'LIVE' | 'ENDED' | 'ARCHIVED')}
    </Badge>
  );
}

/**
 * Chi organizza e chi interviene: gli enti, con logo e sito, e le persone
 * pubblicate, ciascuna con il proprio ente. L'ente di una persona può essere
 * diverso da quello che organizza l'evento.
 */
export function EventPeople({
  organizers,
  people,
}: {
  organizers: EntePubblico[];
  people: PersonaPubblica[];
}) {
  const t = useTranslations('events');
  if (organizers.length === 0 && people.length === 0) return null;
  const gruppi: Array<{ role: PersonaPubblica['role']; label: string }> = [
    { role: 'organizer', label: t('detail.peopleOrganizers') },
    { role: 'moderator', label: t('detail.peopleModerators') },
    { role: 'speaker', label: t('detail.speakers') },
  ];
  return (
    <section className="event-people mb-4" aria-labelledby="event-people-title">
      <h2 id="event-people-title" className="h5 fw-bold mb-3">
        {t('detail.peopleTitle')}
      </h2>
      {organizers.length > 0 && (
        <div className="event-people__group">
          <h3 className="event-people__label">{t('detail.organizedBy')}</h3>
          <ul className="event-people__orgs">
            {organizers.map((o, i) => (
              <li key={`${i}-${o.name}`} className="event-org">
                {o.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.logoUrl} alt="" className="event-org__logo" />
                ) : (
                  <span className="event-org__initials" aria-hidden="true">
                    {initials(o.name)}
                  </span>
                )}
                {o.websiteUrl ? (
                  <a
                    href={o.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="event-org__name"
                  >
                    {o.name}
                  </a>
                ) : (
                  <span className="event-org__name">{o.name}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {gruppi.map(({ role, label }) => {
        const chi = people.filter((p) => p.role === role);
        if (chi.length === 0) return null;
        return (
          <div key={role} className="event-people__group">
            <h3 className="event-people__label">{label}</h3>
            <ul className="event-people__list">
              {chi.map((p, i) => (
                <li key={`${p.name}-${i}`} className="event-person">
                  {/* La foto in un cerchio, o le iniziali: accanto al nome, che
                      la dice gia', e' decorativa. */}
                  <PersonPhoto
                    src={p.photoUrl}
                    name={p.name}
                    size={48}
                    loading="lazy"
                    className="event-person__photo"
                    initialsClassName="event-person__initials"
                  />
                  <span className="event-person__who">
                    <span className="event-person__name">{p.name}</span>
                    {(p.organization || p.logoUrl) && (
                      <span className="event-person__org">
                        {/* Il logo dell'ente, piccolo, accanto al suo nome; da
                            solo dice di essere il logo dell'ente. */}
                        {p.logoUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.logoUrl}
                            alt={p.organization ? '' : t('detail.personOrganizationLogo')}
                            loading="lazy"
                            className="event-person__org-logo"
                          />
                        )}
                        {p.organization}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

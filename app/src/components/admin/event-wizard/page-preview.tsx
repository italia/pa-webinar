'use client';

/**
 * L'anteprima della pagina pubblica mentre si crea o si modifica un evento:
 * la stessa intestazione della pagina vera (EventHeader, EventPeople) con i
 * dati del modulo, la descrizione e il pulsante d'iscrizione. Accanto al
 * modulo, sugli schermi larghi, ne mostra una versione ridotta che si
 * aggiorna mentre si scrive; «Apri l'anteprima» la mostra a tutta larghezza.
 *
 * L'anteprima non porta altrove: i link non si seguono (si perderebbe il
 * modulo), e quella ridotta non riceve il fuoco ne' si legge due volte con
 * il lettore di schermo (`inert`): il contenuto e' gia' nel modulo.
 *
 * Nel passo «Programma» l'anteprima guarda il programma (`fuoco`): la
 * testata senza copertina, la descrizione accorciata e il programma intero,
 * o il posto dove comparira'.
 */
import { memo, useEffect, useState, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Card,
  CardBody,
  Col,
  Modal,
  ModalBody,
  ModalHeader,
  Row,
} from 'design-react-kit';

import EventHeader, { EventPeople, type TagChip } from '@/components/events/event-header';
import EventProgramme from '@/components/events/event-programme';
import { Icon } from '@/components/ui/icon';
import { MarkdownRenderer } from '@/components/ui/markdown';
import type { RelatoreProgramma, VoceProgramma } from '@/lib/agenda/programme';
import { personPhotoPath } from '@/lib/events/person-photo';
import { entiEPersonePubblici } from '@/lib/events/public-people';
import { getLocalized } from '@/lib/utils/locale';

import { CHIAVE_PRINCIPALE, chiavePersona, vociCompilate } from './programme-plan';
import { useFasciaCopertina } from './use-fascia-copertina';
import type { WizardForm } from './wizard-shell';

export interface DatiAnteprima {
  title: string;
  description: string;
  imageUrl: string | null;
  tags: TagChip[];
  startsAt: Date | null;
  endsAt: Date | null;
  parseTitleKicker: boolean;
  persone: ReturnType<typeof entiEPersonePubblici>;
  /** Relatori e organizzatore scritti a mano, se non ce ne sono di strutturati. */
  relatoriLiberi: string | null;
  organizzatoreLibero: string | null;
  /** Il programma, ad agenda accesa: come lo mostrera' la pagina. */
  programma: VoceProgramma[];
}

/**
 * Dal modulo ai dati della pagina, nella lingua indicata. Difensiva: un
 * modulo arrivato da un evento salvato con una forma piu' vecchia puo' non
 * avere tutti i campi, e l'anteprima non deve mai fermare il modulo.
 */
export function datiAnteprima(
  form: Pick<
    WizardForm,
    | 'title'
    | 'description'
    | 'coverImageUrl'
    | 'imageUrl'
    | 'tagSlugs'
    | 'organizers'
    | 'moderators'
    | 'speakers'
    | 'moderatorName'
    | 'moderatorPublicListed'
    | 'moderatorOrganization'
    | 'moderatorOrganizationLogoUrl'
    | 'moderatorPhotoId'
    | 'agendaEnabled'
    | 'agenda'
  >,
  {
    locale,
    tags,
    startsAt,
    endsAt,
    parseTitleKicker,
    campiLiberi,
  }: {
    /** La lingua in cui la si guarda; il ripiego e' quello della pagina. */
    locale: string;
    tags: TagChip[];
    startsAt: Date | null;
    endsAt: Date | null;
    parseTitleKicker: boolean;
    campiLiberi?: {
      speakersInfo: Record<string, string> | null;
      organizerName: string | null;
    };
  }
): DatiAnteprima {
  // Le persone presentate, con la loro chiave del programma al posto
  // dell'id della concessione (le persone nuove non ne hanno ancora uno).
  const presentate = [
    ...(form.moderators ?? []).map((m) => ({ ...m, role: 'MODERATOR' as const })),
    ...(form.speakers ?? []).map((s) => ({ ...s, organizer: false, role: 'SPEAKER' as const })),
  ]
    .filter((p) => p.publicListed && p.name.trim())
    .map((p) => ({
      id: chiavePersona(p) ?? `senza-chiave:${p.name}`,
      name: p.name,
      role: p.role,
      organizer: p.organizer,
      organization: p.organization,
      organizationLogoUrl: p.organizationLogoUrl,
      photoId: p.photoId ?? null,
    }));
  const agendaAccesa = !!form.agendaEnabled;
  const voci = agendaAccesa ? vociCompilate(form.agenda ?? []) : [];
  const persone = entiEPersonePubblici(
    {
      organizers: form.organizers ?? [],
      additionalMods: presentate,
      agendaEnabled: agendaAccesa,
      agendaItems: voci.map((v) => ({
        speakerGrantId: v.speakerKey && v.speakerKey !== CHIAVE_PRINCIPALE ? v.speakerKey : null,
        speakerPrimary: v.speakerKey === CHIAVE_PRINCIPALE,
      })),
      moderatorName: form.moderatorName || null,
      moderatorPublicListed: !!form.moderatorPublicListed,
      moderatorOrganization: form.moderatorOrganization ?? null,
      moderatorOrganizationLogoUrl: form.moderatorOrganizationLogoUrl ?? null,
      moderatorPhotoId: form.moderatorPhotoId ?? null,
    },
    (nome) => nome
  );
  // Chi interviene, con le stesse regole della pagina: solo se presentato.
  const relatore = (chiave: string | null): RelatoreProgramma | null => {
    if (!chiave) return null;
    if (chiave === CHIAVE_PRINCIPALE) {
      return form.moderatorPublicListed && form.moderatorName?.trim()
        ? {
            name: form.moderatorName,
            organization: form.moderatorOrganization ?? null,
            photoUrl: form.moderatorPhotoId ? personPhotoPath(form.moderatorPhotoId) : null,
          }
        : null;
    }
    const p = presentate.find((x) => x.id === chiave);
    return p
      ? { name: p.name, organization: p.organization, photoUrl: p.photoId ? personPhotoPath(p.photoId) : null }
      : null;
  };
  const programma: VoceProgramma[] = voci.map((v, i) => ({
    id: v.id ?? `anteprima-${i}`,
    label: v.label,
    plannedMinutes: v.plannedMinutes,
    status: 'PENDING',
    speaker: relatore(v.speakerKey),
  }));
  // Come la pagina: getLocalized, con lo stesso ripiego.
  const relatori = getLocalized(campiLiberi?.speakersInfo ?? null, locale).trim();
  return {
    title: getLocalized(form.title ?? null, locale),
    description: getLocalized(form.description ?? null, locale),
    imageUrl: form.coverImageUrl ?? form.imageUrl ?? null,
    tags: (form.tagSlugs ?? [])
      .map((s) => tags.find((t) => t.slug === s))
      .filter((t): t is TagChip => !!t),
    startsAt,
    endsAt,
    parseTitleKicker,
    // Le stesse regole della pagina: chi e' pubblicato, con il suo ruolo.
    persone,
    // Come la pagina: il testo libero solo se mancano le persone strutturate.
    relatoriLiberi:
      relatori && !persone.persone.some((p) => p.role === 'speaker') ? relatori : null,
    organizzatoreLibero:
      campiLiberi?.organizerName && persone.enti.length === 0
        ? campiLiberi.organizerName
        : null,
    programma,
  };
}

/** I link dell'anteprima non si seguono: si perderebbe il modulo. */
function fermaLink(e: MouseEvent<HTMLDivElement>) {
  if ((e.target as HTMLElement).closest('a')) e.preventDefault();
}

/** Su che cosa si concentra l'anteprima: la pagina intera, o il programma. */
export type FuocoAnteprima = 'pagina' | 'programma';

function Pagina({
  dati,
  completa,
  fuoco = 'pagina',
}: {
  dati: DatiAnteprima;
  completa: boolean;
  fuoco?: FuocoAnteprima;
}) {
  const t = useTranslations('events');
  const tw = useTranslations('admin.wizard.preview');
  const tp = useTranslations('admin.wizard.programme');
  // Il programma in primo piano: la descrizione si accorcia (nella versione
  // ridotta), e senza argomenti si vede dove comparira'.
  const sulProgramma = fuoco === 'programma';
  const breve = sulProgramma && !completa;
  // Finche' la data manca, la pagina mostra un orario d'esempio: un'ora da
  // adesso. Lo dice la nota sotto l'anteprima.
  const inizio = dati.startsAt ?? new Date();
  const fine = dati.endsAt ?? new Date(inizio.getTime() + 60 * 60_000);
  const titolo = dati.title.trim() || tw('titlePlaceholder');
  const descrizione = (
    <>
      <h2 className="h4 fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('detail.description')}
      </h2>
      {dati.description.trim() ? (
        breve ? (
          <div className="anteprima-pagina__descrizione-breve mb-4">
            <MarkdownRenderer content={dati.description} />
          </div>
        ) : (
          <MarkdownRenderer content={dati.description} className="mb-4" />
        )
      ) : (
        <p className="anteprima-pagina__vuoto">{tw('descriptionPlaceholder')}</p>
      )}
      {sulProgramma && dati.programma.length === 0 ? (
        <p className="anteprima-pagina__posto-programma">{tp('previewPlaceholder')}</p>
      ) : (
        <EventProgramme items={dati.programma} startsAt={inizio} />
      )}
    </>
  );
  return (
    <div className="anteprima-pagina__foglio" onClickCapture={fermaLink}>
      <EventHeader
        title={titolo}
        parseTitleKicker={dati.parseTitleKicker}
        imageUrl={breve ? null : dati.imageUrl}
        tags={dati.tags}
        startsAt={inizio}
        endsAt={fine}
        publicStatus="PUBLISHED"
        isLive={false}
        speakers={dati.relatoriLiberi}
        organizerName={dati.organizzatoreLibero}
        tagLinks={false}
        titleAs="p"
      />
      <EventPeople organizers={dati.persone.enti} people={dati.persone.persone} />
      {completa ? (
        <Row>
          <Col lg={8} className="mb-4 mb-lg-0">
            {descrizione}
          </Col>
          <Col lg={4} className="order-first order-lg-0 mb-4 mb-lg-0">
            <Card className="shadow-sm border-0" style={{ borderRadius: '0.75rem' }}>
              <CardBody className="p-4">
                <Button
                  color="primary"
                  size="lg"
                  className="w-100 fw-semibold"
                  tag="span"
                >
                  <Icon icon="it-user" className="me-2" />
                  {t('detail.register')}
                </Button>
              </CardBody>
            </Card>
          </Col>
        </Row>
      ) : (
        descrizione
      )}
    </div>
  );
}

/** Vero sugli schermi dove la versione ridotta si vede (vedi globals.scss). */
function useSchermoLargo(): boolean {
  const [largo, setLargo] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1200px)');
    const aggiorna = () => setLargo(mq.matches);
    aggiorna();
    mq.addEventListener('change', aggiorna);
    return () => mq.removeEventListener('change', aggiorna);
  }, []);
  return largo;
}

function PagePreview({
  dati,
  fuoco = 'pagina',
}: {
  dati: DatiAnteprima;
  fuoco?: FuocoAnteprima;
}) {
  const tw = useTranslations('admin.wizard.preview');
  const tc = useTranslations('common');
  const [aperta, setAperta] = useState(false);
  // Il contenuto resta montato finche' la finestra non ha finito di
  // chiudersi (niente lampo vuoto), e intanto la copia ridotta aspetta.
  const [montata, setMontata] = useState(false);
  const largo = useSchermoLargo();
  const fascia = useFasciaCopertina();
  return (
    <aside className="anteprima-pagina" aria-labelledby="anteprima-pagina-titolo">
      <div className="anteprima-pagina__testa">
        <h2 id="anteprima-pagina-titolo" className="anteprima-pagina__titolo">
          {tw('title')}
        </h2>
        <button
          type="button"
          className="btn btn-outline-primary btn-xs"
          onClick={() => {
            setMontata(true);
            setAperta(true);
          }}
        >
          {tw('open')}
        </button>
      </div>
      <p className="anteprima-pagina__nota">
        {dati.startsAt ? tw('note') : tw('noteNoDate')}
      </p>
      {/* La copia ridotta solo dove si vede, e mai insieme a quella aperta:
          si disegnerebbe la pagina due volte, con gli stessi id. */}
      {largo && !montata && (
        <div
          className="anteprima-pagina__ridotta"
          inert
          style={{ '--fascia-copertina': String(fascia) } as React.CSSProperties}
        >
          <Pagina dati={dati} completa={false} fuoco={fuoco} />
        </div>
      )}
      <Modal
        isOpen={aperta}
        toggle={() => setAperta(false)}
        onOpened={() => setMontata(true)}
        onClosed={() => setMontata(false)}
        size="xl"
        labelledBy="anteprima-pagina-finestra"
      >
        <ModalHeader closeAriaLabel={tc('close')} toggle={() => setAperta(false)}>
          <span id="anteprima-pagina-finestra">{tw('title')}</span>
        </ModalHeader>
        <ModalBody>
          {(aperta || montata) && <Pagina dati={dati} completa fuoco={fuoco} />}
        </ModalBody>
      </Modal>
    </aside>
  );
}

export default memo(PagePreview);

'use client';

/**
 * Le slide sincronizzate di una registrazione, per lo staff: se mostrarle
 * accanto al video sulla pagina pubblica dell'evento, la correzione
 * dell'allineamento e un'anteprima con il video.
 *
 * I dati vengono da `/api/admin/postprod/recordings/[id]/slides`: i fatti
 * della presentazione sullo zero del video e i materiali presentati, con il
 * motivo per cui uno non si mostra. L'anteprima ricalcola i tratti nel
 * browser (lib/presentation/recording-slides) a ogni correzione, prima di
 * salvarla: chi allinea vede subito l'effetto.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';

import RecordingSlides from '@/components/presentation/recording-slides';
import VideoPlayer, { type VideoPlayerHandle } from '@/components/events/video-player';
import { SkeletonLines } from '@/components/ui/skeleton';
import ToggleSwitch from '@/components/ui/toggle-switch';
import { useToast } from '@/components/ui/toast';
import { Link, percorso } from '@/i18n/navigation';
import {
  SLIDE_OFFSET_MAX_SEC,
  buildSlideCues,
  offsetToAlign,
  withAvailableMaterials,
  type PresentationMark,
} from '@/lib/presentation/recording-slides';

type Problema = 'deleted' | 'notPdf' | 'notVisibleAfter';

interface DatiSlide {
  enabled: boolean;
  offsetSec: number;
  exactZero: boolean;
  durationSec: number | null;
  hasVideo: boolean;
  isEventVideo: boolean;
  eventVideoPublished: boolean;
  eventShowsMaterials: boolean;
  eventSlug: string;
  mediaUrl: string | null;
  marks: PresentationMark[];
  materials: Array<{
    id: string;
    title: string;
    problem: Problema | null;
    fileUrl: string | null;
  }>;
}

const fetcher = (url: string): Promise<DatiSlide> =>
  fetch(url, { credentials: 'include', cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<DatiSlide>;
  });

/** Il numero di secondi scritto nel campo, o null se non è un intero ammesso. */
function secondiDa(testo: string): number | null {
  const v = testo.trim().replace('−', '-');
  if (!/^[+-]?\d+$/.test(v)) return null;
  const n = Number.parseInt(v, 10);
  return Math.abs(n) <= SLIDE_OFFSET_MAX_SEC ? n : null;
}

export default function RecordingSlidesPanel({ recordingId }: { recordingId: string }) {
  const t = useTranslations('admin.postprod.slides');
  const toast = useToast();
  const url = `/api/admin/postprod/recordings/${recordingId}/slides`;
  const { data, error, isLoading, mutate } = useSWR<DatiSlide>(url, fetcher);

  const [bozza, setBozza] = useState('0');
  const [salvando, setSalvando] = useState(false);
  const [avviso, setAvviso] = useState<string | null>(null);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const offsetId = useId();
  const offsetHelpId = useId();
  const offsetErrId = useId();

  // Il campo riparte dal valore salvato a ogni lettura.
  const salvato = data?.offsetSec ?? 0;
  useEffect(() => {
    setBozza(String(salvato));
  }, [salvato]);

  const scarto = secondiDa(bozza);
  const scartoValido = scarto !== null;

  const mostrabili = useMemo(
    () =>
      new Set((data?.materials ?? []).filter((m) => m.problem === null).map((m) => m.id)),
    [data]
  );
  // I tratti di tutti i materiali con uno scarto dato.
  const tratti = useCallback(
    (offsetSec: number) =>
      data
        ? buildSlideCues(data.marks, { offsetSec, durationSec: data.durationSec })
        : [],
    [data]
  );
  // Cosa è stato presentato durante il video e che cosa vede il pubblico si
  // leggono con lo scarto salvato (o senza scarto, se quello salvato porta
  // tutto fuori dal video): il campo che si sta scrivendo cambia l'anteprima,
  // non il resto del pannello.
  const salvati = useMemo(() => tratti(salvato), [tratti, salvato]);
  const riferimento = useMemo(
    () => (salvati.length > 0 ? salvati : tratti(0)),
    [salvati, tratti]
  );
  const mostrabiliNelVideo = useMemo(
    () => withAvailableMaterials(riferimento, (id) => mostrabili.has(id)),
    [riferimento, mostrabili]
  );
  // L'anteprima, con la correzione del campo.
  const cues = useMemo(
    () => withAvailableMaterials(tratti(scarto ?? salvato), (id) => mostrabili.has(id)),
    [tratti, scarto, salvato, mostrabili]
  );
  const materialiAnteprima = useMemo(
    () =>
      (data?.materials ?? [])
        .filter((m) => m.problem === null && m.fileUrl)
        .map((m) => ({
          id: m.id,
          title: m.title,
          fileUrl: m.fileUrl!,
          downloadName: null,
        })),
    [data]
  );
  // I materiali presentati durante questo video (anche quelli che non si mostrano).
  const nelVideo = useMemo(
    () => new Set(riferimento.map((c) => c.materialId)),
    [riferimento]
  );

  const salva = useCallback(
    async (patch: { enabled?: boolean; offsetSec?: number }): Promise<boolean> => {
      setSalvando(true);
      setAvviso(null);
      try {
        const r = await fetch(url, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const nuovo = (await r.json()) as { enabled: boolean; offsetSec: number };
        await mutate((d) => (d ? { ...d, ...nuovo } : d), { revalidate: false });
        setAvviso(t('saved'));
        return true;
      } catch {
        toast.error(t('saveError'));
        return false;
      } finally {
        setSalvando(false);
      }
    },
    [url, mutate, t, toast]
  );

  if (isLoading) return <SkeletonLines lines={6} loadingLabel={t('title')} />;
  if (error || !data) {
    return (
      <div className="alert alert-danger small mb-0" role="alert">
        {t('loadError')}
      </div>
    );
  }

  const presentate = riferimento.length > 0;
  const disponibile = data.hasVideo && mostrabiliNelVideo.length > 0;
  const pubblico =
    disponibile &&
    data.enabled &&
    data.isEventVideo &&
    data.eventVideoPublished &&
    data.eventShowsMaterials &&
    withAvailableMaterials(salvati, (id) => mostrabili.has(id)).length > 0;
  const materialiDelVideo = data.materials.filter((m) => nelVideo.has(m.id));

  const onSalvaScarto = (e: FormEvent) => {
    e.preventDefault();
    if (scarto === null) return;
    void salva({ offsetSec: scarto });
  };

  const allineaQui = () => {
    const ora = playerRef.current?.currentTime() ?? 0;
    const nuovo = offsetToAlign(cues, scarto ?? salvato, ora, data.durationSec);
    if (nuovo === null) {
      setAvviso(t('alignNone'));
      return;
    }
    setBozza(String(nuovo));
    setAvviso(t('alignDone', { value: nuovo }));
  };

  return (
    <div className="recording-slides-admin">
      <h2 className="h5 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
        {t('title')}
      </h2>
      <p className="text-secondary" style={{ fontSize: '0.9rem', maxWidth: 720 }}>
        {t('intro')}
      </p>

      {/* Perché le slide si vedono o no, in quest'ordine. */}
      <ul className="recording-slides-admin__status mb-3">
        {!data.hasVideo ? (
          <li>{t('noVideo')}</li>
        ) : !presentate ? (
          <li>{t('noPresentation')}</li>
        ) : (
          <>
            {!data.isEventVideo && <li>{t('notEventVideo')}</li>}
            {data.isEventVideo && !data.eventVideoPublished && (
              <li>{t('notPublished')}</li>
            )}
            {mostrabiliNelVideo.length === 0 && <li>{t('noneShowable')}</li>}
            {!data.eventShowsMaterials && <li>{t('notShownOnPage')}</li>}
            {!data.exactZero && <li>{t('zeroEstimated')}</li>}
            {pubblico && (
              <li>
                {t('shownPublic')}{' '}
                <Link href={percorso(`/events/${data.eventSlug}`)} target="_blank">
                  {t('openPublic')}
                </Link>
              </li>
            )}
          </>
        )}
      </ul>

      <div className="border rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-start">
          <div className="me-3">
            <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
              {t('toggle')}
            </div>
            <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
              {t('toggleHelp')}
            </div>
          </div>
          <ToggleSwitch
            label=""
            ariaLabel={t('toggle')}
            checked={data.enabled && disponibile}
            onChange={() => void salva({ enabled: !data.enabled })}
            disabled={salvando || !disponibile}
          />
        </div>
      </div>

      {materialiDelVideo.length > 0 && (
        <div className="mb-3">
          <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
            {t('materialsTitle')}
          </h3>
          <ul className="mb-0" style={{ fontSize: '0.88rem' }}>
            {materialiDelVideo.map((m) => (
              <li key={m.id}>
                <span className="fw-semibold">{m.title || t('untitled')}</span>
                {' — '}
                <span className={m.problem ? 'text-danger' : 'text-success'}>
                  {m.problem ? t(`problem.${m.problem}`) : t('problem.none')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {disponibile && (
        <form className="border rounded p-3 mb-3" onSubmit={onSalvaScarto} noValidate>
          <label
            htmlFor={offsetId}
            className="fw-semibold d-block mb-1"
            style={{ color: 'var(--app-text)' }}
          >
            {t('offsetLabel')}
          </label>
          <p
            id={offsetHelpId}
            className="text-secondary mb-2"
            style={{ fontSize: '0.85rem' }}
          >
            {t('offsetHelp')}
          </p>
          <div className="d-flex flex-wrap align-items-center gap-2">
            <input
              id={offsetId}
              type="number"
              inputMode="numeric"
              step={1}
              min={-SLIDE_OFFSET_MAX_SEC}
              max={SLIDE_OFFSET_MAX_SEC}
              className={`form-control${scartoValido ? '' : ' is-invalid'}`}
              style={{ width: '8rem' }}
              value={bozza}
              onChange={(e) => setBozza(e.target.value)}
              aria-describedby={`${offsetHelpId}${scartoValido ? '' : ` ${offsetErrId}`}`}
              aria-invalid={scartoValido ? undefined : true}
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={salvando || !scartoValido || scarto === salvato}
            >
              {t('offsetSave')}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={salvando || bozza === '0'}
              onClick={() => setBozza('0')}
            >
              {t('offsetReset')}
            </button>
          </div>
          {!scartoValido && (
            <p id={offsetErrId} className="text-danger small mt-2 mb-0">
              {t('offsetInvalid', { max: SLIDE_OFFSET_MAX_SEC })}
            </p>
          )}
          {scartoValido && scarto !== salvato && (
            <p className="small mt-2 mb-0" style={{ color: 'var(--app-warning-text)' }}>
              {t('offsetUnsaved', { saved: salvato })}
            </p>
          )}
        </form>
      )}

      {/* Un esito per volta, letto senza interrompere. */}
      <p className="small text-secondary" role="status">
        {avviso ?? ''}
      </p>

      {disponibile && data.mediaUrl && (
        <section aria-labelledby={`${offsetId}-anteprima`}>
          <h3
            id={`${offsetId}-anteprima`}
            className="h6 fw-semibold mb-1"
            style={{ color: 'var(--app-text)' }}
          >
            {t('previewTitle')}
          </h3>
          <p className="text-secondary mb-2" style={{ fontSize: '0.85rem' }}>
            {t('previewHelp')}
          </p>
          <div className="row g-3">
            <div className="col-lg-7">
              <VideoPlayer
                ref={playerRef}
                src={data.mediaUrl}
                title={t('previewTitle')}
              />
              <div className="mt-2">
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  onClick={allineaQui}
                  aria-describedby={`${offsetId}-allinea`}
                >
                  {t('alignHere')}
                </button>
                <p id={`${offsetId}-allinea`} className="text-secondary small mt-1 mb-0">
                  {t('alignHelp')}
                </p>
              </div>
            </div>
            <div className="col-lg-5">
              <RecordingSlides
                playerRef={playerRef}
                cues={cues}
                materials={materialiAnteprima}
                headingLevel={3}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

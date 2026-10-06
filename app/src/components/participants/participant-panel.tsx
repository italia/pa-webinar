'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Icon } from '@/components/ui/icon';
import { avatarColor, avatarInitials } from '@/lib/chat/avatar';
import type { JitsiMeetExternalAPI, JitsiParticipant } from '@/types/jitsi';
import { useJitsiStats, qualityLabel, qualityColor } from '@/hooks/use-jitsi-stats';
import { humanParticipantCount, isHumanParticipant } from '@/lib/jitsi/participants';

import {
  canKick,
  normalizeRole,
  rolesAreMeaningful,
  rolesFromRoomsInfo,
  type ConferenceRole,
} from './participant-roles';
import { safeAvatarSrc } from './participant-avatar';

/** Oltre questo numero di persone compare la ricerca per nome. */
const SEARCH_FROM = 8;

/** Chi c'e' dietro un riquadro, per chi modera (GET /api/events/{slug}/seats). */
interface SeatView {
  kind: 'registration' | 'forwardedLink' | 'grant' | 'sharedModeratorLink' | 'contested';
  name: string | null;
  email: string | null;
}

/** Due nomi uguali a meno di maiuscole e spazi. */
function stessoNome(a: string, b: string): boolean {
  const n = (v: string) => v.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return n(a) === n(b);
}

/** Una firma dell'elenco: se non cambia, lo stato non si tocca. */
function firmaElenco(list: JitsiParticipant[]): string {
  return list.map((p) => `${p.participantId}|${p.displayName ?? ''}|${p.avatarURL ?? ''}`).join('\n');
}

interface ParticipantPanelProps {
  api: JitsiMeetExternalAPI | null;
  /** Ruolo nel PORTALE di chi guarda: decide il pulsante per espellere e
   *  l'email accanto ai nomi. */
  isModerator: boolean;
  /** Endpoint id di questo browser nella conferenza (da
   *  `videoConferenceJoined`): la propria riga non si espelle. */
  localParticipantId?: string | null;
  onCountChange?: (count: number) => void;
  /** La scheda e' aperta. Il pannello resta montato per seguire le mani alzate
   *  e il conteggio; a scheda chiusa non disegna l'elenco e non chiede altro. */
  visible?: boolean;
  /** Per l'elenco di chi c'e' dietro i riquadri: slug dell'evento e token
   *  della sala (solo chi modera lo legge). */
  eventSlug?: string;
  token?: string;
}

export default function ParticipantPanel({
  api,
  isModerator,
  localParticipantId = null,
  onCountChange,
  visible = true,
  eventSlug,
  token,
}: ParticipantPanelProps) {
  const t = useTranslations('live.participants');
  const tc = useTranslations('common');
  const [participants, setParticipants] = useState<JitsiParticipant[]>([]);
  // Per-participant LOCAL playback volume (0..1, default 1 = 100%) and
  // which row currently has its slider expanded. Kept separate from
  // `participants` so the 5s roster refresh never resets a user's choices.
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [openVolumeId, setOpenVolumeId] = useState<string | null>(null);
  // Ruoli nella conferenza, dall'unica fonte che li porta (vedi
  // participant-roles): `getParticipantsInfo()` non li ha.
  const [roles, setRoles] = useState<Record<string, ConferenceRole>>({});
  // Mani alzate (endpoint → ora dell'alzata, per l'ordine) e chi sta
  // parlando: il pannello resta montato anche a scheda chiusa, quindi li
  // segue per tutto l'evento.
  const [raised, setRaised] = useState<Record<string, number>>({});
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [persone, setPersone] = useState(0);
  // Per chi usa un lettore di schermo e modera: chi alza la mano.
  const [annuncio, setAnnuncio] = useState('');
  const gruppoId = useId();
  // Espellere non si annulla: il primo clic chiede conferma.
  const [armedKick, setArmedKick] = useState<string | null>(null);
  useEffect(() => {
    if (!armedKick) return;
    const timer = setTimeout(() => setArmedKick(null), 4000);
    return () => clearTimeout(timer);
  }, [armedKick]);
  // La qualita' della connessione la vede solo chi modera, a scheda aperta.
  const stats = useJitsiStats(isModerator && visible ? api : null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const firmaRef = useRef('');

  const refresh = useCallback(() => {
    if (!api) return;
    // Persone, non collegamenti: chi e' rientrato col tasto indietro lascia un
    // collegamento appeso che Jitsi toglie da solo dopo un po'. L'elenco li
    // mostra tutti (chi modera deve poterli espellere), il conteggio no.
    const count = humanParticipantCount(api, null, localParticipantId);
    setPersone(count);
    onCountChange?.(count);
    // A scheda chiusa basta il conteggio (il badge della scheda).
    if (!visibleRef.current) return;
    // Show EVERY human endpoint (i.e. minus the recorder bot). We deliberately
    // do NOT hide same-named connections from the roster — a moderator must be
    // able to see and kick every participant, and two distinct people can share
    // a name.
    const list = api.getParticipantsInfo().filter(isHumanParticipant);
    const firma = firmaElenco(list);
    if (firma !== firmaRef.current) {
      firmaRef.current = firma;
      setParticipants(list);
    }
    // I ruoli arrivano a parte e in modo asincrono; se la versione di Jitsi non
    // espone la richiesta, o fallisce, restano quelli noti e basta.
    let roomsInfo: Promise<unknown> | undefined;
    try {
      roomsInfo = api.getRoomsInfo?.();
    } catch {
      roomsInfo = undefined;
    }
    if (roomsInfo) {
      roomsInfo.then((info) => {
        const letti = rolesFromRoomsInfo(info);
        // Una risposta che non si sa leggere non cancella i ruoli gia' noti
        // dagli eventi `participantRoleChanged`.
        setRoles((prev) => (Object.keys(letti).length > 0 ? letti : prev));
      }).catch(() => {
        /* nessun ruolo nuovo: le etichette restano quelle note */
      });
    }
  }, [api, onCountChange, localParticipantId]);

  // Una raffica di ingressi (l'inizio dell'evento) fa una lettura sola.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSoon = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      refresh();
    }, 300);
  }, [refresh]);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, visible ? 5000 : 15000);
    return () => clearInterval(interval);
  }, [refresh, visible]);

  // Also refresh on join/leave/name-change events
  useEffect(() => {
    if (!api) return;
    const onJoin = () => refreshSoon();
    const onLeft = () => refreshSoon();
    const onNameChange = () => refreshSoon();
    const onRoleChange = (evt: { id: string; role: string }) => {
      const role = normalizeRole(evt?.role);
      if (!evt?.id || !role) return;
      setRoles((prev) => (prev[evt.id] === role ? prev : { ...prev, [evt.id]: role }));
    };
    const onRaiseHand = (evt: { id: string; handRaised: number }) => {
      if (!evt?.id) return;
      if (evt.handRaised > 0 && isModerator && visibleRef.current) {
        const chi = api.getParticipantsInfo().find((p) => p.participantId === evt.id);
        const nome = chi?.displayName || chi?.formattedDisplayName;
        if (nome) setAnnuncio(t('handRaisedAnnounce', { name: nome }));
      }
      setRaised((prev) => {
        // L'ordine e' quello d'arrivo in questo browser, come nella coda delle
        // mani di chi modera (raised-hands-panel): le due liste non discordano.
        if (evt.handRaised > 0) return prev[evt.id] ? prev : { ...prev, [evt.id]: Date.now() };
        if (!(evt.id in prev)) return prev;
        const next = { ...prev };
        delete next[evt.id];
        return next;
      });
    };
    const onSpeaker = (evt: { id: string }) => setSpeakingId(evt?.id ?? null);
    const onLeftAlso = (evt: { id: string }) => {
      if (!evt?.id) return;
      setRaised((prev) => {
        if (!(evt.id in prev)) return prev;
        const next = { ...prev };
        delete next[evt.id];
        return next;
      });
    };
    api.addListener('participantJoined', onJoin);
    api.addListener('participantLeft', onLeft);
    api.addListener('participantLeft', onLeftAlso);
    api.addListener('displayNameChange', onNameChange);
    api.addListener('participantRoleChanged', onRoleChange);
    api.addListener('raiseHandUpdated', onRaiseHand);
    api.addListener('dominantSpeakerChanged', onSpeaker);
    return () => {
      api.removeListener('participantJoined', onJoin);
      api.removeListener('participantLeft', onLeft);
      api.removeListener('participantLeft', onLeftAlso);
      api.removeListener('displayNameChange', onNameChange);
      api.removeListener('participantRoleChanged', onRoleChange);
      api.removeListener('raiseHandUpdated', onRaiseHand);
      api.removeListener('dominantSpeakerChanged', onSpeaker);
    };
  }, [api, refresh, refreshSoon, isModerator, t]);

  // Chi c'e' dietro i riquadri: solo per chi modera, a scheda aperta. Si
  // rilegge quando cambia l'elenco, e ogni tanto per chi dichiara in ritardo.
  const seatsUrl = isModerator && visible && eventSlug && token ? `/api/events/${eventSlug}/seats` : null;
  const { data: seatsData } = useSWR<{ seats: Record<string, SeatView> }>(
    seatsUrl ? [seatsUrl, token, participants.length] : null,
    async ([url, bearer]: [string, string]) => {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
      if (!res.ok) throw new Error(`seats ${res.status}`);
      return res.json();
    },
    { refreshInterval: 20_000, keepPreviousData: true },
  );
  const seats = seatsData?.seats ?? {};

  const handleKick = useCallback(
    (participantId: string) => {
      if (!api) return;
      api.executeCommand('kickParticipant', participantId);
    },
    [api],
  );

  // setParticipantVolume adjusts a remote participant's audio *for this
  // browser only* (a local gain on the received track — it never affects what
  // anyone else hears), so it's a per-user preference and is offered to every
  // attendee. Clamp to [0,1] to match the HTMLMediaElement volume range.
  const handleVolume = useCallback(
    (participantId: string, pct: number) => {
      if (!api) return;
      const level = Math.min(1, Math.max(0, pct / 100));
      // Local-only playback gain. Our served Jitsi build implements
      // setParticipantVolume (IFrame API, jitsi-meet PR #9322); executeCommand
      // dispatches async via postMessage, so there is nothing to try/catch here.
      // Known minor limitation: Jitsi resets a remote track's gain if that
      // participant's audio track is recreated (e.g. they mute→unmute), so the
      // stored value may need to be re-dragged to re-apply.
      api.executeCommand('setParticipantVolume', participantId, level);
      setVolumes((prev) => ({ ...prev, [participantId]: level }));
    },
    [api],
  );

  // Le etichette di ruolo solo se distinguono qualcuno: dove Jitsi fa
  // moderatore chiunque abbia un token, «Moderatore» su ogni riga sarebbe falso
  // quanto «Partecipante» su tutte (vedi participant-roles).
  const showRoles = rolesAreMeaningful(
    roles,
    participants.map((p) => p.participantId),
  );

  if (!visible) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // Il filtro vale solo finche' il campo si vede: sotto la soglia sparisce, e
  // con lui la ricerca rimasta scritta.
  const filtro = participants.length > SEARCH_FROM ? query.trim().toLocaleLowerCase() : '';
  const corrisponde = (p: JitsiParticipant) => {
    if (!filtro) return true;
    const seat = seats[p.participantId];
    return [p.displayName, p.formattedDisplayName, seat?.name, seat?.email].some((v) =>
      (v ?? '').toLocaleLowerCase().includes(filtro),
    );
  };
  const ordinati = [...participants]
    .filter(corrisponde)
    .sort((a, b) => {
      // Prima le mani alzate, nell'ordine in cui si sono alzate; poi per nome.
      const ra = raised[a.participantId];
      const rb = raised[b.participantId];
      if (ra && rb) return ra - rb;
      if (ra || rb) return ra ? -1 : 1;
      return (a.displayName ?? '').localeCompare(b.displayName ?? '');
    });
  const conduzione = showRoles ? ordinati.filter((p) => roles[p.participantId] === 'moderator') : [];
  const pubblico = showRoles ? ordinati.filter((p) => roles[p.participantId] !== 'moderator') : ordinati;
  const ordineMani = Object.entries(raised)
    .sort((x, y) => x[1] - y[1])
    .map(([id]) => id);

  const riga = (p: JitsiParticipant) => {
    const vol = volumes[p.participantId] ?? 1;
    const volPct = Math.round(vol * 100);
    const isVolumeOpen = openVolumeId === p.participantId;
    const shownName = p.displayName || p.formattedDisplayName || t('anonymous');
    const isSelf = !!localParticipantId && p.participantId === localParticipantId;
    const mano = ordineMani.indexOf(p.participantId);
    const parla = speakingId === p.participantId;
    const foto = safeAvatarSrc(p.avatarURL, origin);
    const armata = armedKick === p.participantId;
    const seat = isModerator ? seats[p.participantId] : undefined;
    const nomeDiverso =
      seat?.kind === 'registration' && !!seat.name && !stessoNome(seat.name, shownName);
    return (
      <li
        key={p.participantId}
        className={`people-row${parla ? ' is-speaking' : ''}${mano >= 0 ? ' has-hand' : ''}`}
      >
        <div className="people-row__main">
          <span
            className="people-row__avatar"
            style={foto ? undefined : { backgroundColor: avatarColor(shownName) }}
            aria-hidden="true"
          >
            {foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={foto} alt="" width={32} height={32} />
            ) : (
              avatarInitials(shownName)
            )}
          </span>
          <span className="people-row__who">
            <span className="people-row__name">
              {shownName}
              {isSelf && <span className="people-row__self">{t('you')}</span>}
            </span>
            {seat && (
              <span className="people-row__identity">
                {seat.kind === 'sharedModeratorLink' ? (
                  t('sharedModeratorLink')
                ) : seat.kind === 'contested' ? (
                  <span className="people-row__warn">{t('identityContested')}</span>
                ) : seat.kind === 'forwardedLink' ? (
                  <span className="people-row__warn">{t('forwardedLink', { email: seat.email ?? '' })}</span>
                ) : (
                  <>
                    {seat.email && <span className="people-row__email">{seat.email}</span>}
                    {nomeDiverso && (
                      <span className="people-row__warn">{t('registeredAs', { name: seat.name ?? '' })}</span>
                    )}
                  </>
                )}
              </span>
            )}
            {(parla || mano >= 0) && (
              <span className="people-row__state">
                {mano >= 0 && (
                  <span className="people-row__hand">
                    <span aria-hidden="true">✋</span> {t('raisedHand', { position: mano + 1 })}
                  </span>
                )}
                {parla && <span className="people-row__speaking">{t('speaking')}</span>}
              </span>
            )}
          </span>
          <span className="people-row__actions">
            {/* Per-user local playback volume. It only changes what THIS
                browser hears, so it's offered to every attendee. NB: contrary
                to the upstream docs, the external_api.js this platform serves
                DOES list the local user in getParticipantsInfo()
                (`video-conference-joined` falls through into
                `participant-joined`), so a self-row can appear;
                setParticipantVolume on it is simply inert — hence hidden. */}
            {!isSelf && (
              <button
                type="button"
                className={`qa-action${isVolumeOpen ? ' is-on' : ''}${volPct === 0 ? ' is-muted' : ''}`}
                onClick={() => setOpenVolumeId(isVolumeOpen ? null : p.participantId)}
                title={t('volume')}
                aria-label={t('volumeFor', { name: shownName })}
                aria-expanded={isVolumeOpen}
              >
                <VolumeGlyph muted={volPct === 0} />
              </button>
            )}
            {/* Lo decide il ruolo nel PORTALE, non quello in Jitsi (che senza
                ruoli dal token fa moderatori tutti), e mai sulla propria riga. */}
            {canKick(isModerator, p.participantId, localParticipantId) && (
              <button
                type="button"
                className={`qa-action qa-action--dismiss${armata ? ' is-armed' : ''}`}
                title={t('kick')}
                aria-label={armata ? `${t('kickName', { name: shownName })} — ${tc('confirm')}` : t('kickName', { name: shownName })}
                onClick={() => {
                  if (!armata) {
                    setArmedKick(p.participantId);
                    return;
                  }
                  setArmedKick(null);
                  handleKick(p.participantId);
                }}
              >
                <Icon icon="it-close-circle" size="sm" />
                {armata && <span>{t('kick')}</span>}
              </button>
            )}
          </span>
        </div>
        {isVolumeOpen && (
          <div className="people-row__volume">
            <input
              type="range"
              className="form-range"
              min={0}
              max={100}
              step={5}
              value={volPct}
              onChange={(e) => handleVolume(p.participantId, Number(e.target.value))}
              aria-label={t('volumeFor', { name: shownName })}
            />
            <span>{volPct}%</span>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="people">
      <div className="live-panel-header live-panel-header--bar people__header">
        <h6 className="live-panel-header__title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0066CC" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          {t('title')}
          <span className="live-panel-header__count">{persone}</span>
        </h6>
        {participants.length > persone && (
          <span className="people__links" title={t('connectionsHint')}>
            {t('connections', { count: participants.length })}
          </span>
        )}
      </div>

      <div className="visually-hidden" role="status" aria-live="polite">
        {annuncio}
      </div>

      <div className="people__body">
        {/* Connection quality indicator */}
        {isModerator && stats.connectionQuality !== null && (
          <div className="people__quality">
            <span
              className="people__quality-dot"
              style={{ backgroundColor: qualityColor(stats.connectionQuality) }}
              aria-hidden="true"
            />
            <span className="fw-semibold">{t('connectionQuality')}</span>
            <span style={{ color: qualityColor(stats.connectionQuality) }}>
              {t(`quality.${qualityLabel(stats.connectionQuality)}`)}
            </span>
            {stats.downloadBitrate !== null && (
              <span className="people__quality-rate">
                ↓{Math.round(stats.downloadBitrate)}
                {stats.uploadBitrate !== null && <>  ↑{Math.round(stats.uploadBitrate)}</>}
                {' kbps'}
              </span>
            )}
          </div>
        )}

        {participants.length > SEARCH_FROM && (
          <input
            type="search"
            className="people__search"
            placeholder={t('search')}
            aria-label={t('search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}

        {participants.length === 0 ? (
          <p className="people__empty">{t('noParticipants')}</p>
        ) : ordinati.length === 0 ? (
          <p className="people__empty">{t('noMatch')}</p>
        ) : (
          <>
            {/* Etichette di gruppo, non titoli: sotto il titolo del pannello
                non c'e' un livello di titolo piu' basso da usare. */}
            {conduzione.length > 0 && (
              <>
                <p className="people__group" id={`${gruppoId}-hosts`}>
                  {t('hosts')} <span>{conduzione.length}</span>
                </p>
                <ul className="people__list" aria-labelledby={`${gruppoId}-hosts`}>
                  {conduzione.map(riga)}
                </ul>
              </>
            )}
            {conduzione.length > 0 && (
              <p className="people__group" id={`${gruppoId}-audience`}>
                {t('audience')} <span>{pubblico.length}</span>
              </p>
            )}
            <ul
              className="people__list"
              aria-labelledby={conduzione.length > 0 ? `${gruppoId}-audience` : undefined}
            >
              {pubblico.map(riga)}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/** Feather-style speaker glyph. Bootstrap Italia has no volume icon, and inline
 *  SVG avoids the design-react-kit <Icon> hydration cost on a per-row control. */
function VolumeGlyph({ muted }: { muted: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      {muted ? (
        <>
          <line x1="22" y1="9" x2="16" y2="15" />
          <line x1="16" y1="9" x2="22" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      )}
    </svg>
  );
}

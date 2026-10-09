'use client';

import { useEffect, useState } from 'react';

import type { JitsiMeetExternalAPI } from '@/types/jitsi';

/**
 * Il nome di chi è sul palco della videochiamata, con lo stile della sala.
 *
 * Prende il posto dell'etichetta di Jitsi (`hideDominantSpeakerBadge`), che
 * non segue il design della sala e, stando in basso al centro, finiva sotto
 * i sottotitoli. La sala la disegna nella stessa colonna dei sottotitoli,
 * sotto di loro, così le due cose non si coprono mai. Come quella di Jitsi,
 * non c'è nella vista a griglia né quando sul palco c'è chi guarda.
 */
export default function StageName({ api }: { api: JitsiMeetExternalAPI | null }) {
  const [stageId, setStageId] = useState<string | null>(null);
  const [localId, setLocalId] = useState<string | null>(null);
  const [tileView, setTileView] = useState(false);
  // Cambia quando qualcuno cambia nome: rilegge il nome di chi è sul palco.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!api) return;
    // L'evento non porta l'id: lo dà l'API, che lo tiene da quando la sala
    // gliel'ha riferito.
    const onStage = () => {
      try {
        setStageId(api._getOnStageParticipant?.() ?? null);
      } catch {
        setStageId(null);
      }
    };
    const onJoined = (event: { id?: string }) => setLocalId(event?.id ?? null);
    const onTileView = (event: { enabled?: boolean }) => setTileView(Boolean(event?.enabled));
    const onRename = () => setVersion((v) => v + 1);
    const onLeft = (event: { id?: string }) => setStageId((current) => (current === event?.id ? null : current));
    api.addListener('largeVideoChanged', onStage);
    api.addListener('videoConferenceJoined', onJoined);
    api.addListener('tileViewChanged', onTileView);
    api.addListener('displayNameChange', onRename);
    api.addListener('participantLeft', onLeft);
    // Il palco può essere già cambiato prima che la sala si mettesse in ascolto.
    onStage();
    return () => {
      api.removeListener('largeVideoChanged', onStage);
      api.removeListener('videoConferenceJoined', onJoined);
      api.removeListener('tileViewChanged', onTileView);
      api.removeListener('displayNameChange', onRename);
      api.removeListener('participantLeft', onLeft);
    };
  }, [api]);

  if (!api || !stageId || stageId === localId || tileView) return null;
  let name = '';
  try {
    name = api.getDisplayName(stageId)?.trim() ?? '';
  } catch {
    name = '';
  }
  if (!name) return null;
  return (
    <p className="live-stage-name" data-version={version}>
      {name}
    </p>
  );
}

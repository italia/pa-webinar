-- ADR-013 archive: nuovo job ARCHIVE + artefatto ARCHIVE_MKV.
-- Archivio scaricabile multi-traccia (video + tracce audio per-partecipante
-- + sottotitoli) generato on-demand. Gated da Event.retainParticipantTracks.

ALTER TYPE "PostprodJobKind" ADD VALUE IF NOT EXISTS 'ARCHIVE';
ALTER TYPE "PostprodArtifactType" ADD VALUE IF NOT EXISTS 'ARCHIVE_MKV';

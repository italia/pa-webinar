-- Aggiunge WAVEFORM_JSON al type enum PostprodArtifactType.
-- Picchi audio pre-calcolati dal worker per la waveform dell'editor.
-- Postgres richiede ALTER TYPE separato; il client Prisma viene
-- rigenerato dopo `prisma generate`.
ALTER TYPE "PostprodArtifactType" ADD VALUE IF NOT EXISTS 'WAVEFORM_JSON';

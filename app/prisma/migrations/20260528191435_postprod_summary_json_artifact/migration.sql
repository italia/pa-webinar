-- Aggiunge SUMMARY_JSON al type enum PostprodArtifactType.
-- Postgres richiede ALTER TYPE separato; il client Prisma viene
-- rigenerato dopo `prisma generate`.
ALTER TYPE "PostprodArtifactType" ADD VALUE IF NOT EXISTS 'SUMMARY_JSON';

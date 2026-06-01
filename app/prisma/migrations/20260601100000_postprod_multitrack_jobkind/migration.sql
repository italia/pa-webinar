-- Aggiunge TRANSCRIBE_MULTITRACK a PostprodJobKind (ADR-013).
-- ALTER TYPE separato (Postgres) — il client Prisma viene rigenerato.
ALTER TYPE "PostprodJobKind" ADD VALUE IF NOT EXISTS 'TRANSCRIBE_MULTITRACK';

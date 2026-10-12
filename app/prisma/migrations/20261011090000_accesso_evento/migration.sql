-- Chi puo' partecipare, deciso per evento: OPEN si iscrive chiunque,
-- INVITATION solo gli invitati e nessuno entra da ospite. NULL (gli eventi
-- esistenti) = come dice il sito (site_settings.public_registration_enabled e
-- guest_access_enabled): il comportamento non cambia.

-- CreateEnum
CREATE TYPE "EventAccessMode" AS ENUM ('OPEN', 'INVITATION');

-- AlterTable
ALTER TABLE "events" ADD COLUMN "access_mode" "EventAccessMode";

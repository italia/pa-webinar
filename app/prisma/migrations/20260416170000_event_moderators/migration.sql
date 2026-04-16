-- Co-moderators with individual magic-link tokens.
--
-- The primary `events.moderator_token` stays: it's the legacy "owner"
-- link. On top of it, each event can have named co-moderators with
-- their own token, display name and optional email. Revoking one
-- co-moderator sets `revoked_at` without touching the others and
-- without invalidating the primary link.

CREATE TABLE "event_moderators" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "token" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),

  CONSTRAINT "event_moderators_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_moderators_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "event_moderators_token_key" ON "event_moderators" ("token");
CREATE INDEX "event_moderators_event_id_idx" ON "event_moderators" ("event_id");

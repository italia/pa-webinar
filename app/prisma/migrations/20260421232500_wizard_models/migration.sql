-- Schema additions backing the 5-step event-creation wizard:
--
--   1. Event.recurrence_{rule,series_id}  — RRULE + self-FK for "every Friday"
--      style repeating events. Null on one-offs (current behaviour).
--   2. Event.permission_matrix, event_templates.permission_matrix — JSONB
--      role×feature allowlist that the UI writes alongside the legacy
--      boolean toggles. Nullable; when null, toggles win.
--   3. event_invitations — guest/speaker pre-registration list with
--      optional Person (rubrica) link and magic-link registration token.
--   4. tags + event_tag_links — taxonomy for filtering on /eventi.

-- 1) Event recurrence
ALTER TABLE "events"
  ADD COLUMN "recurrence_rule"       VARCHAR(500),
  ADD COLUMN "recurrence_series_id"  UUID;

ALTER TABLE "events"
  ADD CONSTRAINT "events_recurrence_series_id_fkey"
  FOREIGN KEY ("recurrence_series_id") REFERENCES "events"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "events_recurrence_series_id_idx" ON "events" ("recurrence_series_id");

-- 2) Permission matrix (Event + EventTemplate)
ALTER TABLE "events"           ADD COLUMN "permission_matrix" JSONB;
ALTER TABLE "event_templates"  ADD COLUMN "permission_matrix" JSONB;

-- 3) Invitations
CREATE TYPE "EventInvitationRole" AS ENUM ('GUEST', 'SPEAKER');

CREATE TABLE "event_invitations" (
  "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "event_id"    UUID         NOT NULL,
  "person_id"   UUID,
  "role"        "EventInvitationRole" NOT NULL DEFAULT 'GUEST',
  "name"        VARCHAR(200),
  "email"       VARCHAR(200) NOT NULL,
  "token"       TEXT,
  "sent_at"     TIMESTAMP(3),
  "accepted_at" TIMESTAMP(3),
  "declined_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "event_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_invitations_token_key"      ON "event_invitations" ("token");
CREATE UNIQUE INDEX "event_invitations_event_email_ux" ON "event_invitations" ("event_id", "email");
CREATE INDEX        "event_invitations_event_id_idx"   ON "event_invitations" ("event_id");
CREATE INDEX        "event_invitations_person_id_idx"  ON "event_invitations" ("person_id");

ALTER TABLE "event_invitations"
  ADD CONSTRAINT "event_invitations_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_invitations"
  ADD CONSTRAINT "event_invitations_person_id_fkey"
  FOREIGN KEY ("person_id") REFERENCES "persons"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Tags
CREATE TABLE "tags" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "slug"       VARCHAR(100) NOT NULL,
  "name"       JSONB        NOT NULL DEFAULT '{}',
  "color"      VARCHAR(10),
  "sort_order" INTEGER      NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tags_slug_key" ON "tags" ("slug");

CREATE TABLE "event_tag_links" (
  "event_id" UUID NOT NULL,
  "tag_id"   UUID NOT NULL,

  CONSTRAINT "event_tag_links_pkey" PRIMARY KEY ("event_id", "tag_id")
);

CREATE INDEX "event_tag_links_tag_id_idx" ON "event_tag_links" ("tag_id");

ALTER TABLE "event_tag_links"
  ADD CONSTRAINT "event_tag_links_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_tag_links"
  ADD CONSTRAINT "event_tag_links_tag_id_fkey"
  FOREIGN KEY ("tag_id") REFERENCES "tags"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

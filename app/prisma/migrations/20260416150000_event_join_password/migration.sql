-- Optional join password for events.
--
-- When set, guests hitting /events/<slug>/live without a matching
-- accessToken (or a moderator token) are asked for the password before
-- a Jitsi JWT is issued. Moderators and registered participants still
-- join without typing it — their token is enough.
--
-- Stored as a bcrypt hash: we never need to surface the cleartext again
-- (the admin sets it once, and verification is always done server-side),
-- and a hash lets us avoid leaking the password to any DB dump.

ALTER TABLE "events"
  ADD COLUMN "join_password_hash" TEXT;

-- Chi organizza puo' dichiarare che moderatori e relatori sono sempre nella
-- registrazione. Spento per ogni evento: scelgono come tutti.
ALTER TABLE "events" ADD COLUMN "hosts_always_recorded" BOOLEAN NOT NULL DEFAULT false;

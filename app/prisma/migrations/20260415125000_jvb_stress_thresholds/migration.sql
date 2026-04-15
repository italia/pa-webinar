-- Admin-configurable reactive scale-up stress thresholds
ALTER TABLE "site_settings"
  ADD COLUMN IF NOT EXISTS "jvb_stress_warn_percent"     INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "jvb_stress_critical_percent" INTEGER NOT NULL DEFAULT 70;

-- JVB sizing calculator (per-cluster, admin-tunable) + soft-exit grace.
--
-- Defaults are calibrated on Azure F16s_v2 (16 vCPU / 32 GiB) used by
-- the DTD test environment. Any operator running on different hardware
-- tweaks these values from the admin UI — no redeploy.

ALTER TABLE site_settings
  ADD COLUMN jvb_cpu_cores_per_pod      INT              NOT NULL DEFAULT 16,
  ADD COLUMN jvb_receivers_per_core     DOUBLE PRECISION NOT NULL DEFAULT 18.75,
  ADD COLUMN jvb_senders_per_core       DOUBLE PRECISION NOT NULL DEFAULT 3.125,
  ADD COLUMN jvb_max_replicas           INT              NOT NULL DEFAULT 6,
  ADD COLUMN jibri_cpu_cores_per_pod    INT              NOT NULL DEFAULT 4,
  ADD COLUMN default_sender_ratio_pct   INT              NOT NULL DEFAULT 30,
  ADD COLUMN event_grace_period_minutes INT              NOT NULL DEFAULT 15;

-- Per-event overrides. Both null → inherit from SiteSetting.
ALTER TABLE events
  ADD COLUMN expected_sender_ratio_pct INT,
  ADD COLUMN grace_period_minutes      INT;

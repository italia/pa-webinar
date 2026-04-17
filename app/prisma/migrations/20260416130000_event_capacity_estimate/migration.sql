-- Event capacity estimate snapshot
--
-- Stores the pre-event resource estimate (bandwidth, JVB count, JVB RAM,
-- storage, duration) computed from feature toggles + maxParticipants at
-- create/update time. Kept for later comparison with actual consumption
-- from Prometheus so we can refine the estimate formula and pre-size
-- the JVB node pool more accurately.

ALTER TABLE "events"
  ADD COLUMN "capacity_estimate_json" JSONB;

-- Migration: Convert bilingual It/En columns to multilingual JSON fields
-- Run this BEFORE `prisma db push` to preserve existing data.

-- ── Events table ─────────────────────────────────────────────

-- Step 1: Add new JSON columns
ALTER TABLE events ADD COLUMN IF NOT EXISTS title jsonb NOT NULL DEFAULT '{}';
ALTER TABLE events ADD COLUMN IF NOT EXISTS description jsonb NOT NULL DEFAULT '{}';
ALTER TABLE events ADD COLUMN IF NOT EXISTS speakers_info jsonb NOT NULL DEFAULT '{}';

-- Step 2: Migrate existing data into JSON
UPDATE events SET
  title = jsonb_build_object('it', title_it, 'en', COALESCE(title_en, title_it)),
  description = jsonb_build_object('it', description_it, 'en', COALESCE(description_en, description_it)),
  speakers_info = CASE
    WHEN speakers_it IS NOT NULL OR speakers_en IS NOT NULL
    THEN jsonb_build_object(
      'it', COALESCE(speakers_it, ''),
      'en', COALESCE(speakers_en, COALESCE(speakers_it, ''))
    )
    ELSE '{}'::jsonb
  END;

-- Step 3: Drop old columns
ALTER TABLE events DROP COLUMN IF EXISTS title_it;
ALTER TABLE events DROP COLUMN IF EXISTS title_en;
ALTER TABLE events DROP COLUMN IF EXISTS description_it;
ALTER TABLE events DROP COLUMN IF EXISTS description_en;
ALTER TABLE events DROP COLUMN IF EXISTS speakers_it;
ALTER TABLE events DROP COLUMN IF EXISTS speakers_en;

-- ── Site settings table ──────────────────────────────────────

-- Step 1: Add new JSON columns
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS privacy_policy jsonb NOT NULL DEFAULT '{}';
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS accessibility jsonb NOT NULL DEFAULT '{}';
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS default_locale text NOT NULL DEFAULT 'it';

-- Step 2: Migrate existing data
UPDATE site_settings SET
  privacy_policy = CASE
    WHEN privacy_policy_it IS NOT NULL OR privacy_policy_en IS NOT NULL
    THEN jsonb_build_object(
      'it', COALESCE(privacy_policy_it, ''),
      'en', COALESCE(privacy_policy_en, COALESCE(privacy_policy_it, ''))
    )
    ELSE '{}'::jsonb
  END,
  accessibility = CASE
    WHEN accessibility_it IS NOT NULL OR accessibility_en IS NOT NULL
    THEN jsonb_build_object(
      'it', COALESCE(accessibility_it, ''),
      'en', COALESCE(accessibility_en, COALESCE(accessibility_it, ''))
    )
    ELSE '{}'::jsonb
  END;

-- Step 3: Drop old columns
ALTER TABLE site_settings DROP COLUMN IF EXISTS privacy_policy_it;
ALTER TABLE site_settings DROP COLUMN IF EXISTS privacy_policy_en;
ALTER TABLE site_settings DROP COLUMN IF EXISTS accessibility_it;
ALTER TABLE site_settings DROP COLUMN IF EXISTS accessibility_en;

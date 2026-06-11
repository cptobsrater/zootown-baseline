-- Phase 6: feed presets + composite-feed signals.
--
-- This migration:
--   1. Adds confidence (numeric 0..1) and alt_desks (text[]) columns to stories
--      so the classifier can publish its secondary signals for composite views.
--   2. Backfills confidence=1.0 on existing rows so they aren't penalized when
--      a composite preset orders by confidence.
--   3. Creates feed_presets (saved composite-filter recipes) and
--      feed_preset_events (append-only telemetry log).
--   4. Adds the indexes needed for fast lookup by owner, slug, scope, and the
--      GIN index on alt_desks for the && (array-overlap) composite query.
--
-- All statements are idempotent (IF NOT EXISTS / additive ADD COLUMN) so the
-- migration can be re-applied safely if a deploy retries.

-- ---------- stories: classifier signals ----------

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS confidence numeric(3, 2);

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS alt_desks text[];

-- Existing rows didn't have a confidence value. Treat them as fully-trusted
-- so they don't sink to the bottom of confidence-ordered composite feeds.
UPDATE stories
SET confidence = 1.0
WHERE confidence IS NULL;

-- Ensure new rows always carry a score even if the ingester forgets.
ALTER TABLE stories
  ALTER COLUMN confidence SET DEFAULT 1.0;

ALTER TABLE stories
  ALTER COLUMN confidence SET NOT NULL;

-- Default alt_desks to an empty array so the && overlap query never sees NULL.
UPDATE stories
SET alt_desks = ARRAY[]::text[]
WHERE alt_desks IS NULL;

ALTER TABLE stories
  ALTER COLUMN alt_desks SET DEFAULT ARRAY[]::text[];

ALTER TABLE stories
  ALTER COLUMN alt_desks SET NOT NULL;

-- GIN index for the array-overlap query used by composite (multi-desk) feeds:
--   WHERE alt_desks && ARRAY['sports','entertainment']::text[]
CREATE INDEX IF NOT EXISTS stories_alt_desks_gin_idx
  ON stories USING GIN (alt_desks);

-- Helpful btree index for confidence-sort composite feeds.
CREATE INDEX IF NOT EXISTS stories_confidence_idx
  ON stories (confidence DESC);

-- ---------- feed_presets: saved composite recipes ----------

CREATE TABLE IF NOT EXISTS feed_presets (
  id              serial PRIMARY KEY,
  -- Owner (admin user). When scope='personal', this is required. When
  -- scope='shared', null means "any admin can manage". We don't enforce a
  -- foreign key because admin identity lives in admin_tokens / Supabase
  -- auth, not a local users table — yet. Treat as opaque string ID.
  owner_id        text,
  scope           text NOT NULL DEFAULT 'personal'
                  CHECK (scope IN ('personal', 'shared', 'org')),
  -- Display name as the admin typed it.
  name            text NOT NULL,
  -- URL-safe slug derived from name. Used in deep links like
  -- /admin/inbox?preset=sports-arts-this-week
  slug            text NOT NULL,
  -- The filter recipe payload. Validated by Zod on every write; stored as
  -- JSONB so we can evolve it without further DDL.
  config          jsonb NOT NULL,
  -- Optional pin to a specific city. NULL = "follow the admin's current city".
  city_id         integer REFERENCES cities(id) ON DELETE SET NULL,
  -- Chip ordering within the admin's preset bar. Lower = leftmost.
  sort_order      integer NOT NULL DEFAULT 0,
  -- Soft-disable instead of hard-deleting so usage history survives renames
  -- and accidental deletes. A nightly job can hard-purge entries with
  -- is_active=false AND updated_at < now() - interval '30 days'.
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Bumped whenever config changes. Lets the client detect stale presets
  -- and gives us cheap optimistic concurrency on PATCH.
  config_version  integer NOT NULL DEFAULT 1
);

-- One preset name per owner. Shared presets need a globally-unique name —
-- we encode that by treating owner_id IS NULL as a single virtual owner.
-- The partial unique index handles both cases.
CREATE UNIQUE INDEX IF NOT EXISTS feed_presets_owner_name_uk
  ON feed_presets (COALESCE(owner_id, '__shared__'), lower(name))
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS feed_presets_owner_slug_uk
  ON feed_presets (COALESCE(owner_id, '__shared__'), slug)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS feed_presets_scope_active_idx
  ON feed_presets (scope, is_active);

CREATE INDEX IF NOT EXISTS feed_presets_city_idx
  ON feed_presets (city_id) WHERE city_id IS NOT NULL;

-- ---------- feed_preset_events: append-only telemetry ----------

CREATE TABLE IF NOT EXISTS feed_preset_events (
  id                bigserial PRIMARY KEY,
  -- Nullable so we can log ad-hoc filter combinations (no saved preset yet).
  -- The suggestion engine uses filter_signature to find candidate presets.
  preset_id         integer REFERENCES feed_presets(id) ON DELETE SET NULL,
  -- Deterministic hash of {cityId, desks_sorted, modState, isReviewed,
  -- timeWindowHours, sort}. Equivalent filter combos roll up across admins.
  filter_signature  text NOT NULL,
  admin_id          text,
  city_id           integer REFERENCES cities(id) ON DELETE SET NULL,
  action            text NOT NULL
                    CHECK (action IN (
                      'apply', 'save', 'update', 'delete',
                      'suggest_seen', 'suggest_apply'
                    )),
  -- Small JSON snapshot for ML / debugging. Keep < 1KB.
  payload           jsonb,
  at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fpe_preset_at_idx
  ON feed_preset_events (preset_id, at DESC);

CREATE INDEX IF NOT EXISTS fpe_signature_idx
  ON feed_preset_events (filter_signature, city_id, at DESC);

CREATE INDEX IF NOT EXISTS fpe_admin_at_idx
  ON feed_preset_events (admin_id, at DESC);

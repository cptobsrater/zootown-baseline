-- Phase 7: user feedback table.
-- Public submissions land here via POST /api/feedback. The cockpit reads
-- and triages via /api/admin/feedback*. Schema is intentionally minimal:
-- no PII linkage to user accounts (we have none), no IP, only what the
-- submitter chose to share.

CREATE TABLE IF NOT EXISTS feedback (
  id              serial PRIMARY KEY,
  body            text   NOT NULL,
  name            text,                    -- optional: submitter's name
  email           text,                    -- optional: contact email
  city_slug       text,                    -- which city's feed they were on
  page_url        text,                    -- the page URL they were on
  user_agent      text,                    -- coarse client info
  status          text   NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'in_progress', 'resolved', 'archived')),
  admin_note      text,                    -- internal note from a cockpit admin
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

CREATE INDEX IF NOT EXISTS feedback_status_created_idx
  ON feedback (status, created_at DESC);

CREATE INDEX IF NOT EXISTS feedback_city_idx
  ON feedback (city_slug) WHERE city_slug IS NOT NULL;

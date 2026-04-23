-- Phase 6.5 — Client-facing portal (share-link model)
--
-- Per the notes: "Keep this as a lightweight client-view/client-section
-- concept. Do not build a huge portal unless the current system already
-- supports it."
--
-- Design choice — no new auth role / no per-client login. An admin
-- generates an unguessable token per facility (or per client org).
-- Anyone with the URL can view a read-only snapshot of what's happening
-- for that facility: active placements + upcoming submissions + open
-- job coverage. Tokens can be revoked instantly. Lightweight = correct
-- for the request scope.

CREATE TABLE IF NOT EXISTS client_view_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Random 32-char token. The URL segment. Unique + indexed for O(1)
  -- lookup.
  token VARCHAR(64) NOT NULL UNIQUE,
  -- Scope — one or the other. If facility_id is set, the portal only
  -- shows that facility. If client_id is set (and facility_id is null),
  -- the portal shows all facilities under that client.
  facility_id UUID REFERENCES facilities(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  -- Human label shown at the top of the portal — usually the client's
  -- name or the facility's name. Admin-editable.
  display_label VARCHAR(200),
  expires_at TIMESTAMPTZ,                                 -- NULL = never
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  last_accessed_at TIMESTAMPTZ,                           -- updated on GET /view/:token
  access_count INT NOT NULL DEFAULT 0,
  created_by VARCHAR(255),                                -- clerk_user_id
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (facility_id IS NOT NULL OR client_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_client_view_tokens_token        ON client_view_tokens(token);
CREATE INDEX IF NOT EXISTS idx_client_view_tokens_facility_id  ON client_view_tokens(facility_id);
CREATE INDEX IF NOT EXISTS idx_client_view_tokens_client_id    ON client_view_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_client_view_tokens_active       ON client_view_tokens(revoked) WHERE revoked = FALSE;

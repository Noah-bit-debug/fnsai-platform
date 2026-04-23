-- Phase 4.2 — Business Development Bids
--
-- Adds a real backend for the bidding workflow called out in the Phase 4
-- notes: "bid checklist, required steps tracking, AI help with bid
-- creation". Everything the frontend renders in the Bids tab comes from
-- these two tables.
--
-- Notes on shape:
--   * A bid belongs to zero or one facility. We keep client_name as a
--     free-text mirror so bids to prospective (not-yet-onboarded)
--     clients can still be tracked without forcing a facilities row.
--   * status is a plain VARCHAR with a CHECK constraint (not a PG enum)
--     because adding values later via ALTER TYPE requires care; CHECK
--     is easy to DROP/ADD.
--   * Checklist items are a child table (not jsonb column) so we can
--     query "show me all bids blocked on Legal review" cheaply, and so
--     completed_by / completed_at survive edits to sibling items.

CREATE TABLE IF NOT EXISTS bd_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  client_name VARCHAR(200),                                  -- free-text mirror
  facility_id UUID REFERENCES facilities(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','in_progress','submitted','won','lost')),
  due_date DATE,
  estimated_value NUMERIC(12,2),                             -- dollar value of the deal
  assigned_to VARCHAR(255),                                  -- clerk_user_id of owner
  notes TEXT,
  -- Audit
  created_by VARCHAR(255),                                   -- clerk_user_id
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bd_bids_status        ON bd_bids(status);
CREATE INDEX IF NOT EXISTS idx_bd_bids_due_date      ON bd_bids(due_date);
CREATE INDEX IF NOT EXISTS idx_bd_bids_assigned_to   ON bd_bids(assigned_to);
CREATE INDEX IF NOT EXISTS idx_bd_bids_facility_id   ON bd_bids(facility_id);

CREATE TABLE IF NOT EXISTS bd_bid_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id UUID NOT NULL REFERENCES bd_bids(id) ON DELETE CASCADE,
  label VARCHAR(300) NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by VARCHAR(255),                                 -- clerk_user_id
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bd_bid_checklist_bid ON bd_bid_checklist_items(bid_id, order_index);

-- No default seed rows. A default 8-step checklist is inserted by the
-- backend route when a new bid is created — that keeps the SQL simple
-- and lets admins override the default template in one place.

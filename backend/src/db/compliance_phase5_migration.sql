-- Add Clerk user linkage to staff table
ALTER TABLE staff ADD COLUMN IF NOT EXISTS clerk_user_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_staff_clerk_user_id ON staff(clerk_user_id);

-- Track compliance bundle assignments to candidates/staff via onboarding
CREATE TABLE IF NOT EXISTS comp_onboarding_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  bundle_id UUID NOT NULL REFERENCES comp_bundles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by VARCHAR(255),
  trigger_type VARCHAR(50) DEFAULT 'manual'
    CHECK (trigger_type IN ('manual','stage_change','auto_rule'))
);

CREATE INDEX IF NOT EXISTS idx_comp_onboarding_candidate ON comp_onboarding_assignments(candidate_id);
CREATE INDEX IF NOT EXISTS idx_comp_onboarding_staff ON comp_onboarding_assignments(staff_id);
CREATE INDEX IF NOT EXISTS idx_comp_onboarding_bundle ON comp_onboarding_assignments(bundle_id);

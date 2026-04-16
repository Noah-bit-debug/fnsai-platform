-- Pre-role assignments: automatically assign roles to users when they first sign up
CREATE TABLE IF NOT EXISTS pre_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(50) NOT NULL,
  notes TEXT,
  applied BOOLEAN DEFAULT FALSE,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed known pre-assignments
INSERT INTO pre_role_assignments (email, role, notes)
VALUES ('remps@frontlinenursestaffing.com', 'ceo', 'Pre-assigned CEO role before account creation')
ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, notes = EXCLUDED.notes;

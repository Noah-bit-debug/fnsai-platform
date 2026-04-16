-- Phase 4: Better indexes for certificate lookups
CREATE INDEX IF NOT EXISTS idx_comp_certificates_user   ON comp_certificates(user_clerk_id);
CREATE INDEX IF NOT EXISTS idx_comp_certificates_number ON comp_certificates(certificate_number);
CREATE INDEX IF NOT EXISTS idx_comp_certificates_exam   ON comp_certificates(exam_id);

-- Competency records time-series indexes
CREATE INDEX IF NOT EXISTS idx_comp_records_completed ON comp_competency_records(completed_date);
CREATE INDEX IF NOT EXISTS idx_comp_records_assigned  ON comp_competency_records(assigned_date);

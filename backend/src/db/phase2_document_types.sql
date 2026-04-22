-- Phase 2.2 — Admin-defined document types.
--
-- Previously the documentReviewer service had a hardcoded DOC_TYPE_HINTS
-- map with ~15 types (bls, acls, rn_license, etc.) baked into TypeScript.
-- Admins couldn't add new types (e.g. "TB renewal form", "Respirator fit
-- test") without a code deploy.
--
-- This table is the canonical source of truth. documentReviewer looks
-- up the row by `key`, uses its `prompt_hints`, `issuing_bodies`, and
-- `expires_months` to build the AI review prompt. If a type isn't in
-- the table, fall back to the old hardcoded map (so existing workflows
-- keep working during migration).

CREATE TABLE IF NOT EXISTS doc_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Short slug used by candidate_documents.document_type ('bls', 'acls', etc.)
  key TEXT NOT NULL UNIQUE,
  -- Human label shown in the picker ("BLS Card", "RN License")
  label TEXT NOT NULL,
  -- Longer description — shown to admin on hover / help text
  description TEXT,
  -- Hint text injected into the Claude prompt when reviewing a doc of this
  -- type. Tells the AI what the document should contain and what "valid"
  -- looks like.
  prompt_hints TEXT NOT NULL,
  -- Allowed issuing bodies, e.g. ['American Heart Association', 'American Red Cross']
  -- for BLS. Empty array = no issuer restriction.
  issuing_bodies TEXT[] DEFAULT '{}',
  -- Typical validity window in months. Used to warn about imminent expiry.
  -- NULL if the document doesn't expire (e.g. diploma).
  expires_months INT,
  -- 'nursing', 'employment', 'training', 'legal' — used for grouping in UI
  category TEXT,
  -- Additional required fields the AI should verify are present on the
  -- document image: ['cardholder_name', 'issue_date', 'expiry_date', 'card_number']
  required_fields TEXT[] DEFAULT '{}',
  -- Apply to which staff roles? ['RN','LPN'] or empty for all
  applicable_roles TEXT[] DEFAULT '{}',
  active BOOLEAN DEFAULT TRUE,
  -- Audit
  created_by VARCHAR(255),  -- clerk_user_id
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_types_key      ON doc_types(key);
CREATE INDEX IF NOT EXISTS idx_doc_types_active   ON doc_types(active);
CREATE INDEX IF NOT EXISTS idx_doc_types_category ON doc_types(category);

-- Seed with the same hardcoded types that were previously baked into
-- documentReviewer.ts, so existing workflows keep behaving identically.
-- Admins can now edit these or add more via the admin UI.
INSERT INTO doc_types (key, label, description, prompt_hints, issuing_bodies, expires_months, category, required_fields, applicable_roles)
VALUES
  ('bls',
   'BLS Certification',
   'Basic Life Support card (CPR for healthcare providers).',
   'BLS card from American Heart Association (AHA) or American Red Cross (ARC). Must show cardholder name, issue date, expiry date (typically 2 years from issue). Check the AHA/ARC logo is present.',
   ARRAY['American Heart Association','American Red Cross'],
   24, 'nursing',
   ARRAY['cardholder_name','issue_date','expiry_date'],
   ARRAY['RN','LPN','LVN','CNA','RT','NP','PA']),

  ('acls',
   'ACLS Certification',
   'Advanced Cardiovascular Life Support — required for ICU/ER/acute care.',
   'ACLS card from AHA or ARC. Cardholder name, issue date, expiry date (typically 2 years). ACLS-specific logo/branding.',
   ARRAY['American Heart Association','American Red Cross'],
   24, 'nursing',
   ARRAY['cardholder_name','issue_date','expiry_date'],
   ARRAY['RN','NP','PA']),

  ('pals',
   'PALS Certification',
   'Pediatric Advanced Life Support.',
   'PALS card from AHA or ARC. Cardholder name, issue date, expiry date (typically 2 years).',
   ARRAY['American Heart Association','American Red Cross'],
   24, 'nursing',
   ARRAY['cardholder_name','issue_date','expiry_date'],
   ARRAY['RN','NP','PA']),

  ('rn_license',
   'State RN License',
   'Active Registered Nurse license issued by a state board of nursing.',
   'State RN nursing license. License number, state of issue, issue date, expiry date, license holder name, and current active/verified status.',
   ARRAY[]::TEXT[], 24, 'nursing',
   ARRAY['license_number','state','expiry_date','holder_name'],
   ARRAY['RN']),

  ('lpn_license',
   'State LPN/LVN License',
   'Licensed Practical/Vocational Nurse license.',
   'State LPN/LVN license with number, state, dates, holder name, active status.',
   ARRAY[]::TEXT[], 24, 'nursing',
   ARRAY['license_number','state','expiry_date','holder_name'],
   ARRAY['LPN','LVN']),

  ('cna_certification',
   'State CNA Certification',
   'Certified Nursing Assistant certification.',
   'State CNA certification. Certification number, state, dates, holder name.',
   ARRAY[]::TEXT[], 24, 'nursing',
   ARRAY['certification_number','state','expiry_date','holder_name'],
   ARRAY['CNA']),

  ('tb_test',
   'TB Test',
   'Annual TB test — PPD skin test or QuantiFERON blood test.',
   'TB test (PPD or QuantiFERON). Test date within last 12 months. Must show result (positive/negative) and tester/clinic signature.',
   ARRAY[]::TEXT[], 12, 'nursing',
   ARRAY['test_date','result','tester_signature'],
   ARRAY[]::TEXT[]),

  ('background_check',
   'Background Check',
   'Criminal background check from a recognized vendor.',
   'Criminal background check from a recognized vendor (e.g., Checkr, HireRight, Accurate). Must show candidate name, date of report, and clear/flagged status.',
   ARRAY['Checkr','HireRight','Accurate Background'],
   12, 'employment',
   ARRAY['candidate_name','report_date','result'],
   ARRAY[]::TEXT[]),

  ('drug_screen',
   'Drug Screen',
   'Toxicology / drug screen test.',
   'Drug screen / toxicology report. Candidate name, collection date, clinic, substances tested, negative/positive result.',
   ARRAY[]::TEXT[], 12, 'employment',
   ARRAY['candidate_name','collection_date','result'],
   ARRAY[]::TEXT[]),

  ('resume',
   'Resume / CV',
   'Professional resume.',
   'A resume / CV — professional summary, work history, education, skills, certifications, contact info.',
   ARRAY[]::TEXT[], NULL, 'employment',
   ARRAY['name','work_history','contact_info'],
   ARRAY[]::TEXT[]),

  ('i9',
   'I-9 Employment Eligibility',
   'Federal I-9 form — both employee and employer sections.',
   'I-9 Employment Eligibility Verification (US). Both Section 1 (employee) and Section 2 (employer verification of documents) completed with dates and signatures.',
   ARRAY[]::TEXT[], NULL, 'legal',
   ARRAY['section_1_signed','section_2_signed','dates'],
   ARRAY[]::TEXT[]),

  ('w4',
   'W-4 Withholding',
   'Federal W-4 tax withholding certificate.',
   'Federal W-4 Withholding Certificate. Employee name, SSN (may be redacted), filing status, signature, date.',
   ARRAY[]::TEXT[], NULL, 'legal',
   ARRAY['employee_name','signature','date'],
   ARRAY[]::TEXT[]),

  ('diploma',
   'Diploma / Transcript',
   'Educational diploma or official transcript.',
   'Educational diploma or transcript. Institution name, graduation date, degree conferred, candidate name.',
   ARRAY[]::TEXT[], NULL, 'training',
   ARRAY['institution','degree','graduation_date','candidate_name'],
   ARRAY[]::TEXT[])
ON CONFLICT (key) DO NOTHING;

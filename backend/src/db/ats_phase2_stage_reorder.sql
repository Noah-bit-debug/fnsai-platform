-- ATS Phase 2 — Pipeline stage reorder (Interview before Application).
--
-- Per FNS AI workflow preference: a pre-submission interview / phone
-- screen happens BEFORE the candidate is formally "applied" to a job.
-- So Interview should be the leftmost Kanban column, followed by
-- New Lead (the "Application" stage equivalent in the new taxonomy).
--
-- Idempotent by design — uses UPDATE on a UNIQUE key combination
-- rather than INSERT, so re-running this migration on a DB where
-- sort_order is already correct is a no-op.

-- Swap: interview to sort_order 1, push everyone else down one to make room.
-- We use a two-step pattern to avoid UNIQUE (tenant_id, key) + sort_order
-- collision if there was a constraint (there isn't today, but defensive).
UPDATE pipeline_stages SET sort_order = sort_order + 100
  WHERE tenant_id = 'default' AND key IN (
    'new_lead','screening','internal_review','submitted','client_submitted',
    'interview','offer','confirmed','placed','not_joined','rejected','withdrawn'
  );

UPDATE pipeline_stages SET sort_order = 1  WHERE tenant_id = 'default' AND key = 'interview';
UPDATE pipeline_stages SET sort_order = 2  WHERE tenant_id = 'default' AND key = 'new_lead';
UPDATE pipeline_stages SET sort_order = 3  WHERE tenant_id = 'default' AND key = 'screening';
UPDATE pipeline_stages SET sort_order = 4  WHERE tenant_id = 'default' AND key = 'internal_review';
UPDATE pipeline_stages SET sort_order = 5  WHERE tenant_id = 'default' AND key = 'submitted';
UPDATE pipeline_stages SET sort_order = 6  WHERE tenant_id = 'default' AND key = 'client_submitted';
UPDATE pipeline_stages SET sort_order = 7  WHERE tenant_id = 'default' AND key = 'offer';
UPDATE pipeline_stages SET sort_order = 8  WHERE tenant_id = 'default' AND key = 'confirmed';
UPDATE pipeline_stages SET sort_order = 9  WHERE tenant_id = 'default' AND key = 'placed';
UPDATE pipeline_stages SET sort_order = 10 WHERE tenant_id = 'default' AND key = 'not_joined';
UPDATE pipeline_stages SET sort_order = 11 WHERE tenant_id = 'default' AND key = 'rejected';
UPDATE pipeline_stages SET sort_order = 12 WHERE tenant_id = 'default' AND key = 'withdrawn';

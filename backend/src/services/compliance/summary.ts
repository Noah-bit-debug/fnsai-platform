/**
 * Build a unified compliance summary from BOTH competency records (training,
 * signed acknowledgments, etc.) and required documents (RN license, BLS card,
 * CNA cert, drug screen, etc.). Earlier versions counted competency records
 * only — so a manually-uploaded-and-approved license never appeared in the
 * dashboard, leaving "Total Assigned: 0" even after the candidate was fully
 * credentialed. The two systems are complementary: training is a competency,
 * a license is a document, and both count toward "is this person compliant".
 */

export interface CompetencyRecordLike {
  status: string;
}

export interface RequiredDocLike {
  status: string;
  required?: boolean;
}

export interface ComplianceSummary {
  total: number;
  completed: number;
  pending: number;
  expired: number;
  failed: number;
  completion_rate: number;
}

export function buildComplianceSummary(
  records: CompetencyRecordLike[],
  documents: RequiredDocLike[] = [],
): ComplianceSummary {
  const recordCompleted = records.filter((r) => ['completed', 'signed', 'read'].includes(r.status)).length;
  const recordPending   = records.filter((r) => ['not_started', 'in_progress', 'pending'].includes(r.status)).length;
  const recordExpired   = records.filter((r) => r.status === 'expired').length;
  const recordFailed    = records.filter((r) => r.status === 'failed').length;

  // Optional / nice-to-have docs (required=false) do not count toward
  // compliance metrics. `required === undefined` defaults to required=true
  // because that's the candidate_documents schema default.
  const required = documents.filter((d) => d.required !== false);
  const docCompleted = required.filter((d) => d.status === 'approved').length;
  const docPending   = required.filter((d) => ['missing', 'pending', 'received'].includes(d.status)).length;
  const docExpired   = required.filter((d) => d.status === 'expired').length;
  const docFailed    = required.filter((d) => d.status === 'rejected').length;

  const total     = records.length + required.length;
  const completed = recordCompleted + docCompleted;
  const pending   = recordPending + docPending;
  const expired   = recordExpired + docExpired;
  const failed    = recordFailed + docFailed;
  const completion_rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, pending, expired, failed, completion_rate };
}

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Skill {
  id: string;
  skill_name: string;
  description: string | null;
  exclude_from_score: boolean;
  sort_order: number;
}

interface Section {
  id: string;
  title: string;
  sort_order: number;
  skills: Skill[];
}

interface Checklist {
  id: string;
  title: string;
  description: string | null;
  mode: 'skills' | 'questionnaire';
}

interface ExistingSubmission {
  id: string;
  overall_score: number | null;
  submitted_at: string;
  ratings: Array<{ skill_id: string; rating: number; notes: string | null }>;
}

const RATING_LABELS: Record<number, string> = {
  1: 'Not Demonstrated',
  2: 'Needs Improvement',
  3: 'Competent',
  4: 'Expert / Proficient',
};

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CompleteChecklist() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  const [existingSubmission, setExistingSubmission] = useState<ExistingSubmission | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitScore, setSubmitScore] = useState<number | null>(null);

  // ─── Load data ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [clRes, subRes] = await Promise.all([
        api.get(`/compliance/checklists/${id}`),
        api.get(`/compliance/checklists/${id}/my-submission`).catch(() => null),
      ]);

      const cl = clRes.data?.checklist ?? clRes.data;
      const secs: Section[] = clRes.data?.sections ?? [];
      setChecklist(cl);
      setSections(secs);

      if (subRes && subRes.data?.submission) {
        const sub = subRes.data.submission;
        const ratingsArr: Array<{ skill_id: string; rating: number; notes: string | null }> =
          subRes.data.ratings ?? sub.ratings ?? [];
        const rMap: Record<string, number> = {};
        const nMap: Record<string, string> = {};
        ratingsArr.forEach((r) => {
          rMap[r.skill_id] = r.rating;
          if (r.notes) nMap[r.skill_id] = r.notes;
        });
        setRatings(rMap);
        setNotes(nMap);
        setExistingSubmission({
          id: sub.id,
          overall_score: sub.overall_score ?? null,
          submitted_at: sub.submitted_at ?? sub.created_at,
          ratings: ratingsArr,
        });
      }
    } catch {
      setError('Failed to load checklist. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const allSkills: Skill[] = sections.flatMap((s) => s.skills);
  const scoreableSkills = allSkills.filter((sk) => !sk.exclude_from_score);
  const ratedScoreable = scoreableSkills.filter((sk) => ratings[sk.id] !== undefined);
  const allScoreableRated = scoreableSkills.length > 0 && ratedScoreable.length === scoreableSkills.length;
  const unratedCount = scoreableSkills.length - ratedScoreable.length;

  // ─── Handlers ────────────────────────────────────────────────────────────────

  function setRating(skillId: string, rating: number) {
    setRatings((prev) => ({ ...prev, [skillId]: rating }));
  }

  function setNote(skillId: string, value: string) {
    setNotes((prev) => ({ ...prev, [skillId]: value }));
  }

  function toggleNote(skillId: string) {
    setExpandedNotes((prev) => ({ ...prev, [skillId]: !prev[skillId] }));
  }

  async function handleSubmit() {
    if (!id || !allScoreableRated) return;

    const ratingsPayload = allSkills.map((sk) => ({
      skill_id: sk.id,
      rating: ratings[sk.id] ?? 0,
      notes: notes[sk.id] ?? '',
    })).filter((r) => r.rating > 0);

    setSubmitting(true);
    setError('');
    try {
      const res = await api.post(`/compliance/checklists/${id}/submit`, {
        ratings: ratingsPayload,
      });
      setSubmitScore(res.data?.overall_score ?? null);
      setSubmitted(true);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to submit checklist.');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#64748b', fontSize: 16 }}>Loading checklist...</div>
      </div>
    );
  }

  // ─── Success state ────────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '48px 24px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', margin: '0 0 12px 0' }}>Checklist Submitted!</h1>
          {submitScore !== null && (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '16px 24px', color: '#15803d', fontSize: 16, fontWeight: 600, marginBottom: 24 }}>
              Your Score: {submitScore}%
            </div>
          )}
          <button
            onClick={() => navigate('/compliance/my')}
            style={{ padding: '13px 32px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}
          >
            Back to My Compliance
          </button>
        </div>
      </div>
    );
  }

  const isReadOnly = !!existingSubmission;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '32px 24px' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* Back */}
        <Link
          to="/compliance/my"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#2563eb', textDecoration: 'none', fontSize: 14, marginBottom: 24 }}
        >
          ← My Compliance
        </Link>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: '0 0 8px 0' }}>
            {checklist?.title ?? 'Checklist'}
          </h1>
          {checklist?.description && (
            <p style={{ color: '#475569', fontSize: 15, margin: 0, lineHeight: 1.6 }}>{checklist.description}</p>
          )}
        </div>

        {/* Already submitted banner */}
        {existingSubmission && (
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '14px 20px', marginBottom: 24, color: '#15803d', fontSize: 14 }}>
            <strong>Submitted on {formatDate(existingSubmission.submitted_at)}</strong>
            {existingSubmission.overall_score !== null && (
              <span> — Score: {existingSubmission.overall_score}%</span>
            )}
          </div>
        )}

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', color: '#dc2626', marginBottom: 20, fontSize: 14 }}>
            {error}
          </div>
        )}

        {/* Progress indicator */}
        {!isReadOnly && scoreableSkills.length > 0 && (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: '#475569', fontSize: 14 }}>Skills rated</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 120, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${scoreableSkills.length > 0 ? Math.round((ratedScoreable.length / scoreableSkills.length) * 100) : 0}%`,
                  height: '100%',
                  background: '#2563eb',
                  borderRadius: 4,
                  transition: 'width 0.2s',
                }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>
                {ratedScoreable.length} of {scoreableSkills.length}
              </span>
            </div>
          </div>
        )}

        {/* Sections */}
        {sections.map((section) => (
          <div
            key={section.id}
            style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, marginBottom: 20, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
          >
            {/* Section header */}
            <div style={{ background: '#2563eb', padding: '14px 20px' }}>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 16, fontWeight: 600 }}>{section.title}</h3>
            </div>

            {/* Skills */}
            <div style={{ padding: '4px 0' }}>
              {section.skills.map((skill, skillIdx) => {
                const currentRating = ratings[skill.id];
                const noteExpanded = expandedNotes[skill.id];
                const noteValue = notes[skill.id] ?? '';
                const isLast = skillIdx === section.skills.length - 1;

                return (
                  <div
                    key={skill.id}
                    style={{
                      padding: '18px 20px',
                      borderBottom: isLast ? 'none' : '1px solid #f1f5f9',
                    }}
                  >
                    {/* Skill name + badges */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 14 }}>{skill.skill_name}</span>
                          {skill.exclude_from_score && (
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#f1f5f9', color: '#64748b', fontWeight: 500 }}>
                              Not scored
                            </span>
                          )}
                        </div>
                        {skill.description && (
                          <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: 13, lineHeight: 1.5 }}>{skill.description}</p>
                        )}
                      </div>
                    </div>

                    {/* Rating buttons */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      {[1, 2, 3, 4].map((rating) => {
                        const isSelected = currentRating === rating;
                        return (
                          <button
                            key={rating}
                            onClick={() => !isReadOnly && setRating(skill.id, rating)}
                            disabled={isReadOnly}
                            style={{
                              padding: '8px 14px',
                              borderRadius: 6,
                              border: isSelected ? '2px solid #2563eb' : '2px solid #e2e8f0',
                              background: isSelected ? '#2563eb' : '#fff',
                              color: isSelected ? '#fff' : '#475569',
                              fontSize: 13,
                              fontWeight: isSelected ? 600 : 400,
                              cursor: isReadOnly ? 'default' : 'pointer',
                              transition: 'all 0.15s',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {rating} {RATING_LABELS[rating]}
                          </button>
                        );
                      })}
                    </div>

                    {/* Notes */}
                    {!isReadOnly && (
                      <div>
                        {!noteExpanded ? (
                          <button
                            onClick={() => toggleNote(skill.id)}
                            style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 13, cursor: 'pointer', padding: 0 }}
                          >
                            + Add note
                          </button>
                        ) : (
                          <div>
                            <textarea
                              value={noteValue}
                              onChange={(e) => setNote(skill.id, e.target.value)}
                              placeholder="Optional notes..."
                              rows={2}
                              style={{
                                width: '100%',
                                padding: '8px 12px',
                                border: '1px solid #e2e8f0',
                                borderRadius: 6,
                                fontSize: 13,
                                color: '#374151',
                                resize: 'vertical',
                                fontFamily: 'inherit',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Read-only notes */}
                    {isReadOnly && noteValue && (
                      <div style={{ marginTop: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#475569' }}>
                        <em>Note:</em> {noteValue}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Submit button */}
        {!isReadOnly && (
          <div style={{ position: 'sticky', bottom: 0, background: '#f8fafc', borderTop: '1px solid #e2e8f0', padding: '16px 0', marginTop: 8 }}>
            {unratedCount > 0 && (
              <div style={{ color: '#f59e0b', fontSize: 14, marginBottom: 10, fontWeight: 500 }}>
                {unratedCount} skill{unratedCount > 1 ? 's' : ''} still need{unratedCount === 1 ? 's' : ''} a rating before submitting.
              </div>
            )}
            <button
              onClick={handleSubmit}
              disabled={!allScoreableRated || submitting}
              style={{
                width: '100%',
                padding: '14px 24px',
                borderRadius: 8,
                border: 'none',
                background: allScoreableRated && !submitting ? '#2563eb' : '#cbd5e1',
                color: '#fff',
                fontSize: 16,
                fontWeight: 600,
                cursor: allScoreableRated && !submitting ? 'pointer' : 'not-allowed',
                transition: 'background 0.15s',
              }}
            >
              {submitting ? 'Submitting...' : 'Submit Checklist'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

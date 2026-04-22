import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { compCoursesApi, type CompCourse } from '../../lib/api';
import { useToast } from '../../components/ToastHost';
import { extractApiError } from '../../lib/apiErrors';

export default function CourseList() {
  const nav = useNavigate();
  const toast = useToast();
  const [courses, setCourses] = useState<CompCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    void compCoursesApi.list(statusFilter ? { status: statusFilter } : undefined)
      .then((r) => { setCourses(r.data.courses); setLoading(false); })
      .catch((e) => { toast.error(extractApiError(e, 'Failed to load courses')); setLoading(false); });
  }, [statusFilter, toast]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>Training Courses</h1>
          <p style={{ fontSize: 13, color: 'var(--t3)', marginTop: 4 }}>
            Create training modules with markdown content, optional videos, and attestation or quiz-based completion.
            Add them to bundles alongside policies, documents, and exams.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, background: 'var(--sf)' }}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
          <button onClick={() => nav('/compliance/courses/new/edit')}
            style={{ padding: '8px 16px', background: 'var(--pr)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + New Course
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading…</div>
      ) : courses.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)', background: 'var(--sf)', borderRadius: 'var(--br)', border: '1px dashed var(--bd)' }}>
          No courses yet. Click "+ New Course" to create one.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {courses.map((c) => (
            <div key={c.id} onClick={() => nav(`/compliance/courses/${c.id}/edit`)}
              style={{ padding: 14, background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', cursor: 'pointer', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>{c.title}</div>
                {c.description && <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{c.description.slice(0, 160)}</div>}
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {c.estimated_minutes != null && <span>⏱ {c.estimated_minutes} min</span>}
                  {c.video_url && <span>🎥 video</span>}
                  {c.quiz_exam_id && <span>📝 quiz</span>}
                  {c.require_attestation && <span>✍ attestation</span>}
                  {c.applicable_roles.length > 0 && <span>🎭 {c.applicable_roles.join(', ')}</span>}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                {c.completions_count ?? 0} completions
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                background: c.status === 'published' ? '#d1fae5' : c.status === 'archived' ? '#f1f5f9' : '#fef3c7',
                color: c.status === 'published' ? '#065f46' : c.status === 'archived' ? '#64748b' : '#92400e',
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}>{c.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

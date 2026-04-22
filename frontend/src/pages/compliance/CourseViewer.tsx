import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { compCoursesApi, type CompCourse, type CourseCompletion } from '../../lib/api';
import { useToast } from '../../components/ToastHost';
import { extractApiError } from '../../lib/apiErrors';
import { renderMarkdown } from '../../lib/markdown';

/**
 * Phase 2.6 — Course viewer (staff).
 *
 * Staff's view when taking a course. Renders the markdown content, plays
 * the optional video, tracks time-on-page as duration_seconds, and
 * handles the completion flow:
 *   1. POST /start on mount (idempotent — reuses any existing progress)
 *   2. User reads content + watches video
 *   3. If course has require_attestation — checkbox + typed name
 *   4. If course has quiz_exam_id — redirect to /exam/:id to take it
 *      then come back; completion captures quiz_score via route state
 *   5. POST /complete with attestation + duration
 */
export default function CourseViewer() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const toast = useToast();

  const [course, setCourse] = useState<CompCourse | null>(null);
  const [progress, setProgress] = useState<CourseCompletion | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [attested, setAttested] = useState(false);

  // Simple time tracker
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const [cRes, pRes] = await Promise.all([
          compCoursesApi.get(id),
          compCoursesApi.myProgress(id).catch(() => ({ data: { completion: null } })),
        ]);
        setCourse(cRes.data.course);
        setProgress(pRes.data.completion);
        setAttested(!!pRes.data.completion?.attestation_signed);
        setSignerName(pRes.data.completion?.attestation_signer_name ?? '');

        // Mark as started if not already
        if (!pRes.data.completion?.started_at) {
          void compCoursesApi.start(id);
        }
      } catch (e) {
        toast.error(extractApiError(e, 'Failed to load course'));
      } finally {
        setLoading(false);
      }
    })();
    startRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const markComplete = async () => {
    if (!id || !course) return;
    if (course.require_attestation && (!attested || !signerName.trim())) {
      toast.error('Please type your full name and check the attestation box');
      return;
    }
    setSubmitting(true);
    try {
      const durationSec = Math.round((Date.now() - startRef.current) / 1000)
        + (progress?.duration_seconds ?? 0);
      const res = await compCoursesApi.complete(id, {
        duration_seconds: durationSec,
        attestation_signed: attested,
        signer_name: signerName.trim() || undefined,
      });
      setProgress(res.data.completion);
      toast.success(course.quiz_exam_id ? 'Attestation saved — now take the quiz' : 'Course completed!');
      if (course.quiz_exam_id) {
        nav(`/compliance/exam/${course.quiz_exam_id}`);
      }
    } catch (e) {
      toast.error(extractApiError(e, 'Failed to mark complete'));
    } finally { setSubmitting(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading course…</div>;
  if (!course) return <div style={{ padding: 40, color: 'var(--t3)' }}>Course not found.</div>;

  const isComplete = !!progress?.completed_at;
  const videoEmbedUrl = course.video_url ? toEmbedUrl(course.video_url) : null;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 860, margin: '0 auto' }}>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>
        <Link to="/my-compliance" style={{ color: 'var(--t3)', textDecoration: 'none' }}>My Compliance</Link> ›{' '}
        <span style={{ color: 'var(--t2)' }}>{course.title}</span>
      </div>

      <h1 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 700, color: 'var(--t1)' }}>{course.title}</h1>
      {course.description && <p style={{ fontSize: 14, color: 'var(--t3)', marginBottom: 16 }}>{course.description}</p>}

      {isComplete && (
        <div style={{ padding: 12, background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 8, marginBottom: 16, color: '#065f46', fontSize: 13 }}>
          ✓ You completed this course on {new Date(progress!.completed_at!).toLocaleDateString()}.
          {progress?.passed === false && ' Quiz not passed — please retake.'}
        </div>
      )}

      {course.estimated_minutes != null && (
        <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>⏱ ~{course.estimated_minutes} min</div>
      )}

      {videoEmbedUrl && (
        <div style={{ marginBottom: 20, aspectRatio: '16/9', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
          <iframe src={videoEmbedUrl} title="Course video"
            style={{ width: '100%', height: '100%', border: 'none' }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen />
        </div>
      )}

      {course.content_markdown && (
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 24, marginBottom: 20 }}>
          <div className="ai-bubble-assistant"
            style={{ color: 'var(--t1)', fontSize: 14, lineHeight: 1.7 }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(course.content_markdown) }} />
        </div>
      )}

      {/* Completion section */}
      {!isComplete && (
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 20 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--t1)' }}>Complete the course</h2>

          {course.require_attestation && (
            <>
              <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 10 }}>
                By checking the box below and typing your full name, you attest that you have read and understood the content above.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t2)', marginBottom: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                I have read and understood this course
              </label>
              <input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Type your full legal name"
                style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 14, outline: 'none', marginBottom: 14 }}
              />
            </>
          )}

          <button
            onClick={() => void markComplete()}
            disabled={submitting || (course.require_attestation && (!attested || !signerName.trim()))}
            style={{
              padding: '10px 20px', background: 'var(--pr)', color: '#fff', border: 'none', borderRadius: 6,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? 'Saving…' : course.quiz_exam_id ? 'Save attestation & take quiz →' : 'Mark complete'}
          </button>
        </div>
      )}
    </div>
  );
}

// Turn YouTube / Vimeo URLs into embed URLs. Anything else gets used as-is.
function toEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    // youtube.com/watch?v=ID  or  youtu.be/ID
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (u.hostname === 'youtu.be') {
      const v = u.pathname.replace(/^\//, '');
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (u.hostname.includes('vimeo.com')) {
      const v = u.pathname.replace(/^\//, '');
      if (v) return `https://player.vimeo.com/video/${v}`;
    }
    // Anything else — assume it's a direct embed URL
    return url;
  } catch { return null; }
}

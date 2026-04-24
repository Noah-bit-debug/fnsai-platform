/**
 * First-time user onboarding walkthrough.
 *
 * Shows a sequence of 5 steps as a dismissable modal overlay on the
 * FIRST sign-in. Users can skip at any point. Once dismissed or
 * completed, never shown again (localStorage flag per user).
 *
 * Steps:
 *   1. Welcome — who we are, what to expect
 *   2. Your role + permissions — Link to My Permissions
 *   3. Sidebar tour — key sections pointed out
 *   4. AI Chat intro
 *   5. Help Center promo
 *
 * Rendered from AppShell so it floats over any route. Doesn't block
 * navigation — user can click outside or hit ESC to dismiss.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../lib/auth';

const STORAGE_KEY_PREFIX = 'fns_onboarding_completed_v1_';

interface Step {
  title: string;
  icon: string;
  body: React.ReactNode;
  ctaLabel?: string;
  ctaNav?: string;
}

export default function OnboardingWalkthrough() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  // Show only once per user. Key by user id so each user has their own flag.
  useEffect(() => {
    if (!user?.id) return;
    const key = STORAGE_KEY_PREFIX + user.id;
    const done = localStorage.getItem(key);
    if (!done) {
      // Small delay so the dashboard renders first, then the walkthrough
      // appears on top — feels more like a welcome than a blocker.
      const t = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(t);
    }
  }, [user?.id]);

  const dismiss = () => {
    if (user?.id) {
      localStorage.setItem(STORAGE_KEY_PREFIX + user.id, String(Date.now()));
    }
    setVisible(false);
  };

  const steps: Step[] = [
    {
      title: `Welcome, ${user?.firstName ?? 'there'}!`,
      icon: '👋',
      body: (
        <>
          <p style={p}>FNS AI is your healthcare staffing workspace — candidates, compliance, time tracking, AI assistance all in one place.</p>
          <p style={p}>This 60-second tour points out the essentials. Feel free to skip anytime.</p>
        </>
      ),
    },
    {
      title: 'Your role controls what you see',
      icon: '🔑',
      body: (
        <>
          <p style={p}>Different roles (Recruiter, HR, Admin, CEO, etc.) see different parts of the app. If a section isn\'t visible, your role doesn\'t have permission for it.</p>
          <p style={p}>You can see exactly what you have access to — and request more if needed.</p>
        </>
      ),
      ctaLabel: 'See my permissions',
      ctaNav: '/settings/my-permissions',
    },
    {
      title: 'The sidebar is your map',
      icon: '🧭',
      body: (
        <>
          <p style={p}>Grouped by workflow area:</p>
          <ul style={{ ...p, paddingLeft: 20, margin: '8px 0' }}>
            <li><strong>Recruiting</strong> — Candidates, Jobs, Pipeline, Tasks</li>
            <li><strong>Credentialing + Onboarding</strong> — License verification, paperwork</li>
            <li><strong>Workforce</strong> — Staff, placements, scheduling</li>
            <li><strong>Intelligence</strong> — Reports, summaries, action plans</li>
            <li><strong>Tools</strong> — AI Chat, templates, approvals</li>
          </ul>
          <p style={p}>Click a group to expand or collapse it.</p>
        </>
      ),
    },
    {
      title: 'AI Chat can save you hours',
      icon: '🤖',
      body: (
        <>
          <p style={p}>Ask questions about your data, draft emails, summarize meetings, create tasks — all in plain English.</p>
          <p style={p}>AI respects your permissions: it won\'t reveal data your role can\'t see.</p>
        </>
      ),
      ctaLabel: 'Try AI Chat',
      ctaNav: '/ai-assistant',
    },
    {
      title: 'Help is always a click away',
      icon: '❓',
      body: (
        <>
          <p style={p}>The Help Center has 177 articles covering every feature in depth. Step-by-step guides, troubleshooting, tips.</p>
          <p style={p}>If you get stuck, start there — or ask AI Chat, it can answer from the Help Center too.</p>
        </>
      ),
      ctaLabel: 'Browse Help Center',
      ctaNav: '/help',
    },
  ];

  const current = steps[step];
  const isLast = step === steps.length - 1;

  // ESC key dismisses
  useEffect(() => {
    if (!visible) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000, padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div
        style={{
          background: '#fff', borderRadius: 14, padding: 0,
          maxWidth: 520, width: '100%', maxHeight: '90vh', overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        {/* Gradient header */}
        <div style={{
          background: 'linear-gradient(135deg, #6d28d9, #8b5cf6)',
          padding: '28px 28px 24px',
          color: '#fff',
          position: 'relative',
        }}>
          <button
            onClick={dismiss}
            style={{
              position: 'absolute', top: 12, right: 12,
              background: 'rgba(255,255,255,0.15)', border: 'none',
              color: '#fff', width: 28, height: 28, borderRadius: 14,
              cursor: 'pointer', fontSize: 16, lineHeight: 1,
            }}
            title="Skip the tour"
          >×</button>
          <div style={{ fontSize: 36, marginBottom: 10 }}>{current.icon}</div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{current.title}</h2>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 28px' }}>
          {current.body}
        </div>

        {/* Step dots + footer */}
        <div style={{ padding: '0 28px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {steps.map((_, i) => (
              <div
                key={i}
                style={{
                  width: i === step ? 20 : 6, height: 6, borderRadius: 3,
                  background: i <= step ? '#6d28d9' : '#e2e8f0',
                  transition: 'all 0.2s',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {current.ctaLabel && current.ctaNav && (
              <button
                onClick={() => {
                  if (current.ctaNav) navigate(current.ctaNav);
                  dismiss();
                }}
                style={{
                  padding: '8px 16px', background: '#f5f3ff', color: '#6d28d9',
                  border: '1px solid #ddd6fe', borderRadius: 8,
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {current.ctaLabel}
              </button>
            )}
            <button
              onClick={() => isLast ? dismiss() : setStep(s => s + 1)}
              style={{
                padding: '8px 18px', background: '#6d28d9', color: '#fff',
                border: 'none', borderRadius: 8,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {isLast ? 'Get started' : 'Next →'}
            </button>
          </div>
        </div>

        {/* Skip footer */}
        {!isLast && (
          <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 28px', textAlign: 'center' }}>
            <button
              onClick={dismiss}
              style={{
                background: 'none', border: 'none', color: '#94a3b8',
                fontSize: 12, cursor: 'pointer',
              }}
            >
              Skip the tour
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const p: React.CSSProperties = { margin: '0 0 12px', fontSize: 14, lineHeight: 1.6, color: '#334155' };

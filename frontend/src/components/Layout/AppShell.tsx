import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import TopBar from './Topbar';
import Sidebar from './Sidebar';
import AIAssistantSidebar from '../AIAssistantSidebar';
import TextingPanel from '../TextingPanel';
import RootErrorBoundary from '../RootErrorBoundary';
import ViewAsRoleBanner from '../admin/ViewAsRoleBanner';
import OnboardingWalkthrough from '../Onboarding/OnboardingWalkthrough';
import CommandPalette from '../CommandPalette';
import { SkipToMain } from '../States';

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handler = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(false);
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Close sidebar when navigating on mobile
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [window.location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app-shell">
      {/* Keyboard accessibility — first focusable element, hidden until tabbed */}
      <SkipToMain />

      {/* Phase 8 — yellow banner when admin is simulating another role */}
      <ViewAsRoleBanner />

      {/* First-time user welcome tour. Dismissable, only shows once per user. */}
      <OnboardingWalkthrough />

      {/* Cmd/Ctrl+K command palette — works everywhere, permission-aware. */}
      <CommandPalette />

      <TopBar onMenuClick={() => setSidebarOpen(v => !v)} showMenuButton={isMobile} />

      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 199,
          }}
        />
      )}

      <Sidebar
        isOpen={!isMobile || sidebarOpen}
        isMobile={isMobile}
        onClose={() => setSidebarOpen(false)}
      />

      <main
        id="main-content"
        className="main-content"
        style={isMobile ? { marginLeft: 0, paddingTop: 60 } : undefined}
      >
        {/* Phase 1 QA fix — wrap the routed page in an error boundary so a
            crash in one page (e.g. Reminders) doesn't blank the sidebar +
            topbar + whole shell. User can still navigate. */}
        <RootErrorBoundary>
          <Outlet />
        </RootErrorBoundary>
      </main>

      {/* Global AI Brain sidebar — mounts once, available on every page,
          auto-detects the route's entity (candidate/job/client/etc.) */}
      <AIAssistantSidebar />

      {/* Phase 1.1C — Global texting panel. Floating 💬 button bottom-right,
          below the AI button. Opens a slide-out panel with candidate
          picker + message box. Can also be opened programmatically from
          any page via window.dispatchEvent(new CustomEvent('open-texting-panel', { detail: { candidateId } })) */}
      <TextingPanel />
    </div>
  );
}

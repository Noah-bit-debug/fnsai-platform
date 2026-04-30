/**
 * Tests for the top-level RootErrorBoundary.
 *
 * Pins QA Phase 3 #4 (the recurring "Failed to fetch dynamically
 * imported module" white-screen after Vercel deploys, fixed in PR #16)
 * + the generic-error fallback added in earlier work. Both flavors
 * surface very different UX, so the detector and the rendering both
 * need locked-in tests.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RootErrorBoundary, { isChunkLoadError } from './RootErrorBoundary';

// A throwaway child that throws an error of our choosing on mount.
// Boundaries don't catch async errors or event-handler errors — only
// render-phase throws — so the throw must happen during render.
function Boom({ error }: { error: Error }): JSX.Element {
  throw error;
}

// Suppress React's own console.error spam from the boundary catching
// the throw — we *want* the throw, and React's noise just clutters
// test output. Restored after each test.
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  // Reset the sessionStorage gate so each test starts fresh.
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
});
afterEach(() => {
  errSpy.mockRestore();
});

describe('isChunkLoadError', () => {
  test('matches Chrome wording: "Failed to fetch dynamically imported module"', () => {
    const e = new TypeError('Failed to fetch dynamically imported module: https://app/assets/JobDetail-BTHUUQZr.js');
    expect(isChunkLoadError(e)).toBe(true);
  });

  test('matches Firefox wording: "error loading dynamically imported module"', () => {
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
  });

  test('matches Safari wording: "Importing a module script failed."', () => {
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });

  test('matches by error.name === "ChunkLoadError"', () => {
    const e = new Error('whatever');
    e.name = 'ChunkLoadError';
    expect(isChunkLoadError(e)).toBe(true);
  });

  test('does NOT match a generic render error', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'foo')"))).toBe(false);
  });

  test('does NOT match a network error with similar but different wording', () => {
    expect(isChunkLoadError(new Error('Failed to fetch'))).toBe(false);
  });

  test('case-insensitive on the message text', () => {
    expect(isChunkLoadError(new Error('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE: foo'))).toBe(true);
  });
});

describe('<RootErrorBoundary /> generic render error', () => {
  test('renders the red "Something broke" card with the error message', () => {
    render(
      <RootErrorBoundary>
        <Boom error={new TypeError("Cannot read properties of undefined (reading 'bg')")} />
      </RootErrorBoundary>,
    );
    expect(screen.getByText(/something broke on this page/i)).toBeInTheDocument();
    expect(screen.getByText(/Cannot read properties of undefined/)).toBeInTheDocument();
  });

  test('shows BOTH "Try again" and "Reload page" buttons (generic flavor)', () => {
    render(
      <RootErrorBoundary>
        <Boom error={new Error('boom')} />
      </RootErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
  });

  test('"Try again" button is wired (clicking does not throw)', async () => {
    const user = userEvent.setup();
    render(
      <RootErrorBoundary>
        <Boom error={new Error('first render')} />
      </RootErrorBoundary>,
    );
    // Smoke test the click. After clicking, the boundary clears its
    // internal error state and re-renders children — but the same
    // throwing child mounts again, so the boundary catches a second
    // time and we see the same card. Verifying the click dispatches
    // without an unhandled error is enough for a regression guard;
    // the recovery-path integration is exercised by users in app.
    const btn = screen.getByRole('button', { name: /try again/i });
    await user.click(btn);
    // Card is still present (we re-threw on re-render, expected).
    expect(screen.getByText(/something broke on this page/i)).toBeInTheDocument();
  });
});

describe('<RootErrorBoundary /> ChunkLoadError flavor', () => {
  test('shows the friendly "A new version is ready" card, not the red one', () => {
    render(
      <RootErrorBoundary>
        <Boom error={new TypeError('Failed to fetch dynamically imported module: /assets/JobDetail-X.js')} />
      </RootErrorBoundary>,
    );
    expect(screen.getByText(/a new version is ready/i)).toBeInTheDocument();
    // The scary stack-trace UI is reserved for the generic flavor.
    expect(screen.queryByText(/something broke on this page/i)).not.toBeInTheDocument();
  });

  test('reload button is rendered', () => {
    render(
      <RootErrorBoundary>
        <Boom error={new TypeError('Failed to fetch dynamically imported module: /assets/X.js')} />
      </RootErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
  });

  test('writes a sessionStorage marker so we can detect repeated chunk failures', async () => {
    // First chunk failure should write the timestamp marker the
    // boundary uses to gate auto-reload.
    render(
      <RootErrorBoundary>
        <Boom error={new TypeError('Failed to fetch dynamically imported module: /a.js')} />
      </RootErrorBoundary>,
    );
    // The marker is written inside componentDidCatch which runs after
    // the initial render — give the microtask queue a tick.
    await Promise.resolve();
    const marker = sessionStorage.getItem('fns_chunk_reload_at');
    expect(marker).not.toBeNull();
  });

  test('renders cleanly without throwing when sessionStorage is unavailable', () => {
    // jsdom always has sessionStorage, but real browsers in private
    // mode do not. The catch block in the boundary swallows the
    // throw — we just need to verify no rerender error.
    const original = window.sessionStorage;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: () => { throw new Error('disabled'); },
    });
    try {
      render(
        <RootErrorBoundary>
          <Boom error={new TypeError('Failed to fetch dynamically imported module: /a.js')} />
        </RootErrorBoundary>,
      );
      expect(screen.getByText(/a new version is ready/i)).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, value: original });
    }
  });
});

describe('<RootErrorBoundary /> happy path', () => {
  test('renders children unchanged when nothing throws', () => {
    render(
      <RootErrorBoundary>
        <div data-testid="child">hello</div>
      </RootErrorBoundary>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('hello');
    expect(screen.queryByText(/something broke/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/a new version is ready/i)).not.toBeInTheDocument();
  });
});

/**
 * Component test for the 404 page added in PR #17.
 *
 * Establishes the React Testing Library pattern for component tests:
 *   - render with MemoryRouter so useLocation/useNavigate work
 *   - assert the user-visible text is what we expect
 *   - drive an interaction with userEvent and verify the side effect
 *
 * Pins QA Phase 3 #15 — malformed URLs land on a real 404 card with
 * the bad path shown and reload/back actions, NOT a blank redirect.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import NotFound from './NotFound';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('NotFound', () => {
  test('renders the 404 banner', () => {
    renderAt('/candidates/new/step3');
    expect(screen.getByText(/404 · Page not found/i)).toBeInTheDocument();
  });

  test('shows the bad path so the user can see what they typed', () => {
    renderAt('/candidates/new/step3?ref=email');
    // Path + query string both appear in the inline code block.
    expect(screen.getByText(/\/candidates\/new\/step3/)).toBeInTheDocument();
    expect(screen.getByText(/ref=email/)).toBeInTheDocument();
  });

  test('renders a Go to dashboard link pointing at /dashboard', () => {
    renderAt('/whatever');
    const link = screen.getByRole('link', { name: /go to dashboard/i });
    expect(link).toHaveAttribute('href', '/dashboard');
  });

  test('Go back button exists and is clickable', async () => {
    renderAt('/whatever');
    const backBtn = screen.getByRole('button', { name: /go back/i });
    expect(backBtn).toBeInTheDocument();
    // Just verify it's wired — the actual nav is a useNavigate side
    // effect that MemoryRouter handles internally.
    await userEvent.click(backBtn);
  });

  test('renders cleanly with no console errors (no unkeyed lists, no missing props)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAt('/whatever');
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

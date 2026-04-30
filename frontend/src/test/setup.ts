/**
 * Vitest setup — runs once before any test file.
 *
 * - Pulls in jest-dom matchers (`toBeInTheDocument`, `toHaveTextContent`,
 *   …) so component tests can assert against rendered output without
 *   re-implementing every check.
 * - Mocks `window.matchMedia` since some components query it for
 *   responsive breakpoints; jsdom doesn't ship one, so a bare render
 *   throws.
 * - Cleans the DOM between tests so a previous test's portal/overlay
 *   can't leak into the next.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// jsdom doesn't implement matchMedia. Components that read viewport
// info bail at startup without this stub.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/**
 * Map Anthropic SDK errors to user-readable messages.
 *
 * Anthropic's SDK throws errors with `status` (HTTP code), `error.type`,
 * and `error.message`. The most common failure modes a healthcare-staffing
 * recruiter sees in practice are:
 *
 *   402  — credit balance too low / billing issue
 *   429  — rate limited
 *   401  — bad / missing API key
 *   503  — Anthropic-side outage
 *
 * Without specific handling the route code surfaces "Failed to score
 * submission" / "Failed to suggest actions" — useless to the recruiter
 * and useless to the admin trying to triage. This helper turns those
 * shapes into a concrete, actionable string ("AI service unavailable —
 * Anthropic credits exhausted. Contact your admin to top up.").
 *
 * Returns null for non-Anthropic errors so the caller can fall through
 * to its own error path.
 */
export interface AiErrorTranslation {
  /** HTTP status to return to the frontend. */
  status: number;
  /** User-readable message safe to surface in the UI. */
  message: string;
  /** Internal classification — useful for logs / metrics. */
  code: 'billing' | 'rate_limit' | 'auth' | 'server' | 'unknown';
}

export function translateAnthropicError(err: unknown): AiErrorTranslation | null {
  // The SDK throws plain Errors with extra fields attached. Probe duck-
  // typed rather than instanceof, since multiple SDK versions ship
  // slightly different class hierarchies.
  if (!err || typeof err !== 'object') return null;
  const e = err as { status?: number; message?: string; error?: { type?: string; message?: string } };
  const status = e.status;
  const message = e.error?.message ?? e.message ?? '';

  // Some "credit balance" failures come back as 400 with a specific
  // message rather than 402 — match the message text too.
  const looksLikeBilling =
    status === 402 ||
    /credit balance/i.test(message) ||
    /insufficient.*quota/i.test(message);

  if (looksLikeBilling) {
    return {
      status: 503,
      code: 'billing',
      message: 'AI service is temporarily unavailable — Anthropic credits exhausted. Contact your admin to top up the API balance.',
    };
  }
  if (status === 429) {
    return {
      status: 429,
      code: 'rate_limit',
      message: 'AI service is busy. Please try again in a minute.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 503,
      code: 'auth',
      message: 'AI service authentication failed. The Anthropic API key may be missing or revoked — contact your admin.',
    };
  }
  if (status && status >= 500 && status < 600) {
    return {
      status: 503,
      code: 'server',
      message: 'Anthropic is having trouble right now. Please try again in a moment.',
    };
  }
  if (status === undefined) return null; // not an Anthropic-shaped error
  return {
    status: 502,
    code: 'unknown',
    message: `AI service error (${status}): ${message || 'unknown'}`.slice(0, 240),
  };
}

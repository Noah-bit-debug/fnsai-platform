/**
 * Shared axios-error → user-readable string extractor.
 *
 * Phase 1 QA revealed several failures where the UI showed "Failed to
 * create" or "Invalid input" when the backend had sent a much more
 * useful error. This normalizes the extraction:
 *
 *   1. backend explicit error string              -> use it
 *   2. zod validation details (fieldErrors)        -> "field: message"
 *   3. axios generic message (e.g. timeout)        -> use it
 *   4. "Request failed" catch-all                  -> use the fallback arg
 *
 * Use this in every catch block on a mutation path.
 */
type AxiosLikeError = {
  response?: {
    status?: number;
    data?: {
      error?: string;
      message?: string;
      details?: {
        fieldErrors?: Record<string, string[]>;
        formErrors?: string[];
      };
    };
  };
  message?: string;
  code?: string;
};

export function extractApiError(err: unknown, fallback = 'Request failed'): string {
  const e = err as AxiosLikeError;

  // Axios-timeout specifically — surface as something more actionable
  if (e.code === 'ECONNABORTED') return 'Request timed out. Please retry.';

  // Zod validation details → "field: first message"
  const fieldErrors = e.response?.data?.details?.fieldErrors;
  if (fieldErrors) {
    const firstKey = Object.keys(fieldErrors)[0];
    const firstMsg = firstKey ? fieldErrors[firstKey]?.[0] : undefined;
    if (firstKey && firstMsg) return `${firstKey}: ${firstMsg}`;
  }

  // formErrors array from zod (top-level refines)
  const formErrors = e.response?.data?.details?.formErrors;
  if (formErrors?.length) return formErrors[0];

  // backend explicit error
  if (e.response?.data?.error) return e.response.data.error;
  if (e.response?.data?.message) return e.response.data.message;

  if (e.message) return e.message;
  return fallback;
}

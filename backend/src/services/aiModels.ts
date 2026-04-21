/**
 * Centralized Anthropic model names.
 *
 * Why this exists: model references were scattered across 14+ files using
 * `claude-3-5-sonnet-20241022` (18 months stale, likely deprecated) and
 * `claude-opus-4-6` (doesn't exist — should be -4-5). Every silent Anthropic
 * 404 or 400 for an invalid model bubbled up as a generic 500 because error
 * reporting in those routes was shallow. This module is the one place to
 * update when Anthropic rolls new models.
 *
 * Override via environment variables if needed (useful for A/B tests or
 * temporary fallbacks):
 *   ANTHROPIC_SONNET_MODEL
 *   ANTHROPIC_OPUS_MODEL
 *   ANTHROPIC_HAIKU_MODEL
 */

export const SONNET = process.env.ANTHROPIC_SONNET_MODEL || 'claude-sonnet-4-5';
export const OPUS   = process.env.ANTHROPIC_OPUS_MODEL   || 'claude-opus-4-5';
export const HAIKU  = process.env.ANTHROPIC_HAIKU_MODEL  || 'claude-haiku-4-5';

/**
 * Task-specific defaults. Picking the right tier per use-case is the single
 * biggest lever on the Anthropic bill (Opus is 5× Sonnet, Haiku is 1/5 Sonnet).
 * Grouped by behavior, not by caller:
 */
export const MODEL_FOR = {
  // Rich conversational context with live DB data — Sonnet handles this well.
  brainChat:         SONNET,

  // Structured extraction from a document — Sonnet's vision is accurate.
  resumeParse:       SONNET,

  // "Which of our candidates fit this job?" — a judgment call that affects
  // pipeline velocity, worth spending Sonnet for.
  candidateScoring:  SONNET,

  // Generating a boolean-search string for external sources. Narrow,
  // deterministic task — Haiku is plenty and 5× cheaper per call.
  booleanSearch:     HAIKU,

  // Email / message / contract template drafting — Sonnet produces
  // better copy than Haiku.
  templateDrafting:  SONNET,

  // Operational suggestions + daily summaries — moderate complexity.
  intelligence:      SONNET,

  // AI routing decisions ("which folder should this file go in?") — Haiku.
  smartRouting:      HAIKU,

  // Email/OneDrive AI search — semantic over retrieved chunks. Sonnet.
  searchSynthesis:   SONNET,

  // Time-tracking anomaly / natural-language queries — Sonnet.
  timeTracking:      SONNET,
} as const;

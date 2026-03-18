'use strict';

/**
 * PUBLIC_INTERFACE
 * escapeRegex
 * Escapes a user-provided string so it can be safely embedded into a RegExp as a literal.
 *
 * Contract:
 * - Inputs:
 *   - value: any
 * - Outputs:
 *   - string: safe literal suitable for `new RegExp(output, flags)`
 * - Errors:
 *   - none (always returns a string)
 *
 * Rationale:
 * - Session Tracking "q" search is user-controlled input. Passing it directly to
 *   `new RegExp(q, 'i')` can throw for values like "[" or "\" and can also change
 *   the meaning of the search. We want literal, case-insensitive contains matching.
 */
function escapeRegex(value) {
  const s = typeof value === 'string' ? value : String(value ?? '');
  // Escape regex special chars: . * + ? ^ $ { } ( ) | [ ] \ /
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { escapeRegex };

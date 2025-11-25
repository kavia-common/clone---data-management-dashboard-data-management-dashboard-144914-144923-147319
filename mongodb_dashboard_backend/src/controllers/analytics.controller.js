'use strict';

/**
 * Deprecated: analytics controller was removed.
 * Keeping an explicit, named, empty export to avoid import errors elsewhere.
 */
// PUBLIC_INTERFACE
function noopAnalyticsController() {
  /** No-op controller kept for backward compatibility. */
  return null;
}

// PUBLIC_INTERFACE
function analyticsController() {
  /** Alias for noop to satisfy named export patterns in some import sites. */
  return noopAnalyticsController();
}

module.exports = {
  noopAnalyticsController,
  analyticsController,
};

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

module.exports = {
  noopAnalyticsController,
};

"use strict";

/**
 * Lightweight in-memory diagnostics capture for llm-costs requests.
 * Stores only last record to avoid memory growth.
 */

// PUBLIC_INTERFACE
function getDiagnosticsStore() {
  /** Returns singleton store with set/get helpers for last diagnostics. */
  if (!global.__llmCostsDiagnosticsStore) {
    global.__llmCostsDiagnosticsStore = {
      last: null,
      set(d) {
        try {
          this.last = {
            ...d,
            captured_at: new Date().toISOString(),
          };
        } catch (_) {
          this.last = { error: "failed_to_set", captured_at: new Date().toISOString() };
        }
      },
      get() {
        return this.last;
      },
      clear() {
        this.last = null;
      },
    };
  }
  return global.__llmCostsDiagnosticsStore;
}

module.exports = {
  getDiagnosticsStore,
};

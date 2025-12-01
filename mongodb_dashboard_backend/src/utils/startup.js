'use strict';

const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * warmupIndexes
 * Performs non-blocking, best-effort index creation for critical models.
 * - Never throws (errors are logged in non-production).
 * - Only runs if Mongoose is connected.
 * - Does not await in caller to avoid hanging startup.
 */
async function warmupIndexes() {
  // 1 = connected
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    return;
  }
  try {
    // Lazy require to avoid circular deps on module load
    const LLMCost = require('../models/llmCosts.model');

    // Use createIndexes which is idempotent and safe; wrap in try/catch per model
    if (LLMCost && typeof LLMCost.createIndexes === 'function') {
      try {
        await LLMCost.createIndexes();
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[startup] LLMCost.createIndexes failed (non-fatal):', e?.message || e);
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[startup] warmupIndexes error (ignored):', err?.message || err);
    }
  }
}

module.exports = { warmupIndexes };

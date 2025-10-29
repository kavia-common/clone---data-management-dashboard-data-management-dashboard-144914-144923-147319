'use strict';

/**
 * Lightweight model utilities for the users collection to ensure helpful indexes.
 * Uses native MongoDB driver via config/db rather than Mongoose (project uses native driver).
 */

const { getDb } = require('../config/db');

// PUBLIC_INTERFACE
async function ensureUserIndexes() {
  const db = await getDb();
  const users = db.collection('users');
  try {
    await users.createIndex({ updated_at: 1 });
    await users.createIndex({ created_at: 1 });
    await users.createIndex({ organization_id: 1 });
    await users.createIndex({ department: 1 });
    await users.createIndex({ status: 1 });
    await users.createIndex({ has_accepted_terms: 1 });
  } catch (err) {
    // Do not throw on index creation; log and continue.
    console.warn('ensureUserIndexes warning:', err?.message || err);
  }
}

module.exports = {
  ensureUserIndexes
};

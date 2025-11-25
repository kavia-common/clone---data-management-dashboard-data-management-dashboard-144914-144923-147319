'use strict';

const { getDb } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * Returns simple health object.
 */
async function getHealth() {
  const db = getDb();
  return { ok: !!db, timestamp: new Date().toISOString() };
}

/**
 * PUBLIC_INTERFACE
 * Ensures a DB connection is available; throws 503 error when missing.
 */
async function ensureDbConnected() {
  const db = getDb();
  if (!db) {
    const err = new Error('Database not connected');
    err.status = 503;
    throw err;
  }
  return db;
}

module.exports = { getHealth, ensureDbConnected };

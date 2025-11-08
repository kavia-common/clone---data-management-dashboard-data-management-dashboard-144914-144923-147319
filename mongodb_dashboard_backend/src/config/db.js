'use strict';

const { MongoClient } = require('mongodb');

let _client = null;
let _db = null;

/**
 * Lightweight connector: attempts to connect only if MONGODB_URI exists.
 * Returns { client, db } or { client:null, db:null } on absence/failure.
 *
 * PUBLIC_INTERFACE
 */
async function connect(logger = console) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.warn('[DB] MONGODB_URI not set. Skipping DB connection.');
    return { client: null, db: null };
  }

  try {
    const client = new MongoClient(uri);
    await client.connect();
    const db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
    _client = client;
    _db = db;
    logger.info(`[DB] Connected: ${db.databaseName}`);
    return { client, db };
  } catch (e) {
    logger.error('[DB] Connection error:', e?.message || e);
    return { client: null, db: null, error: e };
  }
}

/**
 * PUBLIC_INTERFACE
 */
function db() {
  return _db;
}

/**
 * PUBLIC_INTERFACE
 */
function client() {
  return _client;
}

/**
 * PUBLIC_INTERFACE
 */
async function close(logger = console) {
  if (_client) {
    try {
      await _client.close();
      logger.info('[DB] Closed');
    } catch (e) {
      logger.warn('[DB] Close error:', e?.message || e);
    } finally {
      _client = null;
      _db = null;
    }
  }
}

module.exports = {
  connect,
  db,
  client,
  close,
};

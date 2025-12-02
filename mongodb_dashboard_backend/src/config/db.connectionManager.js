'use strict';

const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * MongoConnectionManager
 * Centralizes Mongo connection state and provides fast-fail helpers.
 *
 * Behavior:
 * - Applies aggressive "fail-fast" timeouts to mongoose connect.
 * - Tracks connection state transitions.
 * - Exposes isDbReady(), isUriMissing(), and waitForInitialConnection() helpers.
 * - Emits structured logs on server selection timeouts with organization_id if available on req (when used via middleware).
 *
 * ENV VARS (do not hardcode secrets):
 * - MONGODB_URI (required)
 * - MONGOOSE_POOL_SIZE (optional, default 5)
 * - MONGOOSE_AUTO_INDEX (optional, 'true' to enable)
 * - MONGODB_DB (optional db name override)
 */
class MongoConnectionManager {
  constructor() {
    this.uri = process.env.MONGODB_URI || '';
    this.state = 'disconnected'; // disconnected | connecting | connected
    this.initialConnectAttempted = false;
    this.lastError = null;

    // attach listeners once
    mongoose.connection.on('connected', () => {
      this.state = 'connected';
      this.lastError = null;
      try {
        // eslint-disable-next-line no-console
        console.log('[mongo] connected', {
          db: mongoose.connection?.name,
          host: mongoose.connection?.host,
          states: mongoose.STATES,
        });
      } catch {}
    });
    mongoose.connection.on('error', (err) => {
      this.state = 'disconnected';
      this.lastError = err;
      try {
        // eslint-disable-next-line no-console
        console.error('[mongo] error', {
          message: err?.message || String(err),
          code: err?.code,
          name: err?.name,
        });
      } catch {}
    });
    mongoose.connection.on('disconnected', () => {
      this.state = 'disconnected';
      try {
        // eslint-disable-next-line no-console
        console.warn('[mongo] disconnected');
      } catch {}
    });
  }

  // PUBLIC_INTERFACE
  /** Returns true when MongoDB URI is missing from env. */
  isUriMissing() {
    return !this.uri || String(this.uri).trim() === '';
  }

  // PUBLIC_INTERFACE
  /** Returns true if Mongoose is connected and manager thinks DB is ready. */
  isDbReady() {
    return mongoose.connection?.readyState === 1 && this.state === 'connected';
  }

  // PUBLIC_INTERFACE
  /** Kick off a connection attempt (idempotent). Uses fail-fast options. */
  async connect() {
    if (this.isUriMissing()) {
      // eslint-disable-next-line no-console
      console.warn('[mongo] MONGODB_URI missing; DB-dependent endpoints will return 503.');
      return;
    }
    if (this.initialConnectAttempted && (this.state === 'connected' || this.state === 'connecting')) {
      return;
    }

    this.initialConnectAttempted = true;
    this.state = 'connecting';

    // Global mongoose settings
    mongoose.set('strictQuery', true);
    if (process.env.NODE_ENV === 'test') {
      try { mongoose.set('bufferCommands', false); } catch {}
    }

    const autoIndex = String(process.env.MONGOOSE_AUTO_INDEX || '').toLowerCase() === 'true';
    const dbName = (process.env.MONGODB_DB || '').trim() || undefined;
    const maxPoolSize =
      Number.isFinite(Number(process.env.MONGOOSE_POOL_SIZE))
        ? Number(process.env.MONGOOSE_POOL_SIZE)
        : 5;

    // Fail-fast timeouts. Keep small to return fast when cluster unreachable.
    const options = {
      autoIndex,
      maxPoolSize,
      serverSelectionTimeoutMS: 2000, // 2s to select a server
      socketTimeoutMS: 4500,          // 4.5s socket inactivity timeout
      connectTimeoutMS: 2000,         // 2s TCP connect timeout
      heartbeatFrequencyMS: 1000,     // faster heartbeat to detect down nodes quickly
      retryWrites: false,             // fail fast instead of retrying on transient
      family: 4,
      ...(dbName ? { dbName } : {}),
    };

    try {
      await mongoose.connect(this.uri, options);
      this.state = 'connected';
      this.lastError = null;
    } catch (err) {
      this.state = 'disconnected';
      this.lastError = err;
      // eslint-disable-next-line no-console
      console.error('[mongo] initial connect failed', { message: err?.message || String(err) });
      // Do not throw to avoid crashing server start. Middlewares will short-circuit requests.
    }
  }

  // PUBLIC_INTERFACE
  /**
   * Attempts a quick ping to check readiness. Uses a short maxTimeMS to avoid hanging.
   * Returns { ok: boolean, error?: string }
   */
  async quickPing() {
    if (this.isUriMissing()) {
      return { ok: false, error: 'MONGODB_URI missing' };
    }
    try {
      // use native driver via mongoose.connection.db if available
      if (!mongoose.connection?.db) {
        return { ok: false, error: 'not connected' };
      }
      const admin = mongoose.connection.db.admin();
      const res = await admin.ping({ maxTimeMS: 800 });
      return { ok: !!res?.ok };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  // PUBLIC_INTERFACE
  /** Wait a short time for initial connection (best-effort). */
  async waitForInitialConnection(timeoutMs = 1500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.isDbReady()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return this.isDbReady();
  }
}

const mongoConnectionManager = new MongoConnectionManager();

// PUBLIC_INTERFACE
module.exports = { mongoConnectionManager };

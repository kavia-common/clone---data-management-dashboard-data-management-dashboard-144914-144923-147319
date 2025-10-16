const mongoose = require('mongoose');

// INTERNAL: track connection status for health checks and gating route behavior
let connectionState = {
  connected: false,
  lastError: null,
  lastAttempt: null,
  attempts: 0,
};

/**
 * PUBLIC_INTERFACE
 * Establish a resilient connection to MongoDB using Mongoose with retry and strict options.
 * - Uses process.env.MONGODB_URI (REQUIRED). If missing, logs error and throws to fail fast.
 * - Optional: MONGODB_DB to select dbName, MONGOOSE_AUTO_INDEX to override autoIndex.
 * - Disables mongoose model buffering to avoid silent queueing of operations when disconnected.
 * - Retries with exponential backoff up to MAX_RETRIES.
 *
 * Returns the active mongoose.connection.
 */
async function connectDB() {
  const MAX_RETRIES = parseInt(process.env.MONGO_MAX_RETRIES || '5', 10);
  const BASE_DELAY_MS = parseInt(process.env.MONGO_BASE_DELAY_MS || '500', 10);

  const uri =
    (process.env.MONGODB_URI && process.env.MONGODB_URI.trim()) ||
    process.env.MONGO_URI ||
    process.env.MONGO_URL;

  if (!uri) {
    const msg =
      'MONGODB_URI is not set. Please set it in environment (see .env.example). Backend will not start without it.';
    // eslint-disable-next-line no-console
    console.error('[db] Missing MONGODB_URI. ' + msg);
    connectionState.connected = false;
    connectionState.lastError = new Error(msg);
    throw connectionState.lastError;
  }

  // Global settings
  mongoose.set('strictQuery', true);

  // Disable command buffering at connection-level to surface connectivity problems immediately
  // (prevents 10s buffering timeouts like "users.find() buffering timed out")
  mongoose.set('bufferCommands', false);

  const autoIndex =
    String(process.env.MONGOOSE_AUTO_INDEX || '').toLowerCase() === 'true';
  const dbName = process.env.MONGODB_DB;

  // Prefer smaller timeouts to fail fast and retry
  const options = {
    autoIndex,
    maxPoolSize: parseInt(process.env.MONGO_MAX_POOL || '10', 10),
    serverSelectionTimeoutMS: parseInt(
      process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '5000',
      10
    ),
    socketTimeoutMS: parseInt(process.env.MONGO_SOCKET_TIMEOUT_MS || '45000', 10),
    family: 4,
    bufferCommands: false,
    ...(dbName ? { dbName } : {}),
  };

  // Masked host for logs
  let clusterHost = 'unknown-host';
  try {
    const parsed = new URL(uri);
    clusterHost = parsed.hostname || clusterHost;
  } catch {
    // ignore
  }

  // Attach listeners once
  if (!mongoose.connection._dashboardListenersAttached) {
    mongoose.connection.on('connected', () => {
      connectionState.connected = true;
      connectionState.lastError = null;
      // eslint-disable-next-line no-console
      console.log(
        `[db] Connected to MongoDB host=${clusterHost} db=${mongoose.connection?.name || 'default'} autoIndex=${autoIndex}`
      );
    });
    mongoose.connection.on('error', (err) => {
      connectionState.connected = false;
      connectionState.lastError = err;
      // eslint-disable-next-line no-console
      console.error('[db] MongoDB connection error:', err?.message || err);
    });
    mongoose.connection.on('disconnected', () => {
      connectionState.connected = false;
      // eslint-disable-next-line no-console
      console.warn('[db] MongoDB disconnected');
    });
    mongoose.connection._dashboardListenersAttached = true;
  }

  // Retry loop
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    attempt += 1;
    connectionState.attempts = attempt;
    connectionState.lastAttempt = new Date().toISOString();

    try {
      await mongoose.connect(uri, options);
      // success
      connectionState.connected = true;
      return mongoose.connection;
    } catch (err) {
      connectionState.connected = false;
      connectionState.lastError = err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // exponential backoff
      // eslint-disable-next-line no-console
      console.warn(
        `[db] Connect attempt ${attempt}/${MAX_RETRIES} failed: ${err?.message || err}. Retrying in ${delay}ms...`
      );
      if (attempt > MAX_RETRIES) {
        // eslint-disable-next-line no-console
        console.error(
          `[db] Exhausted retries (${MAX_RETRIES}). Failing startup.`
        );
        throw err;
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // Should never reach here
  throw new Error('Unexpected DB connect loop termination');
}

/**
 * PUBLIC_INTERFACE
 * getDb
 * Returns an active MongoDB Db instance if connected.
 * Throws if not connected to map to 503 at route layer.
 */
async function getDb() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    // Try a single reconnect path (non-blocking long wait avoided)
    try {
      await connectDB();
    } catch (e) {
      const err = new Error('Database not connected');
      err.code = 'DB_NOT_CONNECTED';
      err.cause = e;
      throw err;
    }
  }
  return mongoose.connection.db;
}

/**
 * PUBLIC_INTERFACE
 * getCollection
 * Helper to obtain a native MongoDB collection by name. Accepts a string name
 * or an array of candidate names and returns the first existing collection;
 * if none exist, returns the first candidate name as a collection handle.
 */
async function getCollection(nameOrNames) {
  const db = await getDb();
  const candidates = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];

  try {
    const existing = await db
      .listCollections({ name: { $in: candidates } }, { nameOnly: true })
      .toArray();

    const existingNames = new Set(existing.map((c) => c.name));
    const chosen = candidates.find((n) => existingNames.has(n)) || candidates[0];
    return db.collection(chosen);
  } catch (err) {
    return db.collection(candidates[0]);
  }
}

/**
 * PUBLIC_INTERFACE
 * getConnectionHealth
 * Returns a summary of the current DB connection health for /health/db.
 */
function getConnectionHealth() {
  const state = mongoose.connection.readyState; // 0,1,2,3
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return {
    status: state === 1 ? 'up' : 'down',
    mongooseState: states[state] || String(state),
    attempts: connectionState.attempts,
    lastAttempt: connectionState.lastAttempt,
    lastError: connectionState.lastError ? String(connectionState.lastError.message || connectionState.lastError) : null,
  };
}

module.exports = { connectDB, getDb, getCollection, getConnectionHealth };

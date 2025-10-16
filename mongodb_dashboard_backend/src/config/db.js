const mongoose = require('mongoose');

let connectionReadyPromise = null;
let lastConnectError = null;

/**
 * PUBLIC_INTERFACE
 * Establishes a connection to MongoDB using Mongoose with retries and fail-fast logging.
 * - Reads the connection string from process.env.MONGODB_URI (required)
 * - Retries connection attempts with exponential backoff
 * - Exposes a readiness promise used by middleware to gate requests until connected
 *
 * Returns the active mongoose.connection.
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    const msg = 'MONGODB_URI is not configured. Set it in environment (.env) to enable database access.';
    // eslint-disable-next-line no-console
    console.error(`[db] ${msg}`);
    lastConnectError = new Error(msg);
    throw lastConnectError;
  }

  mongoose.set('strictQuery', true);

  const autoIndex =
    (process.env.MONGOOSE_AUTO_INDEX || '').toString().toLowerCase() === 'true';

  const dbName = process.env.MONGODB_DB;

  const options = {
    autoIndex,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4,
    ...(dbName ? { dbName } : {}),
  };

  let clusterHost = 'unknown-host';
  try {
    const parsed = new URL(uri);
    clusterHost = parsed.hostname || clusterHost;
  } catch {
    // ignore
  }

  mongoose.connection.on('connected', () => {
    // eslint-disable-next-line no-console
    console.log(
      `[db] MongoDB connected to ${clusterHost} (db: ${mongoose.connection?.name || 'default'})`
    );
    if (dbName) {
      // eslint-disable-next-line no-console
      console.log(`[db] dbName=${dbName}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[db] Mongoose autoIndex=${autoIndex ? 'ENABLED' : 'DISABLED'}`);
  });

  mongoose.connection.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[db] MongoDB connection error:', err.message);
    lastConnectError = err;
  });

  mongoose.connection.on('disconnected', () => {
    // eslint-disable-next-line no-console
    console.warn('[db] MongoDB disconnected');
  });

  // Retry strategy
  const maxAttempts = parseInt(process.env.MONGOOSE_MAX_CONNECT_ATTEMPTS || '5', 10);
  const baseDelay = parseInt(process.env.MONGOOSE_CONNECT_BASE_DELAY_MS || '500', 10);

  const attemptConnect = async () => {
    let attempt = 0;
    /* eslint-disable no-await-in-loop */
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        // eslint-disable-next-line no-console
        console.log(`[db] Connecting to MongoDB (attempt ${attempt}/${maxAttempts})...`);
        await mongoose.connect(uri, options);
        lastConnectError = null;
        return mongoose.connection;
      } catch (err) {
        lastConnectError = err;
        const delay = baseDelay * Math.pow(2, attempt - 1);
        // eslint-disable-next-line no-console
        console.error(
          `[db] Connect attempt ${attempt} failed: ${err?.message || err}. Retrying in ${delay}ms...`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    const finalErr = new Error(
      `Failed to connect to MongoDB after ${maxAttempts} attempts. Last error: ${lastConnectError?.message || 'unknown'}`
    );
    lastConnectError = finalErr;
    throw finalErr;
  };

  // Memoize the in-flight promise so concurrent calls share it
  if (!connectionReadyPromise) {
    connectionReadyPromise = attemptConnect().catch((e) => {
      // Reset so future calls can attempt again
      connectionReadyPromise = null;
      throw e;
    });
  }
  return connectionReadyPromise;
}

/**
 * PUBLIC_INTERFACE
 * getDb
 * Returns an active MongoDB Db instance from the current Mongoose connection.
 * Ensures a connection is established; if not connected, attempts to connect first.
 */
async function getDb() {
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  if (mongoose.connection.readyState !== 1) {
    await connectDB();
  }
  if (!mongoose.connection.db) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return mongoose.connection.db;
}

/**
 * PUBLIC_INTERFACE
 * getCollection
 * Helper to obtain a native MongoDB collection by name. Accepts a string name
 * or an array of candidate names and returns the first existing collection;
 * if none exist, returns the first candidate name as a collection handle.
 *
 * Example:
 *  const col = await getCollection(['llm-costs', 'llm_costs']);
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
 * awaitDbReady
 * Promise that resolves when Mongoose has an active connection.
 * Used by readiness middleware to gate requests during startup or outages.
 */
async function awaitDbReady() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) return true;
  try {
    await connectDB();
    return true;
  } catch (e) {
    lastConnectError = e;
    return false;
  }
}

/**
 * PUBLIC_INTERFACE
 * getLastDbError
 * Returns the last connection error if any (for diagnostics).
 */
function getLastDbError() {
  return lastConnectError;
}

module.exports = { connectDB, getDb, getCollection, awaitDbReady, getLastDbError };

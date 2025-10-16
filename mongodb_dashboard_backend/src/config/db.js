const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * Establishes a connection to MongoDB using Mongoose.
 * - Reads the connection string from process.env.MONGODB_URI
 * - Falls back to a predefined default if the environment variable is not set
 * - Emits useful, non-sensitive logs for verification
 *
 * Returns the active mongoose.connection.
 */
async function connectDB() {
  // Default URI provided per task requirement; can be overridden by MONGODB_URI env var
  const DEFAULT_URI =
    'mongodb://localhost:27017/dashboard'; // Safe local default; override in .env for production

  // Validate env var presence and provide clear error for missing configuration
  const uriFromEnv = process.env.MONGODB_URI;
  const uri = uriFromEnv || DEFAULT_URI;

  if (!uriFromEnv) {
    // eslint-disable-next-line no-console
    console.warn(
      '[db] MONGODB_URI not set. Using default fallback (mongodb://localhost:27017/dashboard). Set MONGODB_URI in .env for non-local environments.'
    );
  }

  mongoose.set('strictQuery', true);

  // Connection options for Mongoose v7
  // - autoIndex off by default to avoid slow startup on large collections
  const autoIndex =
    (process.env.MONGOOSE_AUTO_INDEX || '').toString().toLowerCase() === 'true';
  const dbName = process.env.MONGODB_DB; // Optional override db name

  const options = {
    autoIndex,
    maxPoolSize: parseInt(process.env.MONGOOSE_MAX_POOL_SIZE || '10', 10),
    serverSelectionTimeoutMS: parseInt(process.env.MONGOOSE_SERVER_SELECTION_TIMEOUT_MS || '5000', 10),
    socketTimeoutMS: parseInt(process.env.MONGOOSE_SOCKET_TIMEOUT_MS || '45000', 10),
    family: 4,
    ...(dbName ? { dbName } : {}),
  };

  // Prepare masked logs (no credentials)
  let clusterHost = 'unknown-host';
  let dbPath = '';
  try {
    const parsed = new URL(uri);
    clusterHost = parsed.hostname || clusterHost;
    dbPath = parsed.pathname || '';
  } catch {
    // ignore parse errors
  }

  // Attach listeners only once
  if (!mongoose.connection._listenersRegistered) {
    mongoose.connection.on('connected', () => {
      // eslint-disable-next-line no-console
      console.log(
        `[db] MongoDB connected (host=${clusterHost}, db=${mongoose.connection?.name || dbPath || 'default'})`
      );
      if (dbName) console.log(`[db] dbName override via env: ${dbName}`);
      console.log(`[db] Mongoose autoIndex=${autoIndex ? 'ENABLED' : 'DISABLED'}`);
    });

    mongoose.connection.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[db] MongoDB connection error:', err?.message || err);
    });

    mongoose.connection.on('disconnected', () => {
      // eslint-disable-next-line no-console
      console.warn('[db] MongoDB disconnected');
    });

    mongoose.connection._listenersRegistered = true;
  }

  await mongoose.connect(uri, options);
  return mongoose.connection;
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
  // In rare cases during connect, db might still be null; await a tick
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
    // Fallback: return the first candidate even if listCollections fails
    return db.collection(candidates[0]);
  }
}

module.exports = { connectDB, getDb, getCollection };

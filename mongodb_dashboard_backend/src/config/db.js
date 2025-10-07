const mongoose = require('mongoose');

/**
 * Resolve the DB name from environment with backwards compatibility.
 * Prefers MONGODB_DB_NAME but falls back to MONGODB_DB if present.
 */
function resolveDbNameFromEnv() {
  return process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || undefined;
}

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
    'mongodb+srv://govindarajmalaiarasu_db_user:MGRaj2005@phaseonedata.qlyhyxu.mongodb.net/?retryWrites=true&w=majority&appName=PhaseOneData';

  const uri = process.env.MONGODB_URI || DEFAULT_URI;

  if (!process.env.MONGODB_URI) {
    // eslint-disable-next-line no-console
    console.warn(
      'MONGODB_URI not set in environment. Falling back to built-in default MongoDB URI.'
    );
  }

  mongoose.set('strictQuery', true);

  // Connection options recommended for modern Mongoose
  // - Disable autoIndex by default to avoid failures on clusters with existing duplicate data.
  //   You can override by setting MONGOOSE_AUTO_INDEX=true
  const autoIndex =
    (process.env.MONGOOSE_AUTO_INDEX || '').toString().toLowerCase() === 'true';

  const dbName = resolveDbNameFromEnv(); // Optional; if not set, Mongo will use the URI/path default (often 'test')

  const options = {
    autoIndex,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4,
    ...(dbName ? { dbName } : {}),
  };

  // Prepare a safe, masked log for the cluster host (never log credentials)
  let clusterHost = 'unknown-host';
  try {
    const parsed = new URL(uri);
    clusterHost = parsed.hostname || clusterHost;
  } catch {
    // swallow parse errors; we will still connect
  }

  mongoose.connection.on('connected', () => {
    // eslint-disable-next-line no-console
    console.log(
      `MongoDB connected to cluster host: ${clusterHost} (db: ${mongoose.connection?.name || 'default'})`
    );
    if (dbName) {
      // eslint-disable-next-line no-console
      console.log(
        `MongoDB dbName selected via env: ${
          process.env.MONGODB_DB_NAME
            ? `MONGODB_DB_NAME=${dbName}`
            : process.env.MONGODB_DB
            ? `MONGODB_DB=${dbName}`
            : dbName
        }`
      );
    }
    // eslint-disable-next-line no-console
    console.log(`Mongoose autoIndex=${autoIndex ? 'ENABLED' : 'DISABLED'}`);
  });

  mongoose.connection.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('MongoDB connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    // eslint-disable-next-line no-console
    console.warn('MongoDB disconnected');
  });

  await mongoose.connect(uri, options);
  return mongoose.connection;
}

/**
 * Wait for a usable DB connection. If disconnected, attempts to connect.
 */
async function waitForConnection() {
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  const state = mongoose.connection.readyState;
  if (state === 1) return; // connected
  if (state === 2) {
    // connecting - wait for 'connected' or 'error'
    await new Promise((resolve, reject) => {
      const onConnected = () => {
        cleanup();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        mongoose.connection.off('connected', onConnected);
        mongoose.connection.off('error', onError);
      };
      mongoose.connection.once('connected', onConnected);
      mongoose.connection.once('error', onError);
    });
    return;
  }
  // if disconnected (0) or disconnecting (3), try connect
  await connectDB();
}

/**
 * PUBLIC_INTERFACE
 * Return the native MongoDB Db instance (awaits connection if necessary).
 */
async function getDb() {
  await waitForConnection();
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB native database handle not available after connection.');
  }
  return db;
}

/**
 * PUBLIC_INTERFACE
 * Resolve a MongoDB collection from a list of candidate names.
 * Examples:
 *   await getCollection('llm-costs')
 *   await getCollection(['llm-costs', 'llm_costs'])
 *
 * Throws an error with code 'COLLECTION_NOT_FOUND' if no candidate exists.
 */
async function getCollection(candidates, options = {}) {
  await waitForConnection();
  const db = await getDb();
  const candidateList = Array.isArray(candidates) ? candidates : [candidates];

  // Include underscore/dash alternates automatically
  const expanded = new Set();
  for (const name of candidateList) {
    if (!name) continue;
    expanded.add(name);
    // Add dash/underscore variant
    if (name.includes('-')) expanded.add(name.replace(/-/g, '_'));
    if (name.includes('_')) expanded.add(name.replace(/_/g, '-'));
  }
  const finalCandidates = Array.from(expanded);

  const existing = await db.listCollections().toArray();
  const existingNames = existing.map((c) => c.name);

  for (const cand of finalCandidates) {
    if (existingNames.includes(cand)) {
      return db.collection(cand);
    }
  }

  const err = new Error(
    `Required MongoDB collection not found. Tried: ${finalCandidates.join(
      ', '
    )}. Existing collections: ${existingNames.join(', ')}`
  );
  // Attach a stable error code for route handlers to map status codes
  err.code = 'COLLECTION_NOT_FOUND';
  throw err;
}

module.exports = { connectDB, getDb, getCollection, waitForConnection, resolveDbNameFromEnv };

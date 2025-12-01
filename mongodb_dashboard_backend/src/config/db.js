const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * Establishes a connection to MongoDB using Mongoose.
 * - Reads the connection string from process.env.MONGODB_URI
 * - Does NOT hard-code any default credentials or URIs (security and environment portability)
 * - Emits useful, non-sensitive logs for verification
 *
 * Returns the active mongoose.connection.
 *
 * ENVIRONMENT VARIABLES REQUIRED:
 * - MONGODB_URI: Mongo connection string (e.g. mongodb://user:pass@host:27017/db)
 * - MONGODB_DB (optional): Database name override
 * - MONGOOSE_AUTO_INDEX (optional): 'true' to enable autoIndex
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri || typeof uri !== 'string' || uri.trim() === '') {
    console.warn('[db] MONGODB_URI is not set. Skipping MongoDB connection. The API will start, health endpoints will report db=disconnected.');
    return mongoose.connection;
  }

  mongoose.set('strictQuery', true);

  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  const isTest = nodeEnv === 'test';
  const isDev = nodeEnv === 'development';

  if (isTest) {
    try { mongoose.set('bufferCommands', false); } catch {}
  }

  const autoIndex = (process.env.MONGOOSE_AUTO_INDEX || '').toString().toLowerCase() === 'true';
  const dbNameEnv = (process.env.MONGODB_DB || '').trim();
  const dbName = dbNameEnv !== '' ? dbNameEnv : undefined;

  // Reduce pool and timeouts for preview/dev to limit memory and speed failures
  const maxPoolSize = Number.isFinite(Number(process.env.MONGOOSE_POOL_SIZE))
    ? Number(process.env.MONGOOSE_POOL_SIZE)
    : (isDev ? 3 : 5);

  const options = {
    autoIndex,
    maxPoolSize,
    serverSelectionTimeoutMS: isTest ? 250 : 3500,
    socketTimeoutMS: isTest ? 500 : 20000,
    family: 4,
    ...(dbName ? { dbName } : {}),
  };

  let clusterHost = 'unknown-host';
  try { const parsed = new URL(uri); clusterHost = parsed.hostname || clusterHost; } catch {}

  mongoose.connection.removeAllListeners('connected');
  mongoose.connection.removeAllListeners('error');
  mongoose.connection.removeAllListeners('disconnected');

  mongoose.connection.on('connected', () => {
    console.log(`MongoDB connected to cluster host: ${clusterHost} (db: ${mongoose.connection?.name || 'default'})`);
    if (dbName) console.log(`MongoDB dbName selected via env: ${dbName}`);
    console.log(`Mongoose autoIndex=${autoIndex ? 'ENABLED' : 'DISABLED'} maxPoolSize=${maxPoolSize}`);
  });

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected');
  });

  // Lightweight retry with backoff to handle brief Mongo unavailability without crashing the process
  const maxAttempts = Number.isFinite(Number(process.env.MONGOOSE_CONNECT_ATTEMPTS))
    ? Number(process.env.MONGOOSE_CONNECT_ATTEMPTS)
    : 3;
  const baseDelay = Number.isFinite(Number(process.env.MONGOOSE_CONNECT_BACKOFF_MS))
    ? Number(process.env.MONGOOSE_CONNECT_BACKOFF_MS)
    : 300;

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await mongoose.connect(uri, options);
      return mongoose.connection;
    } catch (err) {
      lastErr = err;
      const delay = baseDelay * attempt;
      console.warn(`[db] connect attempt ${attempt}/${maxAttempts} failed: ${err?.message || err}. Retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  // Give up but do not throw; keep API alive. Health endpoint will reflect disconnected status.
  console.error('[db] All connection attempts failed. Continuing without DB connection. Health endpoints will show db=disconnected.');
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

/**
 * PUBLIC_INTERFACE
 * isDbConnected
 * Returns boolean indicating if Mongoose is currently connected to MongoDB.
 */
function isDbConnected() {
  // 1 means connected
  return mongoose.connection && mongoose.connection.readyState === 1;
}

module.exports = { connectDB, getDb, getCollection, isDbConnected };
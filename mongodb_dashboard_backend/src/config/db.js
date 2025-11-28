const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * Establishes a connection to MongoDB using Mongoose with robust timeouts and logging.
 * - Uses env MONGODB_URI (required) and optional MONGODB_DB
 * - Disables mongoose command buffering to avoid long hangs when DB is down
 * - Applies short server selection/connect timeouts for fast failover
 * - Emits concise, non-sensitive logs
 *
 * Returns the active mongoose.connection.
 *
 * ENV VARS:
 * - MONGODB_URI: Connection string
 * - MONGODB_DB: Optional db name override
 * - MONGOOSE_AUTO_INDEX: 'true' to enable autoIndex (disabled by default)
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri || typeof uri !== 'string' || uri.trim() === '') {
    console.warn('[db] MONGODB_URI is not set. Starting without DB connection. API will run in degraded mode.');
    return mongoose.connection;
  }

  // Recommended mongoose globals
  mongoose.set('strictQuery', true);
  // Disable global buffering to surface errors early instead of hanging
  try { mongoose.set('bufferCommands', false); } catch {}

  const isTest = String(process.env.NODE_ENV || '').toLowerCase() === 'test';

  const autoIndex = (process.env.MONGOOSE_AUTO_INDEX || '').toString().toLowerCase() === 'true';

  // Optional dbName from env; otherwise rely on URI path
  const dbName = process.env.MONGODB_DB && String(process.env.MONGODB_DB).trim()
    ? String(process.env.MONGODB_DB).trim()
    : undefined;

  const options = {
    autoIndex,
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: isTest ? 250 : 5000,
    connectTimeoutMS: isTest ? 250 : 5000,
    socketTimeoutMS: isTest ? 500 : 45000,
    family: 4,
    dbName, // only applies if provided
  };

  // Safe host display (never log credentials)
  let clusterHost = 'unknown-host';
  try { clusterHost = new URL(uri).hostname || clusterHost; } catch {}

  mongoose.connection.removeAllListeners('connected');
  mongoose.connection.removeAllListeners('error');
  mongoose.connection.removeAllListeners('disconnected');

  mongoose.connection.on('connected', () => {
    console.log(`MongoDB connected: host=${clusterHost} db=${mongoose.connection?.name || dbName || '(default)'} autoIndex=${autoIndex}`);
  });
  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err?.message || err);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected');
  });

  await mongoose.connect(uri, options);
  return mongoose.connection;
}

/**
 * PUBLIC_INTERFACE
 * getDb
 * Returns an active MongoDB Db instance from the current Mongoose connection.
 * If not connected, attempts to connect; returns null if still not available.
 */
async function getDb() {
  if (mongoose.connection.readyState !== 1) {
    try { await connectDB(); } catch (e) { /* swallow; handled by callers */ }
  }
  return mongoose.connection.db || null;
}

/**
 * PUBLIC_INTERFACE
 * getCollection
 * Helper to obtain a native MongoDB collection by name. Returns null if db not connected.
 */
async function getCollection(nameOrNames) {
  const db = await getDb();
  if (!db) return null;

  const candidates = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];

  try {
    const existing = await db
      .listCollections({ name: { $in: candidates } }, { nameOnly: true })
      .toArray();

    const existingNames = new Set(existing.map((c) => c.name));
    const chosen = candidates.find((n) => existingNames.has(n)) || candidates[0];
    return db.collection(chosen);
  } catch (_err) {
    return db.collection(candidates[0]);
  }
}

/**
 * PUBLIC_INTERFACE
 * isDbConnected
 * Returns boolean indicating if Mongoose is currently connected to MongoDB.
 */
function isDbConnected() {
  return !!(mongoose.connection && mongoose.connection.readyState === 1);
}

module.exports = { connectDB, getDb, getCollection, isDbConnected };
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
  // Enforce env-based configuration; never hard-code credentials
  const uri = process.env.MONGODB_URI;

  if (!uri || typeof uri !== 'string' || uri.trim() === '') {
     
    console.warn(
      '[db] MONGODB_URI is not set. Skipping MongoDB connection. The API will start, health endpoints will report db=disconnected.'
    );
    // Return the current mongoose.connection without attempting to connect
    return mongoose.connection;
  }

  mongoose.set('strictQuery', true);

  // In test mode, prefer fast failures and no buffering to keep tests snappy.
  const isTest = String(process.env.NODE_ENV || '').toLowerCase() === 'pre_prod_kaviaroot';
  if (isTest) {
    try {
      mongoose.set('bufferCommands', false);
    } catch {
      // ignore
    }
  }

  // Connection options recommended for modern Mongoose
  // - Disable autoIndex by default to avoid failures on clusters with existing duplicate data.
  //   You can override by setting MONGOOSE_AUTO_INDEX=true
  const autoIndex =
    (process.env.MONGOOSE_AUTO_INDEX || '').toString().toLowerCase() === 'true';

  const dbName = 'pre_prod_kaviaroot'; // Optional; if not set, Mongo will use the URI/path default

  const options = {
    autoIndex,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: isTest ? 250 : 5000,
    socketTimeoutMS: isTest ? 500 : 45000,
    family: 4,
    dbName,
  };

  // Prepare a safe, masked log for the cluster host (never log credentials)
  let clusterHost = 'unknown-host';
  try {
    const parsed = new URL(uri);
    clusterHost = parsed.hostname || clusterHost;
  } catch {
    // swallow parse errors; we will still attempt to connect
  }

  mongoose.connection.on('connected', () => {
     
    console.log(
      `MongoDB connected to cluster host: ${clusterHost} (db: ${mongoose.connection?.name || 'default'})`
    );
    if (dbName) {
       
      console.log(`MongoDB dbName selected via env: ${dbName}`);
    }
     
    console.log(`Mongoose autoIndex=${autoIndex ? 'ENABLED' : 'DISABLED'}`);
  });

  mongoose.connection.on('error', (err) => {
     
    console.error('MongoDB connection error:', err.message);
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
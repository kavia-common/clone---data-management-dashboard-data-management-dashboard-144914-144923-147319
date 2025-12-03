const mongoose = require('mongoose');

/**
 * INTERNAL: Assemble MongoDB URI from multiple env sources when MONGODB_URI is absent.
 * Priority:
 * 1) MONGODB_URI
 * 2) DATABASE_URL (if it starts with mongodb)
 * 3) Construct from MONGODB_HOST/PORT/USER/PASSWORD/MONGODB_DB with docker service defaults.
 */
function buildMongoUriFromEnv() {
  const direct = (process.env.MONGODB_URI || '').trim();
  if (direct) return direct;

  const dbUrl = (process.env.DATABASE_URL || '').trim();
  if (dbUrl && dbUrl.startsWith('mongodb')) return dbUrl;

  const host =
    (process.env.MONGODB_HOST || process.env.DB_HOST || 'mongodb_dashboard_db').trim();
  const port = Number(process.env.MONGODB_PORT || process.env.DB_PORT || 27017);
  const dbName =
    (process.env.MONGODB_DB ||
      process.env.DB_NAME ||
      process.env.MONGO_INITDB_DATABASE ||
      'dashboard').trim();

  const user = (process.env.MONGODB_USER || process.env.DB_USER || '').trim();
  const pass =
    (process.env.MONGODB_PASSWORD ||
      process.env.MONGODB_PASS ||
      process.env.DB_PASSWORD ||
      '').trim();
  const authSource =
    (process.env.MONGODB_AUTHSOURCE ||
      process.env.MONGO_AUTHSOURCE ||
      process.env.DB_AUTHSOURCE ||
      (user ? 'admin' : '')).trim();

  // Encode credentials safely
  const cred =
    user && pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
  const authQuery = authSource ? `?authSource=${encodeURIComponent(authSource)}` : '';

  return `mongodb://${cred}${host}:${port}/${encodeURIComponent(dbName)}${authQuery}`;
}

/**
 * PUBLIC_INTERFACE
 * Establishes a connection to MongoDB using Mongoose.
 * - Reads the connection string from MONGODB_URI/DATABASE_URL, or composes from HOST/PORT/USER/PASSWORD vars.
 * - Emits useful, non-sensitive logs for verification.
 *
 * Returns the active mongoose.connection.
 *
 * ENV VARS (examples; see .env.example):
 * - MONGODB_URI (preferred)
 * - DATABASE_URL (mongodb://...)
 * - MONGODB_HOST, MONGODB_PORT, MONGODB_DB, MONGODB_USER, MONGODB_PASSWORD, MONGODB_AUTHSOURCE
 * - MONGOOSE_AUTO_INDEX (optional)
 */
async function connectDB() {
  const uri = buildMongoUriFromEnv();

  if (!uri || typeof uri !== 'string' || uri.trim() === '') {
    console.warn(
      '[db] No MongoDB URI could be resolved from environment. Skipping connection. Health will report db=disconnected.'
    );
    return mongoose.connection;
  }

  mongoose.set('strictQuery', true);

  const isTest = String(process.env.NODE_ENV || '').toLowerCase() === 'test';
  if (isTest) {
    try {
      mongoose.set('bufferCommands', false);
    } catch {
      // ignore
    }
  }

  const autoIndex =
    (process.env.MONGOOSE_AUTO_INDEX || '').toString().toLowerCase() === 'true';

  // Use env dbName override if provided; otherwise rely on URI path db
  const envDbName = (process.env.MONGODB_DB || '').trim();
  const options = {
    autoIndex,
    // Required connection robustness per task
    maxPoolSize: Math.min(
      10,
      Math.max(5, Number(process.env.MONGODB_MAX_POOL_SIZE || 10))
    ),
    serverSelectionTimeoutMS: isTest
      ? 500
      : Math.min(
          20000,
          Math.max(15000, Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 15000))
        ),
    socketTimeoutMS: Math.min(
      120000,
      Math.max(45000, Number(process.env.MONGODB_SOCKET_TIMEOUT_MS || 45000))
    ),
    retryWrites: true,
    family: 4,
    ...(envDbName ? { dbName: envDbName } : {}),
  };

  // Prepare masked log host
  let clusterHost = 'unknown-host';
  try {
    const parsed = new URL(uri);
    clusterHost = parsed.hostname || clusterHost;
  } catch {
    // ignore
  }

  // Attach listeners once
  if (!mongoose.connection._hasKaviaDbListeners) {
    mongoose.connection.on('connected', () => {
      console.log(
        `MongoDB connected to host: ${clusterHost} (db: ${mongoose.connection?.name || 'default'})`
      );
      if (envDbName) console.log(`MongoDB dbName selected via env: ${envDbName}`);
      console.log(`Mongoose autoIndex=${autoIndex ? 'ENABLED' : 'DISABLED'}`);
    });

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err?.message || err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected');
    });
    mongoose.connection._hasKaviaDbListeners = true;
  }

  // Retry with backoff (3–5 attempts)
  const attempts = Math.min(
    5,
    Math.max(3, Number(process.env.MONGODB_CONNECT_RETRIES || 4))
  );
  const baseDelay = Math.min(
    5000,
    Math.max(500, Number(process.env.MONGODB_CONNECT_RETRY_DELAY_MS || 1000))
  );

  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await mongoose.connect(uri, options);
      return mongoose.connection;
    } catch (err) {
      lastErr = err;
      const delay = baseDelay * i; // linear backoff
      console.warn(
        `[db] Connection attempt ${i}/${attempts} failed: ${err?.message || err}. Retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // After retries, throw the last error to surface the failure (app can still run based on app.js)
  console.error('[db] Failed to connect to MongoDB after retries.');
  throw lastErr;
}

/**
 * PUBLIC_INTERFACE
 * getDb
 * Returns an active MongoDB Db instance from the current Mongoose connection.
 * Ensures a connection is established; if not connected, attempts to connect first.
 */
async function getDb() {
  if (mongoose.connection.readyState !== 1) {
    try {
      await connectDB();
    } catch {
      // If connection fails, bubble up a consistent error
      throw new Error('Database not connected');
    }
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
 * isDbConnected
 * Returns boolean indicating if Mongoose is currently connected to MongoDB.
 */
function isDbConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

module.exports = { connectDB, getDb, getCollection, isDbConnected };
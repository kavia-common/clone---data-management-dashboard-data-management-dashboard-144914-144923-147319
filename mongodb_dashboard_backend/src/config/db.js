const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * Establishes a connection to MongoDB using Mongoose.
 * - Reads connection string from env (MONGODB_URI)
 * - Emits non-sensitive logs; avoids hard-coded defaults
 *
 * Returns mongoose.connection (connected or skipped if no URI).
 *
 * ENV required:
 * - MONGODB_URI
 * Optional:
 * - MONGODB_DB
 * - MONGOOSE_AUTO_INDEX
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri || typeof uri !== 'string' || uri.trim() === '') {
    // eslint-disable-next-line no-console
    console.warn(
      '[db] MONGODB_URI is not set. Skipping MongoDB connection. The API will start, health endpoints will report db=disconnected.'
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

  const dbName = process.env.MONGODB_DB || undefined;

  const options = {
    autoIndex,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: isTest ? 250 : 5000,
    socketTimeoutMS: isTest ? 500 : 45000,
    family: 4,
    ...(dbName ? { dbName } : {}),
  };

  let clusterHost = 'unknown-host';
  try {
    const parsed = new URL(uri);
    clusterHost = parsed.hostname || clusterHost;
  } catch {
    // swallow parse errors
  }

  mongoose.connection.on('connected', () => {
    // eslint-disable-next-line no-console
    console.log(
      `MongoDB connected to cluster host: ${clusterHost} (db: ${mongoose.connection?.name || 'default'})`
    );
    if (dbName) {
      // eslint-disable-next-line no-console
      console.log(`MongoDB dbName selected via env: ${dbName}`);
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
 * PUBLIC_INTERFACE
 * getDb
 * Returns native MongoDB Db from current Mongoose connection.
 */
async function getDb() {
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
 * Obtain a collection by name or first-existing from an array of names.
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
  } catch {
    return db.collection(candidates[0]);
  }
}

/**
 * PUBLIC_INTERFACE
 * isDbConnected
 * Indicates if Mongoose is connected.
 */
function isDbConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

const dbConfig = { connectDB, getDb, getCollection, isDbConnected };
module.exports = dbConfig;

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

  const dbName = process.env.MONGODB_DB; // Optional; if not set, Mongo will use the URI/path default (often 'test')

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
    const resolvedDbName = mongoose.connection?.name || dbName || 'default';
    if (dbName) {
      // eslint-disable-next-line no-console
      console.log(`MongoDB dbName selected via env: ${dbName}`);
    }
    // eslint-disable-next-line no-console
    console.log(`Mongoose autoIndex=${autoIndex ? 'ENABLED' : 'DISABLED'}`);

    // Diagnostics: log key model -> collection mappings to confirm collection names
    try {
      const models = mongoose.models || {};
      const mappings = Object.keys(models).map((m) => {
        const coll = models[m]?.collection?.name;
        return `${m} -> ${coll || 'unknown'}`;
      });
      // eslint-disable-next-line no-console
      console.log(
        `[DB Diagnostics] Resolved dbName=${resolvedDbName}; Model collection bindings: ${mappings.join(
          ', '
        )}`
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[DB Diagnostics] Unable to list model mappings:', e?.message);
    }
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

module.exports = { connectDB };

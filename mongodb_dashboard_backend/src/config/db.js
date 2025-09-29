const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * Establishes a connection to MongoDB using Mongoose.
 * - Reads the connection string from process.env.MONGODB_URI
 * - Selects the database name from:
 *    1) process.env.MONGODB_DB (highest priority)
 *    2) Environment-based fallback (NODE_ENV):
 *       - development/dev/local/test -> develop_kaviaroot
 *       - qa/staging -> qa_kaviaroot
 *       - production/prod/beta/preprod/pre_prod/pre-prod -> pre_prod__kaviaroot
 *    3) Driver default (often "test") if none of the above (not recommended)
 * - Emits useful, non-sensitive logs for verification
 *
 * Optional verification:
 * - If VERIFY_COLLECTIONS=true, logs an estimated count for session_tracking at startup
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

  // Resolve the dbName: explicit env or environment-based fallback
  const envName = (process.env.NODE_ENV || 'development').toLowerCase();
  let resolvedDbName = process.env.MONGODB_DB;
  let dbSource = 'env';

  if (!resolvedDbName) {
    if (/(^|\b)(dev|development|local|test)(\b|$)/.test(envName)) {
      resolvedDbName = 'develop_kaviaroot';
      dbSource = 'NODE_ENV fallback';
    } else if (/(^|\b)(qa|staging)(\b|$)/.test(envName)) {
      resolvedDbName = 'qa_kaviaroot';
      dbSource = 'NODE_ENV fallback';
    } else if (/(^|\b)(production|prod|beta|preprod|pre_prod|pre-prod)(\b|$)/.test(envName)) {
      resolvedDbName = 'pre_prod__kaviaroot';
      dbSource = 'NODE_ENV fallback';
    } else {
      // If we get here, keep undefined to use driver default, but warn loudly.
      dbSource = 'driver default';
    }
  }

  const options = {
    autoIndex,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4,
    ...(resolvedDbName ? { dbName: resolvedDbName } : {}),
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
    if (resolvedDbName) {
      // eslint-disable-next-line no-console
      console.log(`MongoDB dbName selected via ${dbSource}: ${resolvedDbName}`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        'MongoDB dbName not specified; relying on driver default (often "test"). ' +
          'To ensure non-empty results, set MONGODB_DB or rely on NODE_ENV-based fallback.'
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

  // Optional verification: log an estimated count of the session_tracking collection
  if ((process.env.VERIFY_COLLECTIONS || '').toString().toLowerCase() === 'true') {
    try {
      const count = await mongoose.connection.db
        .collection('session_tracking')
        .estimatedDocumentCount();
      // eslint-disable-next-line no-console
      console.log(`[Verify] session_tracking estimated count: ${count}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[Verify] Unable to estimate session_tracking count:', e.message);
    }
  }

  return mongoose.connection;
}

module.exports = { connectDB };

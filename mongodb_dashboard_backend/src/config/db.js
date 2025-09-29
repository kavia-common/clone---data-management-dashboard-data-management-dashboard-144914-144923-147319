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
  const options = {
    autoIndex: true,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4,
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

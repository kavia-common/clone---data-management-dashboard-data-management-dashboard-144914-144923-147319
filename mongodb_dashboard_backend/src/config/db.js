'use strict';

const mongoose = require('mongoose');

let lastConnectError = null;

/**
 * PUBLIC_INTERFACE
 * Establishes a connection to MongoDB using Mongoose.
 * - Reads the connection string from process.env.MONGODB_URI
 * - Uses conservative timeouts and avoids blocking startup for long durations
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
    lastConnectError = new Error('MONGODB_URI not set');
    console.warn('[db] MONGODB_URI is not set. Starting without DB connection.');
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

  const autoIndex = (process.env.MONGOOSE_AUTO_INDEX || '').toString().toLowerCase() === 'true';
  const dbName = process.env.MONGODB_DB || undefined;

  const options = {
    autoIndex,
    maxPoolSize: 20,
    serverSelectionTimeoutMS: isTest ? 300 : 8000,
    socketTimeoutMS: isTest ? 600 : 20000,
    connectTimeoutMS: isTest ? 300 : 8000,
    family: 4,
    dbName,
  };

  try {
    await mongoose.connect(uri, options);
    lastConnectError = null;
    return mongoose.connection;
  } catch (err) {
    lastConnectError = err;
    console.error('MongoDB connection error:', err?.message || err);
    throw err;
  }
}

/**
 * PUBLIC_INTERFACE
 * getDb
 * Returns an active MongoDB Db instance from the current Mongoose connection.
 * Ensures a connection is established; if not connected, attempts to connect first.
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
 * Helper to obtain a native MongoDB collection by name or array of candidate names.
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
 * Returns boolean indicating if Mongoose is currently connected to MongoDB.
 */
function isDbConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

/**
 * PUBLIC_INTERFACE
 * isDBReadyFast
 * Fast readiness check that resolves within ~1s to avoid gateway 504s.
 * Returns an object { ok: boolean, reason?: string }
 */
async function isDBReadyFast(timeoutMs = 1000) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return { ok: false, reason: 'MONGODB_URI missing' };
  }

  if (isDbConnected() && mongoose.connection.db) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // Native ping via admin command
        await mongoose.connection.db.command({ ping: 1 }, { signal: controller.signal, maxTimeMS: timeoutMs });
        clearTimeout(timer);
        return { ok: true };
      } catch (e) {
        clearTimeout(timer);
        return { ok: false, reason: 'Ping failed' };
      }
    } catch {
      return { ok: false, reason: 'Ping exception' };
    }
  }

  // Not connected yet: attempt quick server selection by opening a short-lived connection
  try {
    const temp = await mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: Math.min(timeoutMs, 1000),
      socketTimeoutMS: Math.min(timeoutMs, 1000),
      connectTimeoutMS: Math.min(timeoutMs, 1000),
      family: 4,
    }).asPromise();
    await temp.close();
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Not connected' };
  }
}

function getConnectionState() {
  const state =
    mongoose.connection.readyState === 1
      ? 'connected'
      : mongoose.connection.readyState === 2
      ? 'connecting'
      : 'disconnected';
  return {
    connected: isDbConnected(),
    state,
    lastConnectError: lastConnectError ? String(lastConnectError.message || lastConnectError) : null,
  };
}

module.exports = { connectDB, getDb, getCollection, isDbConnected, isDBReadyFast, getConnectionState };

const mongoose = require('mongoose');
const { mongoConnectionManager } = require('./db.connectionManager');

/**
 * PUBLIC_INTERFACE
 * Establishes a connection to MongoDB using Mongoose with fail-fast options.
 * Delegates to MongoConnectionManager for consistent behavior across the app.
 */
async function connectDB() {
  await mongoConnectionManager.connect();
  return mongoose.connection;
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
 * Helper to obtain a native MongoDB collection by name. Accepts a string name
 * or an array of candidate names and returns the first existing collection;
 * if none exist, returns the first candidate name as a collection handle.
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
  return mongoose.connection && mongoose.connection.readyState === 1;
}

module.exports = { connectDB, getDb, getCollection, isDbConnected };
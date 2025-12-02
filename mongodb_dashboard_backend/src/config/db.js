/**
 * PUBLIC_INTERFACE
 * Exposes a minimal DB connection status interface to allow fast-fail behavior.
 * This file wraps the existing db.connectionManager to provide isConnected().
 */
const { mongoConnectionManager } = require('./db.connectionManager');

const db = {
  // PUBLIC_INTERFACE
  isConnected() {
    try {
      // Prefer manager readiness when available
      if (
        mongoConnectionManager &&
        typeof mongoConnectionManager.isDbReady === 'function'
      ) {
        return !!mongoConnectionManager.isDbReady();
      }
      // Fallback to mongoose connection flag if exposed via manager
      if (mongoConnectionManager?.mongoose?.connection?.readyState != null) {
        return mongoConnectionManager.mongoose.connection.readyState === 1;
      }
      return false;
    } catch {
      return false;
    }
  },
};

module.exports = db;

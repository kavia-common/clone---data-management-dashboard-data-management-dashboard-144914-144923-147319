/**
 * PUBLIC_INTERFACE
 * Exposes a minimal DB connection status interface to allow fast-fail behavior.
 * This file wraps the existing db.connectionManager to provide isConnected().
 */
import connectionManager from './db.connectionManager.js';

const db = {
  // PUBLIC_INTERFACE
  isConnected() {
    try {
      if (connectionManager && typeof connectionManager.isConnected === 'function') {
        return !!connectionManager.isConnected();
      }
      // Try common mongoose connection presence
      if (connectionManager?.mongoose?.connection?.readyState != null) {
        // 1 = connected, 2 = connecting; treat 1 as connected
        return connectionManager.mongoose.connection.readyState === 1;
      }
      return false;
    } catch {
      return false;
    }
  },
};

export default db;

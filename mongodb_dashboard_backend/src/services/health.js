const mongoose = require('mongoose');

class HealthService {
  // PUBLIC_INTERFACE
  getStatus() {
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    const mongoState = mongoose.connection?.readyState ?? 0;
    const dbConnected = mongoState === 1;

    return {
      status: 'ok',
      message: 'Service is healthy',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      dbConnected,
      mongoState,
    };
  }
}

module.exports = new HealthService();

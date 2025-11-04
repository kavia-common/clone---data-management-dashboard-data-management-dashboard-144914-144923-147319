const mongoose = require('mongoose');

class HealthService {
  getStatus() {
    const readyState = mongoose?.connection?.readyState ?? 0; // 0=d,1=c,2=ing,3=disc
    const db =
      readyState === 1 ? 'connected' : readyState === 2 ? 'connecting' : 'disconnected';
    const info = {
      status: 'ok',
      message: 'Service is healthy',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      host: process.env.HOST || '0.0.0.0',
      port: Number(process.env.PORT) || 3001,
      db,
    };
    if (db !== 'connected') {
      info.hint =
        'Database not connected. Service is up; DB-dependent endpoints may return 503.';
    }
    return info;
  }
}

module.exports = new HealthService();

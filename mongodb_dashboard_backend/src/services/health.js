/** PUBLIC_INTERFACE
 * HealthService
 * Pure readiness status that does not require MongoDB connectivity.
 */
class HealthService {
  getStatus() {
    return {
      status: 'ok',
      message: 'Service is healthy',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    };
  }
}

module.exports = new HealthService();

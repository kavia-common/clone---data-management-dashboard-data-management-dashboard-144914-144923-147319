const healthService = require('../services/health');

/**
 * PUBLIC_INTERFACE
 * HealthController
 * Provides basic service health information. Detailed DB health is available at GET /health/db.
 */
class HealthController {
  check(req, res) {
    const healthStatus = healthService.getStatus();
    return res.status(200).json(healthStatus);
  }
}

module.exports = new HealthController();

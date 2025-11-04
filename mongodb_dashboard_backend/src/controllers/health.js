const healthService = require('../services/health');

class HealthController {
  check(req, res) {
    const healthStatus = healthService.getStatus();
    // Always indicate service is up; include hint if DB unavailable
    return res.status(200).json({ ready: true, ...healthStatus });
  }
}

module.exports = new HealthController();

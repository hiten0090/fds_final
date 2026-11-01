const logger = require('../utils/logger');

/**
 * Middleware to log HTTP API requests and response time
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.api(`${req.method} ${req.originalUrl} - Status: ${res.statusCode} [${duration}ms]`, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });

  next();
}

module.exports = requestLogger;

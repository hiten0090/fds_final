const logger = require('../utils/logger');

/**
 * Centralized express error handler middleware
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  const errorCode = err.code || 'INTERNAL_SERVER_ERROR';

  logger.error('SYSTEM', `Error processing ${req.method} ${req.originalUrl}: ${err.message}`, err);

  let userFriendlyMessage = err.message || 'An unexpected server error occurred.';

  // Map known edge cases
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    userFriendlyMessage = 'ESP32-CAM or remote service is unreachable. Please verify WiFi and IP settings.';
  } else if (err.code === 'ETIMEDOUT') {
    userFriendlyMessage = 'Connection timed out while reaching ESP32-CAM stream or Supabase service.';
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: userFriendlyMessage,
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * 404 Route Not Found handler
 */
function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found.`,
      timestamp: new Date().toISOString()
    }
  });
}

module.exports = {
  errorHandler,
  notFoundHandler
};

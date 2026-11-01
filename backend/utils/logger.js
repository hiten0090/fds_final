/**
 * Clean Logger utility for backend system logging
 */

const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG'
};

function formatTimestamp() {
  return new Date().toISOString();
}

function log(level, category, message, meta = null) {
  const timestamp = formatTimestamp();
  const categoryTag = `[${category.toUpperCase()}]`;
  const levelTag = `[${level}]`;

  let logMessage = `${timestamp} ${levelTag} ${categoryTag} ${message}`;

  if (meta) {
    if (meta instanceof Error) {
      logMessage += ` | Error: ${meta.message}\nStack: ${meta.stack}`;
    } else if (typeof meta === 'object') {
      try {
        logMessage += ` | Details: ${JSON.stringify(meta)}`;
      } catch (err) {
        logMessage += ` | Details: [Unserializable Object]`;
      }
    } else {
      logMessage += ` | Details: ${meta}`;
    }
  }

  if (level === LOG_LEVELS.ERROR) {
    console.error(logMessage);
  } else if (level === LOG_LEVELS.WARN) {
    console.warn(logMessage);
  } else {
    console.log(logMessage);
  }
}

module.exports = {
  info: (category, message, meta) => log(LOG_LEVELS.INFO, category, message, meta),
  warn: (category, message, meta) => log(LOG_LEVELS.WARN, category, message, meta),
  error: (category, message, meta) => log(LOG_LEVELS.ERROR, category, message, meta),
  debug: (category, message, meta) => log(LOG_LEVELS.DEBUG, category, message, meta),
  camera: (message, meta, isError = false) => log(isError ? LOG_LEVELS.ERROR : LOG_LEVELS.INFO, 'CAMERA', message, meta),
  supabase: (message, meta, isError = false) => log(isError ? LOG_LEVELS.ERROR : LOG_LEVELS.INFO, 'SUPABASE', message, meta),
  stream: (message, meta, isError = false) => log(isError ? LOG_LEVELS.ERROR : LOG_LEVELS.INFO, 'STREAM', message, meta),
  api: (message, meta) => log(LOG_LEVELS.INFO, 'API', message, meta)
};

const http = require('http');
const express = require('express');
const cors = require('cors');

const config = require('./config/env.config');
const logger = require('./utils/logger');
const requestLogger = require('./middleware/logger.middleware');
const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');

const routes = require('./routes');
const { initWebSocketServer } = require('./websocket/wsServer');
const supabaseService = require('./services/supabase.service');
const cameraService = require('./services/camera.service');

// Create Express Application
const app = express();

// Configure CORS
app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// Request Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logging Middleware
app.use(requestLogger);

// Mount API Routes
app.use('/api', routes);
app.use('/', routes); // Direct root route aliases (/health, /camera/*, /fire/*)

// 404 & Error Handling Middlewares
app.use(notFoundHandler);
app.use(errorHandler);

// Create HTTP Server
const server = http.createServer(app);

// Initialize WebSocket Server
initWebSocketServer(server);

// Start HTTP Server
server.listen(config.port, async () => {
  logger.info('SERVER', `=================================================`);
  logger.info('SERVER', ` Smart Fire Detection Node.js Backend Running `);
  logger.info('SERVER', ` Environment: ${config.nodeEnv}`);
  logger.info('SERVER', ` Server URL : http://localhost:${config.port}`);
  logger.info('SERVER', ` WebSocket  : ws://localhost:${config.port}/ws`);
  logger.info('SERVER', `=================================================`);

  // Initialize Supabase Service and Realtime listener
  await supabaseService.init();
});

// Graceful Shutdown Handler
function gracefulShutdown(signal) {
  logger.warn('SERVER', `Received ${signal}. Shutting down gracefully...`);

  // Stop camera stream relay
  cameraService.stopStream(`Server shutdown via ${signal}`);

  server.close(() => {
    logger.info('SERVER', 'HTTP server closed. Exiting process.');
    process.exit(0);
  });

  // Force exit after 10s if connections hanging
  setTimeout(() => {
    logger.error('SERVER', 'Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('SERVER', 'Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('SERVER', 'Uncaught Exception:', err);
});

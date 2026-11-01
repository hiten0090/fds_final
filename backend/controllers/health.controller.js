const supabaseService = require('../services/supabase.service');
const cameraService = require('../services/camera.service');
const wsService = require('../services/websocket.service');
const config = require('../config/env.config');

/**
 * Health check controller
 */
async function getHealth(req, res, next) {
  try {
    const memoryUsage = process.memoryUsage();
    const wsStats = wsService.getWebSocketStats();
    const cameraStatus = cameraService.getStatus();
    const fireStatus = supabaseService.getFireStatus();

    res.status(200).json({
      success: true,
      service: 'smart-fire-detection-backend',
      status: 'UP',
      timestamp: new Date().toISOString(),
      uptime: `${Math.floor(process.uptime())} seconds`,
      environment: config.nodeEnv,
      system: {
        memory: {
          rssMB: Math.round(memoryUsage.rss / 1024 / 1024),
          heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024)
        }
      },
      services: {
        supabase: fireStatus.supabaseConnected ? 'CONNECTED' : 'DISCONNECTED',
        cameraRelay: cameraStatus.isStreaming ? 'STREAMING' : cameraStatus.isConnected ? 'CONNECTED' : 'IDLE',
        websocket: wsStats.serverRunning ? 'ACTIVE' : 'INACTIVE',
        connectedWebsocketClients: wsStats.totalClients
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getHealth
};

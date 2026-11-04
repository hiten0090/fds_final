const { WebSocketServer, WebSocket } = require('ws');
const logger = require('../utils/logger');

let wss = null;
const clients = new Set();

/**
 * Initialize WebSocket Server attached to HTTP server
 */
function initWebSocketServer(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  logger.info('WEBSOCKET', 'WebSocket Server initialized on path /ws');

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    clients.add(ws);
    logger.info('WEBSOCKET', `Client connected from ${clientIp}. Total connected clients: ${clients.size}`);

    // Send initial welcome message and current state ping
    ws.send(JSON.stringify({
      type: 'CONNECTION_ESTABLISHED',
      message: 'Connected to Smart Fire Detection Backend WebSocket Server',
      timestamp: new Date().toISOString()
    }));

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        logger.debug('WEBSOCKET', `Received message from client:`, message);

        if (message.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
        }
      } catch (err) {
        logger.warn('WEBSOCKET', 'Received non-JSON message from client');
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      logger.info('WEBSOCKET', `Client disconnected. Remaining active clients: ${clients.size}`);
    });

    ws.on('error', (err) => {
      logger.error('WEBSOCKET', `WebSocket client error: ${err.message}`, err);
    });
  });

  // Heartbeat ping mechanism to drop dead connections
  const interval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        clients.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  return wss;
}

/**
 * Broadcast payload to all connected clients
 */
function broadcast(eventPayload) {
  if (!wss) {
    logger.warn('WEBSOCKET', 'Attempted to broadcast before WebSocket server initialization');
    return;
  }

  const jsonMessage = JSON.stringify({
    ...eventPayload,
    timestamp: eventPayload.timestamp || new Date().toISOString()
  });

  let sentCount = 0;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(jsonMessage);
      sentCount++;
    }
  });

  logger.debug('WEBSOCKET', `Broadcasted event [${eventPayload.type}] to ${sentCount} clients`);
}

/**
 * Get active connection statistics
 */
function getStats() {
  return {
    totalClients: clients.size,
    serverRunning: wss !== null
  };
}

module.exports = {
  initWebSocketServer,
  broadcast,
  getStats
};

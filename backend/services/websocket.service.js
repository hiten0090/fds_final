const { broadcast, getStats } = require('../websocket/wsServer');
const logger = require('../utils/logger');

/**
 * Service providing high-level WebSocket notification emitters
 */
class WebSocketService {
  notifyCameraConnected(camUrl) {
    logger.info('WEBSOCKET_SERVICE', `Notifying clients: Camera Connected (${camUrl})`);
    broadcast({
      type: 'CAMERA_STATUS',
      event: 'Camera Connected',
      connected: true,
      url: camUrl
    });
  }

  notifyCameraDisconnected(reason = 'ESP32-CAM unavailable') {
    logger.warn('WEBSOCKET_SERVICE', `Notifying clients: Camera Disconnected - Reason: ${reason}`);
    broadcast({
      type: 'CAMERA_STATUS',
      event: 'Camera Disconnected',
      connected: false,
      reason
    });
  }

  notifyFireStarted(sensorData = {}) {
    logger.info('WEBSOCKET_SERVICE', 'Notifying clients: Fire Started (Emergency Popup / Alarm Trigger)');
    broadcast({
      type: 'FIRE_STATUS',
      event: 'Fire Started',
      fire_status: true,
      fire_severity: sensorData.fire_severity || 'CRITICAL',
      data: sensorData
    });
  }

  notifyFireStopped(sensorData = {}) {
    logger.info('WEBSOCKET_SERVICE', 'Notifying clients: Fire Stopped');
    broadcast({
      type: 'FIRE_STATUS',
      event: 'Fire Stopped',
      fire_status: false,
      data: sensorData
    });
  }

  notifyStreamStarted(streamEndpoint = '/camera/stream') {
    logger.info('WEBSOCKET_SERVICE', `Notifying clients: Stream Started (${streamEndpoint})`);
    broadcast({
      type: 'STREAM_STATUS',
      event: 'Stream Started',
      streaming: true,
      streamUrl: streamEndpoint
    });
  }

  notifyStreamStopped(reason = 'Fire status returned to false') {
    logger.info('WEBSOCKET_SERVICE', `Notifying clients: Stream Stopped - Reason: ${reason}`);
    broadcast({
      type: 'STREAM_STATUS',
      event: 'Stream Stopped',
      streaming: false,
      reason
    });
  }

  notifySmsStatus(smsPayload = {}) {
    logger.info('WEBSOCKET_SERVICE', `Notifying clients: SMS Status (${smsPayload.status || 'STATUS_UPDATE'})`);
    broadcast({
      type: 'SMS_STATUS',
      ...smsPayload
    });
  }

  broadcast(payload) {
    broadcast(payload);
  }

  getWebSocketStats() {
    return getStats();
  }
}

module.exports = new WebSocketService();

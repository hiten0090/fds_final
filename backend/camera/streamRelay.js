const http = require('http');
const https = require('https');
const { URL } = require('url');
const config = require('../config/env.config');
const logger = require('../utils/logger');
const wsService = require('../services/websocket.service');

class CameraStreamRelay {
  constructor() {
    this.activeClients = new Set();
    this.upstreamRequest = null;
    this.upstreamResponse = null;
    this.isStreaming = false;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.boundary = 'frame'; // default boundary for MJPEG
  }

  /**
   * Start upstream stream connection to ESP32-CAM
   */
  startStream(targetUrl = config.camera.url) {
    if (this.isStreaming && this.upstreamRequest) {
      logger.camera('Stream relay is already running');
      return true;
    }

    logger.camera(`Connecting to ESP32-CAM stream at ${targetUrl}...`);

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (err) {
      logger.camera(`Invalid ESP32-CAM URL: ${targetUrl}`, err, true);
      wsService.notifyCameraDisconnected('Invalid URL configuration');
      return false;
    }

    const clientLib = parsedUrl.protocol === 'https:' ? https : http;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      timeout: config.camera.timeoutMs,
      headers: {
        'User-Agent': 'NodeJS-SmartFireDetection-Relay/1.0',
        'Accept': '*/*'
      }
    };

    this.upstreamRequest = clientLib.get(requestOptions, (res) => {
      if (res.statusCode !== 200) {
        logger.camera(`ESP32-CAM returned non-200 status code: ${res.statusCode}`, null, true);
        this._handleUpstreamFailure(`HTTP Status ${res.statusCode}`);
        return;
      }

      this.isConnected = true;
      this.isStreaming = true;
      this.upstreamResponse = res;

      // Extract boundary from Content-Type header if available
      const contentType = res.headers['content-type'] || '';
      if (contentType.includes('boundary=')) {
        const match = contentType.match(/boundary=([^;]+)/i);
        if (match && match[1]) {
          this.boundary = match[1].replace(/['"]/g, '').trim();
        }
      }

      logger.camera(`Successfully connected to ESP32-CAM stream. Content-Type: ${contentType}, Boundary: ${this.boundary}`);
      wsService.notifyCameraConnected(targetUrl);
      wsService.notifyStreamStarted('/camera/stream');

      // Forward incoming stream chunks to all active client responses
      res.on('data', (chunk) => {
        this._broadcastChunk(chunk);
      });

      res.on('end', () => {
        logger.camera('ESP32-CAM stream ended by target server');
        this._handleUpstreamFailure('Stream ended by camera');
      });

      res.on('error', (err) => {
        logger.camera(`ESP32-CAM response error: ${err.message}`, err, true);
        this._handleUpstreamFailure(err.message);
      });
    });

    this.upstreamRequest.on('timeout', () => {
      logger.camera('ESP32-CAM connection timeout', null, true);
      this.upstreamRequest.destroy();
      this._handleUpstreamFailure('Connection timeout');
    });

    this.upstreamRequest.on('error', (err) => {
      logger.camera(`ESP32-CAM request error: ${err.message}`, err, true);
      this._handleUpstreamFailure(err.message);
    });

    return true;
  }

  /**
   * Stop upstream stream relay
   */
  stopStream(reason = 'Manual stop') {
    logger.camera(`Stopping stream relay: ${reason}`);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.upstreamRequest) {
      this.upstreamRequest.destroy();
      this.upstreamRequest = null;
    }

    if (this.upstreamResponse) {
      this.upstreamResponse.destroy();
      this.upstreamResponse = null;
    }

    const wasStreaming = this.isStreaming;
    this.isStreaming = false;
    this.isConnected = false;

    // Close all connected client responses cleanly
    this.activeClients.forEach((clientRes) => {
      try {
        clientRes.end();
      } catch (err) {
        // Ignored
      }
    });
    this.activeClients.clear();

    if (wasStreaming) {
      wsService.notifyStreamStopped(reason);
      wsService.notifyCameraDisconnected(reason);
    }
  }

  /**
   * Register client HTTP response to receive MJPEG stream
   */
  addClient(req, res) {
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${this.boundary}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate, pre-check=0, post-check=0, max-age=0',
      'Pragma': 'no-cache',
      'Connection': 'close',
      'Expires': '0'
    });

    this.activeClients.add(res);
    logger.camera(`Client subscribed to camera stream. Active clients: ${this.activeClients.size}`);

    // Auto start stream if not currently streaming
    if (!this.isStreaming) {
      this.startStream();
    }

    req.on('close', () => {
      this.activeClients.delete(res);
      logger.camera(`Client unsubscribed from camera stream. Remaining clients: ${this.activeClients.size}`);

      // If no clients remain and no active fire, can optionally auto stop or stay ready
    });
  }

  /**
   * Helper to broadcast stream buffer chunk to clients
   */
  _broadcastChunk(chunk) {
    this.activeClients.forEach((clientRes) => {
      try {
        clientRes.write(chunk);
      } catch (err) {
        logger.camera(`Error writing frame to client response: ${err.message}`, err, true);
        this.activeClients.delete(clientRes);
      }
    });
  }

  /**
   * Internal failure handling & auto reconnection
   */
  _handleUpstreamFailure(reason) {
    const wasConnected = this.isConnected;
    this.isConnected = false;
    this.isStreaming = false;

    if (wasConnected) {
      wsService.notifyCameraDisconnected(reason);
      wsService.notifyStreamStopped(reason);
    }

    if (this.upstreamRequest) {
      this.upstreamRequest.destroy();
      this.upstreamRequest = null;
    }

    this.upstreamResponse = null;

    // Schedule auto reconnect if clients are active or system demands streaming
    if (this.activeClients.size > 0 && !this.reconnectTimer) {
      logger.camera(`Scheduling auto-reconnect in ${config.camera.reconnectIntervalMs}ms...`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.activeClients.size > 0 && !this.isStreaming) {
          logger.camera('Attempting auto-reconnect to ESP32-CAM...');
          this.startStream();
        }
      }, config.camera.reconnectIntervalMs);
    }
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      isStreaming: this.isStreaming,
      activeClients: this.activeClients.size,
      targetUrl: config.camera.url,
      boundary: this.boundary
    };
  }
}

module.exports = new CameraStreamRelay();

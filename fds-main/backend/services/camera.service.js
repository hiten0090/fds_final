const streamRelay = require('../camera/streamRelay');
const logger = require('../utils/logger');
const config = require('../config/env.config');
const axios = require('axios');

class CameraService {
  /**
   * Start video stream relay from ESP32-CAM
   */
  async startStream(customUrl = null) {
    const url = customUrl || config.camera.url;
    logger.camera(`CameraService: Requested start stream at ${url}`);
    const success = streamRelay.startStream(url);
    return {
      success,
      message: success ? 'Camera stream relay initiated' : 'Failed to initiate camera stream relay',
      status: streamRelay.getStatus()
    };
  }

  /**
   * Stop video stream relay
   */
  async stopStream(reason = 'API request') {
    logger.camera(`CameraService: Requested stop stream. Reason: ${reason}`);
    streamRelay.stopStream(reason);
    return {
      success: true,
      message: 'Camera stream relay stopped',
      status: streamRelay.getStatus()
    };
  }

  /**
   * Pipe stream output directly to Express HTTP Response
   */
  pipeStream(req, res) {
    streamRelay.addClient(req, res);
  }

  /**
   * Check status of camera service
   */
  getStatus() {
    return streamRelay.getStatus();
  }

  /**
   * Perform ping/health check on ESP32-CAM URL endpoint
   */
  async checkCameraConnectivity(targetUrl = config.camera.url) {
    try {
      const response = await axios.head(targetUrl, { timeout: 3000 });
      return {
        online: response.status >= 200 && response.status < 400,
        statusCode: response.status,
        url: targetUrl
      };
    } catch (err) {
      return {
        online: false,
        error: err.message,
        url: targetUrl
      };
    }
  }
}

module.exports = new CameraService();

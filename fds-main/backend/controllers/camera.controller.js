const cameraService = require('../services/camera.service');

/**
 * GET /camera/status
 * Get current ESP32-CAM connection and relay status
 */
async function getCameraStatus(req, res, next) {
  try {
    const status = cameraService.getStatus();
    const connectivity = await cameraService.checkCameraConnectivity();

    res.status(200).json({
      success: true,
      data: {
        relayStatus: status,
        cameraPing: connectivity
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /camera/start
 * Manually start camera stream relay
 */
async function startCameraStream(req, res, next) {
  try {
    const { url } = req.body || {};
    const result = await cameraService.startStream(url);

    res.status(200).json({
      success: result.success,
      message: result.message,
      data: result.status
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /camera/stop
 * Manually stop camera stream relay
 */
async function stopCameraStream(req, res, next) {
  try {
    const { reason } = req.body || {};
    const result = await cameraService.stopStream(reason || 'Manual API Request');

    res.status(200).json({
      success: result.success,
      message: result.message,
      data: result.status
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /camera/stream
 * Serves live MJPEG stream to frontend clients (<img src="/camera/stream" />)
 */
function getCameraStream(req, res) {
  cameraService.pipeStream(req, res);
}

module.exports = {
  getCameraStatus,
  startCameraStream,
  stopCameraStream,
  getCameraStream
};

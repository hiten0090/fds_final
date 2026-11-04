const express = require('express');
const router = express.Router();
const cameraController = require('../controllers/camera.controller');

// GET /camera/status
router.get('/status', cameraController.getCameraStatus);

// POST /camera/start
router.post('/start', cameraController.startCameraStream);

// POST /camera/stop
router.post('/stop', cameraController.stopCameraStream);

// GET /camera/stream
router.get('/stream', cameraController.getCameraStream);

module.exports = router;

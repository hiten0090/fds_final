const express = require('express');
const router = express.Router();

const healthRoutes = require('./health.routes');
const cameraRoutes = require('./camera.routes');
const fireRoutes = require('./fire.routes');
const smsRoutes = require('./sms.routes');

// Root API Health route
router.use('/health', healthRoutes);

// Camera management and stream routes
router.use('/camera', cameraRoutes);

// Fire status routes
router.use('/fire', fireRoutes);

// SMS emergency alert routes
router.use('/sms', smsRoutes);

module.exports = router;

const express = require('express');
const router = express.Router();

const healthRoutes = require('./health.routes');
const cameraRoutes = require('./camera.routes');
const fireRoutes = require('./fire.routes');

// Root API Health route
router.use('/health', healthRoutes);

// Camera management and stream routes
router.use('/camera', cameraRoutes);

// Fire status routes
router.use('/fire', fireRoutes);

module.exports = router;

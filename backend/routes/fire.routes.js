const express = require('express');
const router = express.Router();
const fireController = require('../controllers/fire.controller');

// GET /fire/status & /fire/table
router.get('/status', fireController.getFireStatus);
router.get('/table', fireController.getSensorDataTable);

// POST /fire/sensor-data (ESP32 hardware telemetry endpoint)
router.post('/sensor-data', fireController.receiveHardwareSensorData);

module.exports = router;

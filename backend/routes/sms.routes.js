// backend/routes/sms.routes.js
// Express router for SMS status, testing, and emergency contact configuration

const express = require('express');
const router = express.Router();
const smsController = require('../controllers/sms.controller');

// GET /api/sms/status
router.get('/status', smsController.getSmsStatus);

// POST /api/sms/config - Update emergency contact
router.post('/config', smsController.updateSmsConfig);

// POST /api/sms/test - Trigger manual test alert (mock/live)
router.post('/test', smsController.sendTestAlert);

// POST /api/sms/send - Programmatic dispatch
router.post('/send', smsController.sendAlert);

module.exports = router;


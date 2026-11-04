const express = require('express');
const router = express.Router();
const fireController = require('../controllers/fire.controller');

// GET /fire/status
router.get('/status', fireController.getFireStatus);

module.exports = router;

// backend/controllers/sms.controller.js
// Handles SMS status, configuration, and manual alert test requests

const smsService = require('../services/sms.service');
const supabaseService = require('../services/supabase.service');

/**
 * GET /api/sms/status
 * Return current SMS service state, active mode, and masked recipient
 */
async function getSmsStatus(req, res, next) {
  try {
    const status = smsService.getStatus();
    res.status(200).json({
      success: true,
      data: status
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/sms/config
 * Update the emergency contact phone number and provider configuration
 */
async function updateSmsConfig(req, res, next) {
  try {
    const { phone, mode, provider, apiKey, apiSecret, senderId } = req.body || {};
    if (!phone && !mode && !provider && !apiKey) {
      return res.status(400).json({
        success: false,
        error: 'At least one configuration parameter (phone, mode, provider, apiKey) is required.'
      });
    }

    const result = smsService.updateConfig({ phone, mode, provider, apiKey, apiSecret, senderId });
    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json({
      success: true,
      message: 'Emergency SMS configuration updated successfully.',
      data: result.data
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/sms/test
 * Manually trigger a test SMS alert (mock or live)
 */
async function sendTestAlert(req, res, next) {
  try {
    const { phone, facilityLocation } = req.body || {};

    // Get latest real sensor data from Supabase if available
    let latestData = {};
    try {
      latestData = (await supabaseService.getLatestSensorData()) || {};
    } catch (e) {
      // fallback
    }

    const result = await smsService.sendFireEmergencyAlert(
      latestData,
      facilityLocation || {},
      {
        forceSend: true,
        phone: phone || undefined
      }
    );

    res.status(200).json({
      success: result.success,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/sms/send
 * Dispatch SMS alert with payload
 */
async function sendAlert(req, res, next) {
  try {
    const { sensorData, facilityLocation, phone, options } = req.body || {};

    const result = await smsService.sendFireEmergencyAlert(
      sensorData || {},
      facilityLocation || {},
      {
        phone,
        ...(options || {})
      }
    );

    res.status(200).json({
      success: result.success,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSmsStatus,
  updateSmsConfig,
  sendTestAlert,
  sendAlert
};


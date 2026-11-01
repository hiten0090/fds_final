// backend/services/sms.service.js
// Modular Emergency SMS Service for FireGuard (Supports Mock Mode, Duplicate Suppression, and Provider Adapters)

const axios = require('axios');
const config = require('../config/env.config');
const logger = require('../utils/logger');
const wsService = require('./websocket.service');

// Status constants
const SMS_STATUS = {
  SIMULATED: 'SIMULATED — SMS NOT SENT',
  PENDING: 'PENDING',
  SENT: 'SENT — PROVIDER ACCEPTED',
  DELIVERED: 'DELIVERED — PROVIDER CONFIRMED DELIVERY',
  FAILED: 'FAILED'
};

/**
 * Validates a single phone number, supporting Indian mobile numbers
 * @param {string} phone
 * @returns {{ valid: boolean, formatted: string, error?: string }}
 */
function validateSinglePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, formatted: '', error: 'Phone number is required.' };
  }

  const cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // Format 1: +91XXXXXXXXXX
  if (/^\+91[6-9]\d{9}$/.test(cleaned)) {
    return { valid: true, formatted: cleaned };
  }

  // Format 2: 91XXXXXXXXXX (without plus)
  if (/^91[6-9]\d{9}$/.test(cleaned)) {
    return { valid: true, formatted: `+${cleaned}` };
  }

  // Format 3: 10-digit Indian mobile starting with 6, 7, 8, or 9
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return { valid: true, formatted: `+91${cleaned}` };
  }

  // Format 4: International numbers with country code (e.g. +1XXXXXXXXXX)
  if (/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    return { valid: true, formatted: cleaned };
  }

  return {
    valid: false,
    formatted: '',
    error: `Invalid phone format for "${phone}". Use a 10-digit Indian mobile number or +91XXXXXXXXXX.`
  };
}

/**
 * Validates one or multiple phone numbers separated by comma, semicolon, or newline
 * @param {string} input
 * @returns {{ valid: boolean, formattedList: string[], formatted: string, error?: string }}
 */
function validateIndianPhoneNumbers(input) {
  if (!input || typeof input !== 'string') {
    return { valid: false, formattedList: [], formatted: '', error: 'Phone number is required.' };
  }

  const rawList = input.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (rawList.length === 0) {
    return { valid: false, formattedList: [], formatted: '', error: 'At least one phone number is required.' };
  }

  const formattedList = [];
  for (const raw of rawList) {
    const res = validateSinglePhoneNumber(raw);
    if (!res.valid) {
      return { valid: false, formattedList: [], formatted: '', error: res.error };
    }
    if (!formattedList.includes(res.formatted)) {
      formattedList.push(res.formatted);
    }
  }

  return { valid: true, formattedList, formatted: formattedList.join(', ') };
}

// Alias for backwards compatibility
const validateIndianPhoneNumber = validateIndianPhoneNumbers;

/**
 * Safely masks one or multiple phone numbers for logging and UI display
 * e.g. +919876543210, +919812345678 -> +91 98*** ***10, +91 98*** ***78
 */
function maskPhoneNumber(phone) {
  if (!phone) return 'Not Configured';
  const list = String(phone).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return 'Not Configured';

  return list.map((num) => {
    if (num.length < 7) return '******';
    const prefix = num.slice(0, 5);
    const suffix = num.slice(-2);
    return `${prefix}*** ***${suffix}`;
  }).join(', ');
}

class SmsService {
  constructor() {
    this.mode = (process.env.SMS_MODE || config.sms?.mode || 'mock').toLowerCase();
    this.provider = (process.env.SMS_PROVIDER || config.sms?.provider || 'mock').toLowerCase();
    this.apiKey = process.env.SMS_API_KEY || config.sms?.apiKey || '';
    this.apiSecret = process.env.SMS_API_SECRET || config.sms?.apiSecret || '';
    this.senderId = process.env.SMS_SENDER || config.sms?.senderId || 'FIREGD';
    this.recipientPhone = process.env.EMERGENCY_PHONE || config.sms?.emergencyPhone || '';

    // Active status & history tracking
    this.lastAlertStatus = this.mode === 'mock' ? SMS_STATUS.SIMULATED : SMS_STATUS.PENDING;
    this.lastAlertTime = null;
    this.lastIncidentId = null;
    this.lastSentMessage = null;

    // Cooldown window (milliseconds) to prevent duplicate SMS flooding during continuous fire
    this.duplicateCooldownMs = parseInt(process.env.SMS_COOLDOWN_MS || '300000', 10); // 5 minutes default
  }

  /**
   * Returns current status information
   */
  getStatus() {
    return {
      mode: this.mode,
      provider: this.provider,
      recipientConfigured: Boolean(this.recipientPhone),
      recipientMasked: maskPhoneNumber(this.recipientPhone),
      lastAlertStatus: this.lastAlertStatus,
      lastAlertTime: this.lastAlertTime,
      lastMessagePreview: this.lastSentMessage,
      duplicateCooldownMs: this.duplicateCooldownMs
    };
  }

  /**
   * Update emergency recipient phone number(s) at runtime
   * Supports single or multiple comma/semicolon-separated numbers
   */
  updateRecipient(phone) {
    const val = validateIndianPhoneNumbers(phone);
    if (!val.valid) {
      return { success: false, error: val.error };
    }

    this.recipientPhone = val.formatted;
    logger.info('SMS_SERVICE', `Updated emergency recipients to ${maskPhoneNumber(this.recipientPhone)}`);
    return {
      success: true,
      recipient: this.recipientPhone,
      recipientList: val.formattedList,
      masked: maskPhoneNumber(this.recipientPhone)
    };
  }

  /**
   * Update SMS configuration (phone, mode, provider, apiKey) at runtime
   */
  updateConfig({ phone, mode, provider, apiKey, apiSecret, senderId }) {
    if (phone) {
      const val = validateIndianPhoneNumbers(phone);
      if (!val.valid) {
        return { success: false, error: val.error };
      }
      this.recipientPhone = val.formatted;
    }
    if (mode && (mode === 'mock' || mode === 'live')) {
      this.mode = mode.toLowerCase();
    }
    if (provider) {
      this.provider = provider.toLowerCase();
    }
    if (typeof apiKey === 'string' && apiKey.trim()) {
      this.apiKey = apiKey.trim();
    }
    if (typeof apiSecret === 'string') {
      this.apiSecret = apiSecret.trim();
    }
    if (typeof senderId === 'string' && senderId.trim()) {
      this.senderId = senderId.trim();
    }

    logger.info(
      'SMS_SERVICE',
      `Updated SMS configuration: mode=${this.mode}, provider=${this.provider}, recipient=${maskPhoneNumber(this.recipientPhone)}`
    );
    return {
      success: true,
      data: this.getStatus()
    };
  }

  /**
   * Formats SMS dispatch body using available real sensor and facility telemetry
   * Omits missing fields; never invents values.
   */
  buildMessageBody(sensorData = {}, facilityLocation = {}) {
    const facilityName = facilityLocation.facilityName || 'FireGuard Monitored Facility';
    const lines = [];

    lines.push(`🚨 FIREGUARD EMERGENCY ALERT: Fire detected at ${facilityName}!`);

    // Real Sensor telemetry details
    const sensorDetails = [];
    if (sensorData.temperature !== null && sensorData.temperature !== undefined) {
      const t = parseFloat(sensorData.temperature);
      if (!isNaN(t)) sensorDetails.push(`Temp: ${t.toFixed(1)}°C`);
    }

    const rawGas = sensorData.gas_value ?? sensorData.smoke ?? sensorData.gas;
    if (rawGas !== null && rawGas !== undefined) {
      const s = parseFloat(rawGas);
      if (!isNaN(s)) sensorDetails.push(`Smoke: ${s.toFixed(0)} PPM`);
    }

    if (sensorData.flame_state !== null && sensorData.flame_state !== undefined) {
      sensorDetails.push(`Flame: ${sensorData.flame_state === 1 ? 'DETECTED' : 'NORMAL'}`);
    } else if (sensorData.flame !== null && sensorData.flame !== undefined) {
      sensorDetails.push(`Flame: ${sensorData.flame ? 'DETECTED' : 'NORMAL'}`);
    }

    if (sensorDetails.length > 0) {
      lines.push(`Telemetry: ${sensorDetails.join(' | ')}`);
    }

    // Event Timestamp
    const ts = sensorData.timestamp || sensorData.created_at || new Date().toISOString();
    lines.push(`Time: ${new Date(ts).toLocaleTimeString()}`);

    // Real Location & Google Maps Link (if available)
    if (facilityLocation.address) {
      lines.push(`Address: ${facilityLocation.address}`);
    }
    if (facilityLocation.mapsUrl) {
      lines.push(`Map: ${facilityLocation.mapsUrl}`);
    } else if (typeof facilityLocation.latitude === 'number' && typeof facilityLocation.longitude === 'number') {
      lines.push(`Map: https://www.google.com/maps/search/?api=1&query=${facilityLocation.latitude}%2C${facilityLocation.longitude}`);
    }

    lines.push(`ACTION: Evacuate area immediately and contact emergency response (112/101).`);

    return lines.join('\n');
  }

  /**
   * Core dispatch function for sending fire emergency alert
   * Handles duplicate protection, mock mode, and provider integrations
   */
  async sendFireEmergencyAlert(sensorData = {}, facilityLocation = {}, options = {}) {
    const forceSend = Boolean(options.forceSend);
    const incidentId = sensorData.id || sensorData.incidentId || null;
    const now = Date.now();

    // Duplicate Alert Protection:
    // If not forced, check whether we recently dispatched an alert for the same ongoing incident
    if (!forceSend && this.lastAlertTime) {
      const elapsed = now - new Date(this.lastAlertTime).getTime();
      if (elapsed < this.duplicateCooldownMs) {
        logger.info('SMS_SERVICE', `Duplicate alert suppressed. Cooldown active (${Math.round((this.duplicateCooldownMs - elapsed) / 1000)}s remaining)`);
        return {
          success: true,
          duplicateSuppressed: true,
          status: this.lastAlertStatus,
          message: 'Duplicate alert suppressed by active cooldown.'
        };
      }
    }

    // Validate recipient(s)
    const recipient = options.phone || this.recipientPhone;
    const valPhones = validateIndianPhoneNumbers(recipient);
    if (!valPhones.valid) {
      const err = `Emergency alert not sent: ${valPhones.error}`;
      logger.warn('SMS_SERVICE', err);
      this.lastAlertStatus = SMS_STATUS.FAILED;
      this._broadcastStatus(SMS_STATUS.FAILED, err);
      return { success: false, status: SMS_STATUS.FAILED, error: err };
    }

    const targetPhones = valPhones.formattedList;
    const targetPhoneFormatted = valPhones.formatted;
    const messageBody = this.buildMessageBody(sensorData, facilityLocation);

    this.lastAlertTime = new Date().toISOString();
    this.lastIncidentId = incidentId;
    this.lastSentMessage = messageBody;

    // 1. MOCK MODE (Safe development mode - no credentials needed, no SMS sent)
    if (this.mode === 'mock') {
      logger.info('SMS_SERVICE', '=================================================');
      logger.info('SMS_SERVICE', ' [SMS TEST MODE - SIMULATED DISPATCH]           ');
      logger.info('SMS_SERVICE', ` Recipients (${targetPhones.length}): ${maskPhoneNumber(targetPhoneFormatted)}`);
      logger.info('SMS_SERVICE', ` Target List: ${targetPhones.join(', ')}`);
      logger.info('SMS_SERVICE', ` Provider   : Mock Simulator (SMS_MODE=mock)     `);
      logger.info('SMS_SERVICE', ` Status     : ${SMS_STATUS.SIMULATED}             `);
      logger.info('SMS_SERVICE', ` Content    :\n${messageBody}                    `);
      logger.info('SMS_SERVICE', '=================================================');

      this.lastAlertStatus = SMS_STATUS.SIMULATED;
      this._broadcastStatus(
        SMS_STATUS.SIMULATED,
        `Simulated alert logged for ${targetPhones.length} contact(s): ${maskPhoneNumber(targetPhoneFormatted)}`
      );

      return {
        success: true,
        mock: true,
        status: SMS_STATUS.SIMULATED,
        recipient: maskPhoneNumber(targetPhoneFormatted),
        recipientCount: targetPhones.length,
        message: 'SIMULATED — SMS NOT SENT. Real provider disabled in mock mode.',
        body: messageBody,
        timestamp: this.lastAlertTime
      };
    }

    // 2. LIVE PROVIDER DISPATCH
    this.lastAlertStatus = SMS_STATUS.PENDING;
    this._broadcastStatus(
      SMS_STATUS.PENDING,
      `Sending SMS alert to ${targetPhones.length} recipient(s) [${maskPhoneNumber(targetPhoneFormatted)}] via ${this.provider}`
    );

    try {
      let dispatchResult = null;

      if (this.provider === 'fast2sms') {
        dispatchResult = await this._sendViaFast2Sms(targetPhones, messageBody);
      } else if (this.provider === 'msg91') {
        dispatchResult = await this._sendViaMsg91(targetPhones, messageBody);
      } else if (this.provider === 'twilio') {
        dispatchResult = await this._sendViaTwilio(targetPhones, messageBody);
      } else {
        throw new Error(`Unsupported SMS provider: ${this.provider}. Configure fast2sms, msg91, twilio, or switch to mock mode.`);
      }

      this.lastAlertStatus = SMS_STATUS.SENT;
      this._broadcastStatus(SMS_STATUS.SENT, `SMS accepted by provider (${this.provider}) for ${targetPhones.length} contact(s)`);

      return {
        success: true,
        status: SMS_STATUS.SENT,
        provider: this.provider,
        recipient: maskPhoneNumber(targetPhoneFormatted),
        recipientCount: targetPhones.length,
        providerResponse: dispatchResult
      };
    } catch (err) {
      logger.error('SMS_SERVICE', `Failed to send live SMS via ${this.provider}:`, err);
      this.lastAlertStatus = SMS_STATUS.FAILED;
      this._broadcastStatus(SMS_STATUS.FAILED, `Failed: ${err.message}`);

      return {
        success: false,
        status: SMS_STATUS.FAILED,
        error: err.message,
        provider: this.provider
      };
    }
  }

  // --- Live Provider Adapters (REST API) ---

  async _sendViaFast2Sms(phoneList, message) {
    if (!this.apiKey) {
      throw new Error('Fast2SMS API Key is missing in backend configuration (SMS_API_KEY).');
    }

    // Fast2SMS accepts comma-separated 10-digit Indian numbers without +91
    const phones = Array.isArray(phoneList) ? phoneList : [phoneList];
    const rawNumbers = phones.map((p) => p.replace('+91', '').trim()).join(',');

    // Route 'q' is Quick SMS (immediate delivery without requiring DLT approval)
    const route = process.env.FAST2SMS_ROUTE || 'q';
    const requestPayload = {
      route: route,
      message: message,
      language: 'english',
      flash: 0,
      numbers: rawNumbers
    };

    if (route !== 'q' && this.senderId) {
      requestPayload.sender_id = this.senderId;
    }

    const response = await axios.post(
      'https://www.fast2sms.com/dev/bulkV2',
      requestPayload,
      {
        headers: {
          authorization: this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    if (response.data && response.data.return === false) {
      const detail = Array.isArray(response.data.message)
        ? response.data.message.join(', ')
        : (response.data.message || 'Fast2SMS dispatch rejected');
      throw new Error(`Fast2SMS: ${detail}`);
    }

    return response.data;
  }

  async _sendViaMsg91(phoneList, message) {
    if (!this.apiKey) {
      throw new Error('Msg91 Auth Key is missing in backend configuration (SMS_API_KEY).');
    }

    const phones = Array.isArray(phoneList) ? phoneList : [phoneList];
    const recipients = phones.map((p) => ({
      mobiles: p.replace('+', '').trim(),
      message: message
    }));

    const response = await axios.post(
      'https://api.msg91.com/api/v5/flow/',
      {
        template_id: process.env.MSG91_TEMPLATE_ID || '',
        short_url: '0',
        recipients: recipients
      },
      {
        headers: {
          authkey: this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    return response.data;
  }

  async _sendSingleTwilio(phone, message) {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Twilio Account SID (SMS_API_KEY) or Auth Token (SMS_API_SECRET) missing.');
    }

    const accountSid = this.apiKey;
    const authToken = this.apiSecret;
    const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const params = new URLSearchParams();
    params.append('To', phone);
    params.append('From', this.senderId);
    params.append('Body', message);

    const response = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      params.toString(),
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );

    return response.data;
  }

  async _sendViaTwilio(phoneList, message) {
    const phones = Array.isArray(phoneList) ? phoneList : [phoneList];
    const results = await Promise.allSettled(
      phones.map((p) => this._sendSingleTwilio(p, message))
    );
    const rejected = results.filter((r) => r.status === 'rejected');
    if (rejected.length === phones.length) {
      throw new Error(rejected[0].reason?.message || 'Twilio failed to send to all recipients');
    }
    return results.map((r) => (r.status === 'fulfilled' ? r.value : { error: r.reason?.message }));
  }

  _broadcastStatus(status, details) {
    try {
      wsService.broadcast({
        type: 'SMS_STATUS',
        status: status,
        recipient: maskPhoneNumber(this.recipientPhone),
        details: details,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      // safe fallback
    }
  }
}

module.exports = new SmsService();


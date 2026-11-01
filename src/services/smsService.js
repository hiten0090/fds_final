// src/services/smsService.js
// Frontend client for FireGuard Emergency SMS Alert system

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const STORAGE_KEY = 'fireguard_emergency_phone';

export const SMS_STATUS = {
  SIMULATED: 'SIMULATED — SMS NOT SENT',
  PENDING: 'PENDING',
  SENT: 'SENT — PROVIDER ACCEPTED',
  DELIVERED: 'DELIVERED — PROVIDER CONFIRMED DELIVERY',
  FAILED: 'FAILED'
};

/**
 * Validates a single Indian or international mobile number
 * @param {string} phone
 * @returns {{ valid: boolean, formatted: string, error?: string }}
 */
function validateSinglePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, formatted: '', error: 'Phone number is required.' };
  }

  const cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // +91XXXXXXXXXX
  if (/^\+91[6-9]\d{9}$/.test(cleaned)) {
    return { valid: true, formatted: cleaned };
  }

  // 91XXXXXXXXXX
  if (/^91[6-9]\d{9}$/.test(cleaned)) {
    return { valid: true, formatted: `+${cleaned}` };
  }

  // 10-digit Indian mobile
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return { valid: true, formatted: `+91${cleaned}` };
  }

  // International format
  if (/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    return { valid: true, formatted: cleaned };
  }

  return {
    valid: false,
    formatted: '',
    error: `Invalid number "${phone}". Use a 10-digit Indian mobile or +91XXXXXXXXXX.`
  };
}

/**
 * Validates one or multiple phone numbers separated by comma, semicolon, or newline
 * @param {string} input
 * @returns {{ valid: boolean, formattedList: string[], formatted: string, error?: string }}
 */
export function validatePhoneNumber(input) {
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

/**
 * Masks one or multiple phone numbers for safe display
 * e.g. +919876543210, +919812345678 -> +91 98*** ***10, +91 98*** ***78
 */
export function maskPhone(phone) {
  if (!phone) return 'Not Configured';
  const list = String(phone).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return 'Not Configured';

  return list
    .map((num) => {
      if (num.length < 7) return '******';
      const prefix = num.slice(0, 5);
      const suffix = num.slice(-2);
      return `${prefix}*** ***${suffix}`;
    })
    .join(', ');
}

class SmsService {
  constructor() {
    this.statusListeners = new Set();
    this.currentStatus = {
      mode: 'mock',
      provider: 'mock',
      recipientConfigured: false,
      recipientMasked: 'Not Configured',
      lastAlertStatus: SMS_STATUS.SIMULATED,
      lastAlertTime: null,
      lastMessagePreview: null
    };

    // Load locally saved fallback recipient if present
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        this.currentStatus.recipientConfigured = true;
        this.currentStatus.recipientMasked = maskPhone(saved);
      }
    } catch (e) {
      // safe fallback
    }
  }

  /**
   * Fetch live SMS status from backend
   */
  async fetchStatus() {
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/api/sms/status`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          this.currentStatus = {
            ...this.currentStatus,
            ...json.data
          };
          this._notify();
          return this.currentStatus;
        }
      }
    } catch (err) {
      console.warn('[SmsService] Could not reach backend SMS endpoint:', err);
    }
    return this.currentStatus;
  }

  /**
   * Update emergency recipient phone number
   */
  async updateRecipient(phone) {
    const val = validatePhoneNumber(phone);
    if (!val.valid) {
      return { success: false, error: val.error };
    }

    try {
      localStorage.setItem(STORAGE_KEY, val.formatted);
      this.currentStatus.recipientConfigured = true;
      this.currentStatus.recipientMasked = maskPhone(val.formatted);
      this._notify();

      const res = await fetch(`${BACKEND_BASE_URL}/api/sms/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: val.formatted })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          await this.fetchStatus();
          return { success: true, masked: this.currentStatus.recipientMasked };
        }
      }
    } catch (err) {
      console.warn('[SmsService] Could not update recipient on backend:', err);
    }

    // Returns local success even if backend is offline
    return {
      success: true,
      masked: maskPhone(val.formatted),
      note: 'Saved locally in browser.'
    };
  }

  /**
   * Update full SMS configuration (mode, provider, apiKey, phone)
   */
  async updateConfig(configObj = {}) {
    try {
      if (configObj.phone) {
        localStorage.setItem(STORAGE_KEY, configObj.phone);
      }

      const res = await fetch(`${BACKEND_BASE_URL}/api/sms/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configObj)
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          this.currentStatus = {
            ...this.currentStatus,
            ...json.data
          };
          this._notify();
          return { success: true, data: this.currentStatus };
        }
      }
    } catch (err) {
      console.warn('[SmsService] Could not update config on backend:', err);
    }

    return { success: false, error: 'Could not contact backend server.' };
  }

  /**
   * Trigger a test SMS alert (simulated in mock mode)
   */
  async sendTestAlert(facilityLocation = {}) {
    try {
      const localPhone = localStorage.getItem(STORAGE_KEY) || undefined;
      const res = await fetch(`${BACKEND_BASE_URL}/api/sms/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: localPhone,
          facilityLocation
        })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          this.currentStatus.lastAlertStatus = json.data.status || SMS_STATUS.SIMULATED;
          this.currentStatus.lastAlertTime = json.data.timestamp || new Date().toISOString();
          this.currentStatus.lastMessagePreview = json.data.body || json.data.message;
          this._notify();
          return json.data;
        }
      }
    } catch (err) {
      console.warn('[SmsService] Test alert dispatch failed:', err);
    }

    // Mock fallback if backend offline
    const mockResult = {
      success: true,
      mock: true,
      status: SMS_STATUS.SIMULATED,
      message: 'SIMULATED — SMS NOT SENT. Real provider disabled in mock mode.',
      timestamp: new Date().toISOString()
    };
    this.currentStatus.lastAlertStatus = SMS_STATUS.SIMULATED;
    this.currentStatus.lastAlertTime = mockResult.timestamp;
    this._notify();
    return mockResult;
  }

  /**
   * Automatically dispatch emergency SMS alert on confirmed fire incident
   * Called by App.jsx whenever fire status becomes active
   */
  async sendEmergencyAlert(sensorData = {}, facilityLocation = {}, options = {}) {
    try {
      const localPhone = localStorage.getItem(STORAGE_KEY) || undefined;
      const res = await fetch(`${BACKEND_BASE_URL}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: options.phone || localPhone,
          sensorData,
          facilityLocation,
          options
        })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          this.currentStatus.lastAlertStatus = json.data.status || SMS_STATUS.SIMULATED;
          this.currentStatus.lastAlertTime = json.data.timestamp || new Date().toISOString();
          this.currentStatus.lastMessagePreview = json.data.body || json.data.message;
          if (json.data.recipient) {
            this.currentStatus.recipientMasked = json.data.recipient;
          }
          this._notify();
          return json.data;
        }
      }
    } catch (err) {
      console.warn('[SmsService] Automatic emergency SMS dispatch error:', err);
    }

    return null;
  }

  /**
   * Handle incoming WebSocket SMS_STATUS event
   */
  handleWebSocketEvent(msg) {
    if (msg.type === 'SMS_STATUS') {
      this.currentStatus.lastAlertStatus = msg.status || this.currentStatus.lastAlertStatus;
      this.currentStatus.lastAlertTime = msg.timestamp || new Date().toISOString();
      if (msg.recipient) this.currentStatus.recipientMasked = msg.recipient;
      this._notify();
    }
  }

  onStatusChange(callback) {
    this.statusListeners.add(callback);
    callback(this.currentStatus);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  _notify() {
    this.statusListeners.forEach((fn) => {
      try { fn(this.currentStatus); } catch (e) { /* ignore */ }
    });
  }
}

export const smsService = new SmsService();


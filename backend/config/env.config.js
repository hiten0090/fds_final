const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  supabase: {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || ''
  },
  camera: {
    url: process.env.ESP32_CAM_URL || 'http://192.168.137.20:81/stream',
    timeoutMs: parseInt(process.env.STREAM_TIMEOUT_MS || '10000', 10),
    reconnectIntervalMs: parseInt(process.env.RECONNECT_INTERVAL_MS || '5000', 10)
  },
  sms: {
    mode: (process.env.SMS_MODE || 'mock').toLowerCase(),
    provider: (process.env.SMS_PROVIDER || 'mock').toLowerCase(),
    apiKey: process.env.SMS_API_KEY || '',
    apiSecret: process.env.SMS_API_SECRET || '',
    senderId: process.env.SMS_SENDER || 'FIREGD',
    emergencyPhone: process.env.EMERGENCY_PHONE || '+919876543210',
    cooldownMs: parseInt(process.env.SMS_COOLDOWN_MS || '300000', 10)
  }
};

// Basic validation
if (!config.supabase.url || !config.supabase.key) {
  console.warn('[WARNING] Supabase URL or Key is missing in environment configuration.');
}

module.exports = config;

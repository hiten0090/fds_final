// src/services/whatsappService.js
// WhatsApp 1-Click Direct Emergency Dispatch (Zero External Provider / No API Keys Required)

const STORAGE_KEY = 'fireguard_emergency_phone';
const AUTO_OPEN_KEY = 'fireguard_wa_auto_open';

/**
 * Normalizes phone number into international WhatsApp digits format (e.g. 917012345689)
 */
export function formatWhatsAppPhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const digits = phone.replace(/[^0-9]/g, '');
  if (!digits) return '';

  // 10-digit Indian mobile starting with 6, 7, 8, or 9
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `91${digits}`;
  }

  // Already prefixed with 91 and 12 digits
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }

  return digits;
}

/**
 * Masks phone number for safe display
 */
export function maskPhoneForWa(num) {
  if (!num) return 'Not Configured';
  const clean = num.replace(/[\s\-\(\)]/g, '');
  if (clean.length < 7) return '******';
  const prefix = clean.slice(0, 5);
  const suffix = clean.slice(-2);
  return `${prefix}*** ***${suffix}`;
}

/**
 * Returns array of registered recipients formatted for WhatsApp dispatch
 */
export function getRegisteredRecipients(customPhone) {
  const raw = customPhone || localStorage.getItem(STORAGE_KEY) || '';
  const list = raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  return list
    .map((num) => ({
      raw: num,
      waNumber: formatWhatsAppPhone(num),
      masked: maskPhoneForWa(num)
    }))
    .filter((r) => r.waNumber);
}

/**
 * Builds standard WhatsApp formatted emergency message with markdown styling
 */
export function buildWhatsAppMessage({
  sensorData = {},
  facilityLocation = {},
  severity = 'CRITICAL',
  eventTime
}) {
  const facilityName = facilityLocation.facilityName || 'FireGuard Monitored Facility';
  const time = eventTime || new Date().toLocaleTimeString();

  const lines = [
    `🚨 *FIREGUARD EMERGENCY ALERT: FIRE DETECTED!*`,
    `⚠️ *Severity:* ${severity.toUpperCase()}`,
    `🏢 *Facility:* ${facilityName}`
  ];

  if (facilityLocation.address) {
    lines.push(`📍 *Location:* ${facilityLocation.address}`);
  }

  if (facilityLocation.mapsUrl) {
    lines.push(`🗺️ *Evacuation Route (Google Maps):* ${facilityLocation.mapsUrl}`);
  } else if (
    typeof facilityLocation.latitude === 'number' &&
    typeof facilityLocation.longitude === 'number'
  ) {
    lines.push(
      `🗺️ *Evacuation Route (Google Maps):* https://www.google.com/maps/search/?api=1&query=${facilityLocation.latitude}%2C${facilityLocation.longitude}`
    );
  }

  const sensorDetails = [];
  if (sensorData.temperature !== null && sensorData.temperature !== undefined) {
    const t = parseFloat(sensorData.temperature);
    if (!isNaN(t)) sensorDetails.push(`• *Temperature:* ${t.toFixed(1)}°C`);
  }
  const rawGas = sensorData.gas_value ?? sensorData.smoke ?? sensorData.gas;
  if (rawGas !== null && rawGas !== undefined) {
    const s = parseFloat(rawGas);
    if (!isNaN(s)) sensorDetails.push(`• *Smoke/Gas:* ${s.toFixed(0)} PPM`);
  }
  if (sensorData.flame !== null && sensorData.flame !== undefined) {
    sensorDetails.push(`• *Flame Status:* ${sensorData.flame ? '🔥 DETECTED' : 'CLEAR'}`);
  }

  if (sensorDetails.length > 0) {
    lines.push(``, `📊 *Live Telemetry:*`, ...sensorDetails);
  }

  lines.push(
    `⏱️ *Incident Time:* ${time}`,
    ``,
    `🚨 *IMMEDIATE ACTION:* Evacuate premises immediately via fire exits. Do not use elevators. Contact Fire Department / Emergency Services (112 / 101).`
  );

  return lines.join('\n');
}

/**
 * Generates direct wa.me link
 */
export function getWhatsAppUrl(phone, messageText) {
  const waNumber = formatWhatsAppPhone(phone);
  return `https://wa.me/${waNumber}?text=${encodeURIComponent(messageText)}`;
}

/**
 * Opens WhatsApp dispatch link in a new tab/window
 */
export function openWhatsAppDispatch(phone, messageText) {
  const url = getWhatsAppUrl(phone, messageText);
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return url;
}

/**
 * Checks if auto-open on alert is enabled
 */
export function isAutoOpenEnabled() {
  try {
    return localStorage.getItem(AUTO_OPEN_KEY) === 'true';
  } catch (e) {
    return false;
  }
}

/**
 * Sets auto-open preference
 */
export function setAutoOpenEnabled(enabled) {
  try {
    localStorage.setItem(AUTO_OPEN_KEY, enabled ? 'true' : 'false');
  } catch (e) {}
}


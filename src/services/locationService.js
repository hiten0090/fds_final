// src/services/locationService.js
// Frontend-only Facility Location & Emergency Sharing Manager for FireGuard

const STORAGE_KEY = 'fireguard_facility_location';

/**
 * Validates geographic coordinates
 * @param {number|string} lat - Latitude (-90 to 90)
 * @param {number|string} lng - Longitude (-180 to 180)
 * @returns {{ valid: boolean, error?: string, latNum: number|null, lngNum: number|null }}
 */
export function validateCoordinates(lat, lng) {
  if (lat === null || lat === undefined || lat === '' ||
      lng === null || lng === undefined || lng === '') {
    return { valid: true, latNum: null, lngNum: null };
  }

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);

  if (isNaN(latNum) || isNaN(lngNum)) {
    return { valid: false, error: 'Latitude and Longitude must be valid numbers.' };
  }

  if (latNum < -90 || latNum > 90) {
    return { valid: false, error: 'Latitude must be between -90 and 90 degrees.' };
  }

  if (lngNum < -180 || lngNum > 180) {
    return { valid: false, error: 'Longitude must be between -180 and 180 degrees.' };
  }

  return { valid: true, latNum, lngNum };
}

class LocationService {
  constructor() {
    this.listeners = new Set();
  }

  /**
   * Retrieve saved facility location from localStorage
   */
  getLocation() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return this.getDefaultLocation();
      const parsed = JSON.parse(raw);
      return {
        facilityName: (parsed.facilityName || '').trim(),
        address: (parsed.address || '').trim(),
        latitude: typeof parsed.latitude === 'number' && !isNaN(parsed.latitude) ? parsed.latitude : null,
        longitude: typeof parsed.longitude === 'number' && !isNaN(parsed.longitude) ? parsed.longitude : null,
        source: parsed.source === 'device' ? 'device' : 'facility',
        updatedAt: parsed.updatedAt || null
      };
    } catch (e) {
      console.warn('[LocationService] Failed to parse stored facility location:', e);
      return this.getDefaultLocation();
    }
  }

  getDefaultLocation() {
    return {
      facilityName: 'Apex Industrial Fab Plant - Sector 4',
      address: 'Plot 14-B, Central Electronics Corridor, New Delhi',
      latitude: 28.640016,
      longitude: 77.112264,
      source: 'facility',
      updatedAt: null
    };
  }

  /**
   * Check if a location is considered configured and valid
   */
  isConfigured(loc) {
    const location = loc || this.getLocation();
    const hasName = Boolean(location.facilityName && location.facilityName.trim().length > 0);
    const hasAddress = Boolean(location.address && location.address.trim().length > 0);
    const hasCoords = typeof location.latitude === 'number' && typeof location.longitude === 'number';
    return (hasName || hasAddress || hasCoords) && (hasAddress || hasCoords);
  }

  /**
   * Construct standard Google Maps URL
   * Format: https://www.google.com/maps/search/?api=1&query=LATITUDE%2CLONGITUDE
   * Fallback to encoded address if coordinates are absent.
   */
  getGoogleMapsUrl(loc) {
    const location = loc || this.getLocation();
    if (typeof location.latitude === 'number' && typeof location.longitude === 'number') {
      return `https://www.google.com/maps/search/?api=1&query=${location.latitude}%2C${location.longitude}`;
    }
    if (location.address && location.address.trim().length > 0) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address.trim())}`;
    }
    return null;
  }

  /**
   * Save facility location locally
   */
  saveLocation({ facilityName, address, latitude, longitude, source = 'facility' }) {
    const valResult = validateCoordinates(latitude, longitude);
    if (!valResult.valid) {
      return { success: false, error: valResult.error };
    }

    const payload = {
      facilityName: (facilityName || '').trim(),
      address: (address || '').trim(),
      latitude: valResult.latNum,
      longitude: valResult.lngNum,
      source: source === 'device' ? 'device' : 'facility',
      updatedAt: new Date().toISOString()
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      this._notifyListeners(payload);
      return { success: true, location: payload };
    } catch (err) {
      console.error('[LocationService] Failed to persist location:', err);
      return { success: false, error: 'Failed to save location to local storage.' };
    }
  }

  /**
   * Clear saved location
   */
  clearLocation() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      const empty = this.getDefaultLocation();
      this._notifyListeners(empty);
      return { success: true };
    } catch (err) {
      console.error('[LocationService] Failed to clear location:', err);
      return { success: false, error: 'Failed to clear local storage.' };
    }
  }

  /**
   * Subscribe to location changes
   */
  onLocationChange(callback) {
    this.listeners.add(callback);
    callback(this.getLocation());
    return () => {
      this.listeners.delete(callback);
    };
  }

  _notifyListeners(loc) {
    this.listeners.forEach((fn) => {
      try { fn(loc); } catch (e) { /* ignore */ }
    });
  }

  /**
   * Request device geolocation upon explicit user gesture
   */
  requestDeviceLocation() {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !navigator.geolocation) {
        reject(new Error('Geolocation is not supported by your browser.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: parseFloat(position.coords.latitude.toFixed(6)),
            longitude: parseFloat(position.coords.longitude.toFixed(6)),
            accuracy: position.coords.accuracy
          });
        },
        (error) => {
          let message = 'Unable to retrieve device location.';
          if (error.code === 1) { // PERMISSION_DENIED
            message = 'Device location permission denied by user.';
          } else if (error.code === 2) { // POSITION_UNAVAILABLE
            message = 'Position unavailable. Check GPS or network connection.';
          } else if (error.code === 3) { // TIMEOUT
            message = 'Location request timed out.';
          }
          reject(new Error(message));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  }

  /**
   * Formats the emergency dispatch text payload
   */
  buildEmergencyShareText({ facilityName, address, latitude, longitude, mapsUrl, eventTime }) {
    const name = facilityName || 'FireGuard Monitored Facility';
    let locDesc = '';
    if (address && address.trim()) {
      locDesc = address.trim();
      if (typeof latitude === 'number' && typeof longitude === 'number') {
        locDesc += ` (${latitude}, ${longitude})`;
      }
    } else if (typeof latitude === 'number' && typeof longitude === 'number') {
      locDesc = `Coordinates: ${latitude}, ${longitude}`;
    } else {
      locDesc = 'Location not explicitly configured.';
    }

    const lines = [
      `🚨 FIREGUARD EMERGENCY ALERT: Fire detected at ${name}!`,
      `📍 Location: ${locDesc}`,
      `⏰ Detected: ${eventTime || new Date().toLocaleTimeString()}`,
      mapsUrl ? `🗺️ Google Maps: ${mapsUrl}` : '',
      `⚠️ Immediate evacuation required. Dispatch first responders.`
    ].filter(Boolean);

    return lines.join('\n');
  }

  /**
   * Shares the emergency location via Web Share API or Clipboard fallback
   */
  async shareEmergencyLocation({ facilityName, address, latitude, longitude, mapsUrl, eventTime }) {
    const title = `🚨 Fire Emergency: ${facilityName || 'FireGuard Monitored Facility'}`;
    const text = this.buildEmergencyShareText({ facilityName, address, latitude, longitude, mapsUrl, eventTime });

    // 1. Try Web Share API if supported
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title,
          text,
          url: mapsUrl || undefined
        });
        return { success: true, method: 'native', message: 'Emergency location shared successfully.' };
      } catch (err) {
        if (err.name === 'AbortError') {
          return { success: false, cancelled: true, message: 'Share action cancelled by user.' };
        }
        console.warn('[LocationService] Web Share failed, falling back to clipboard:', err);
      }
    }

    // 2. Clipboard fallback
    return await this.copyToClipboard(text, 'Emergency dispatch text and location copied to clipboard!');
  }

  /**
   * Copy text or URL to clipboard
   */
  async copyToClipboard(text, successMsg = 'Copied to clipboard!') {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return { success: true, method: 'clipboard', message: successMsg };
      }

      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return { success: true, method: 'clipboard', message: successMsg };
    } catch (err) {
      console.error('[LocationService] Clipboard copy failed:', err);
      return { success: false, error: 'Could not copy to clipboard. Please copy manually.' };
    }
  }
}

export const locationService = new LocationService();


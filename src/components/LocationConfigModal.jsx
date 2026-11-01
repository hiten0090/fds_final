// src/components/LocationConfigModal.jsx
// Frontend-only Facility Location Configuration Modal with validation and privacy controls

import React, { useState, useEffect } from 'react';
import { locationService, validateCoordinates } from '../services/locationService';

export default function LocationConfigModal({ isOpen, onClose, onSaveSuccess }) {
  const [facilityName, setFacilityName] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [source, setSource] = useState('facility'); // 'facility' or 'device'
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [isLocating, setIsLocating] = useState(false);

  // Sync with current stored location on modal open
  useEffect(() => {
    if (isOpen) {
      const current = locationService.getLocation();
      setFacilityName(current.facilityName || '');
      setAddress(current.address || '');
      setLatitude(typeof current.latitude === 'number' ? current.latitude.toString() : '');
      setLongitude(typeof current.longitude === 'number' ? current.longitude.toString() : '');
      setSource(current.source || 'facility');
      setErrorMsg('');
      setInfoMsg('');
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleFetchDeviceLocation = async () => {
    setIsLocating(true);
    setErrorMsg('');
    setInfoMsg('');

    try {
      const pos = await locationService.requestDeviceLocation();
      setLatitude(pos.latitude.toString());
      setLongitude(pos.longitude.toString());
      setSource('device');
      setInfoMsg(`✔ Device coordinates acquired (±${Math.round(pos.accuracy)}m accuracy). Note: Represents current device, not permanent facility.`);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to acquire device location.');
    } finally {
      setIsLocating(false);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    setErrorMsg('');

    // If coordinates are provided, validate ranges strictly (-90..90 and -180..180)
    if (latitude.trim() || longitude.trim()) {
      const val = validateCoordinates(latitude.trim(), longitude.trim());
      if (!val.valid) {
        setErrorMsg(val.error);
        return;
      }
    }

    if (!facilityName.trim() && !address.trim() && !latitude.trim()) {
      setErrorMsg('Please provide at least a Facility Name, Address, or valid Coordinates.');
      return;
    }

    const res = locationService.saveLocation({
      facilityName: facilityName.trim(),
      address: address.trim(),
      latitude: latitude.trim(),
      longitude: longitude.trim(),
      source
    });

    if (res.success) {
      if (onSaveSuccess) onSaveSuccess(res.location);
      onClose();
    } else {
      setErrorMsg(res.error || 'Failed to save location.');
    }
  };

  const handleClear = () => {
    if (window.confirm('Are you sure you want to clear the saved facility location?')) {
      locationService.clearLocation();
      setFacilityName('');
      setAddress('');
      setLatitude('');
      setLongitude('');
      setSource('facility');
      setInfoMsg('Location cleared.');
      if (onSaveSuccess) onSaveSuccess(locationService.getDefaultLocation());
    }
  };

  return (
    <div 
      className="location-modal-overlay" 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="loc-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="location-modal-card">
        {/* Modal Header */}
        <div className="loc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>📍</span>
            <h2 id="loc-modal-title" style={{ margin: 0, fontSize: '17px', fontWeight: 800 }}>
              Facility Location Configuration
            </h2>
          </div>
          <button 
            type="button" 
            className="loc-modal-close-btn" 
            onClick={onClose}
            aria-label="Close location configuration"
          >
            ✕
          </button>
        </div>

        {/* Privacy Note */}
        <div className="loc-privacy-notice">
          <strong>🔒 Location Privacy:</strong> Stored strictly in your local browser storage. Never transmitted to the backend, external servers, or third-party trackers.
        </div>

        <form onSubmit={handleSave} className="loc-modal-form">
          {/* Facility Name */}
          <div className="loc-form-group">
            <label htmlFor="facilityNameInput" className="loc-form-label">
              Facility / Building Name
            </label>
            <input
              id="facilityNameInput"
              type="text"
              className="loc-form-input"
              placeholder="e.g. FireGuard Plant Alpha — Sector A"
              value={facilityName}
              onChange={(e) => setFacilityName(e.target.value)}
            />
          </div>

          {/* Facility Address */}
          <div className="loc-form-group">
            <label htmlFor="addressInput" className="loc-form-label">
              Facility Street Address (Google Maps Searchable)
            </label>
            <input
              id="addressInput"
              type="text"
              className="loc-form-input"
              placeholder="e.g. 100 Industrial Parkway, Tech District"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <span className="loc-field-hint">
              Used as the fallback search query if exact GPS coordinates are not provided.
            </span>
          </div>

          {/* Coordinates Grid */}
          <div className="loc-coords-grid">
            <div className="loc-form-group">
              <label htmlFor="latitudeInput" className="loc-form-label">
                Latitude (-90.0 to 90.0)
              </label>
              <input
                id="latitudeInput"
                type="number"
                step="any"
                className="loc-form-input"
                placeholder="e.g. 37.774929"
                value={latitude}
                onChange={(e) => {
                  setLatitude(e.target.value);
                  setSource('facility');
                }}
              />
            </div>

            <div className="loc-form-group">
              <label htmlFor="longitudeInput" className="loc-form-label">
                Longitude (-180.0 to 180.0)
              </label>
              <input
                id="longitudeInput"
                type="number"
                step="any"
                className="loc-form-input"
                placeholder="e.g. -122.419416"
                value={longitude}
                onChange={(e) => {
                  setLongitude(e.target.value);
                  setSource('facility');
                }}
              />
            </div>
          </div>

          {/* Device Geolocation Helper */}
          <div className="loc-device-helper-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600 }}>Device Location Assistance</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  Explicitly populate coordinates from this browser's GPS / IP location.
                </div>
              </div>
              <button
                type="button"
                className="btn-enterprise secondary"
                onClick={handleFetchDeviceLocation}
                disabled={isLocating}
                style={{ fontSize: '11.5px', padding: '6px 10px', whiteSpace: 'nowrap' }}
              >
                {isLocating ? '⏳ Acquiring GPS...' : '📍 Use Current Device Location'}
              </button>
            </div>
            {source === 'device' && (
              <div className="loc-device-warning">
                ⚠️ Coordinates sourced from device location. If this device is off-site, verify they match the monitored facility!
              </div>
            )}
          </div>

          {/* Validation Messages */}
          {errorMsg && (
            <div className="loc-modal-error">
              ⚠️ {errorMsg}
            </div>
          )}
          {infoMsg && (
            <div className="loc-modal-info">
              {infoMsg}
            </div>
          )}

          {/* Action Buttons */}
          <div className="loc-modal-actions">
            <button
              type="button"
              className="btn-enterprise secondary"
              onClick={handleClear}
              style={{ color: '#DC2626' }}
              title="Clear all stored facility location data"
            >
              Clear Location
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn-enterprise secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-enterprise danger"
                style={{ background: '#2563EB', borderColor: '#2563EB' }}
              >
                💾 Save Configuration
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}


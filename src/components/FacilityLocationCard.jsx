// src/components/FacilityLocationCard.jsx
// Displays facility location in both Normal Monitoring Mode and Fire Emergency Mode

import React, { useState } from 'react';
import { locationService } from '../services/locationService';
import WorldMapVisualizer from './WorldMapVisualizer';

export default function FacilityLocationCard({
  location,
  isEmergency,
  eventTimestamp,
  onOpenConfig
}) {
  const [feedback, setFeedback] = useState(null);
  const isConfigured = locationService.isConfigured(location);
  const mapsUrl = locationService.getGoogleMapsUrl(location);

  const showFeedback = (msg, type = 'success') => {
    setFeedback({ msg, type });
    setTimeout(() => {
      setFeedback(null);
    }, 3500);
  };

  const handleShare = async () => {
    if (!isConfigured) {
      showFeedback('Please configure a valid location first.', 'error');
      return;
    }

    const res = await locationService.shareEmergencyLocation({
      facilityName: location.facilityName,
      address: location.address,
      latitude: location.latitude,
      longitude: location.longitude,
      mapsUrl,
      eventTime: eventTimestamp
    });

    if (res.success) {
      showFeedback(res.message || 'Location shared successfully!', 'success');
    } else if (res.cancelled) {
      showFeedback('Sharing cancelled.', 'info');
    } else {
      showFeedback(res.error || 'Failed to share location.', 'error');
    }
  };

  const handleCopyLink = async () => {
    if (!mapsUrl) {
      showFeedback('No valid map location available to copy.', 'error');
      return;
    }

    const res = await locationService.copyToClipboard(mapsUrl, '✔ Google Maps link copied to clipboard!');
    if (res.success) {
      showFeedback(res.message, 'success');
    } else {
      showFeedback(res.error || 'Failed to copy link.', 'error');
    }
  };

  // Determine Source Label
  const sourceLabel = location.source === 'device' 
    ? '📍 Device Geolocation' 
    : '🏢 Configured Facility Location';

  return (
    <div className={`enterprise-card facility-location-card ${isEmergency ? 'emergency-card-theme' : ''}`}>
      {/* Header */}
      <div className="card-header-title">
        <div className="card-title-left">
          <span className="loc-icon-pulse">{isEmergency ? '🚨' : '📍'}</span>
          <div>
            <div style={{ fontSize: isEmergency ? '15.5px' : '14px', fontWeight: 800, fontFamily: 'var(--font-heading)', letterSpacing: '-0.015em' }}>
              {isEmergency ? 'EMERGENCY DISPATCH LOCATION' : 'Facility Location & Routing'}
            </div>
            <div style={{ fontSize: '11px', color: isEmergency ? '#991B1B' : 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>
              {isEmergency ? 'First responder coordinate routing' : 'Configured geographic position'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="location-status-badge status-locked">
            GPS LOCKED
          </span>
          {onOpenConfig && (
            <button
              onClick={onOpenConfig}
              className="btn-enterprise secondary"
              style={{ padding: '3px 8px', fontSize: '11px' }}
              title="Edit facility location configuration"
            >
              ⚙️ {isConfigured ? 'Edit' : 'Configure'}
            </button>
          )}
        </div>
      </div>

      {/* World Map & Geolocation Radar Viewport */}
      <WorldMapVisualizer
        latitude={location?.latitude}
        longitude={location?.longitude}
        facilityName={location?.facilityName}
        isEmergency={isEmergency}
      />

      {/* Main Content Info */}
      <div className="facility-loc-body">
        {/* Action Buttons */}
        {isConfigured && (
          <div className="facility-actions-row">
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`btn-enterprise ${isEmergency ? 'danger' : 'secondary'} btn-maps-action`}
                title="Open facility location in Google Maps"
              >
                Open in Maps
              </a>
            )}

            <button
              onClick={handleShare}
              className={`btn-enterprise ${isEmergency ? 'danger' : 'secondary'}`}
              title="Share emergency location link via Web Share or clipboard"
            >
              Share Location
            </button>

            {mapsUrl && (
              <button
                onClick={handleCopyLink}
                className="btn-enterprise secondary"
                title="Copy Google Maps link to clipboard"
              >
                Copy Link
              </button>
            )}
          </div>
        )}

        {/* Real-time Action Feedback Toast */}
        {feedback && (
          <div className={`loc-feedback-toast ${feedback.type}`}>
            {feedback.msg}
          </div>
        )}
      </div>
    </div>
  );
}


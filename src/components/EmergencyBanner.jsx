import React from 'react';

export default function EmergencyBanner({ active, timestamp, severity, onAcknowledge, facilityName }) {
  if (!active) return null;

  return (
    <div className="emergency-banner-container" role="alert" aria-live="assertive">
      <div className="emergency-banner">
        <div className="banner-content">
          <span className="banner-pulse-icon">🚨</span>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '0.04em', fontFamily: 'var(--font-brand)', textTransform: 'uppercase' }}>
              FIRE DETECTED — EMERGENCY OPERATIONS CENTER ACTIVE
            </div>
            <div style={{ fontSize: '12px', opacity: 0.95, marginTop: '2px', fontFamily: 'var(--font-sans)' }}>
              Hazard Severity: <strong>{severity ? severity.toUpperCase() : 'CRITICAL'}</strong>
              {facilityName ? ` • Facility: ${facilityName}` : ''}
              {timestamp ? ` • Detected at ${timestamp}` : ''}
              {' • Immediate building evacuation commanded. Live camera surveillance initiated.'}
            </div>
          </div>
        </div>

        <div className="banner-actions">
          {onAcknowledge && (
            <button 
              className="btn-banner-action" 
              onClick={onAcknowledge}
              title="Acknowledge active alert"
            >
              ✔ Silence Siren
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

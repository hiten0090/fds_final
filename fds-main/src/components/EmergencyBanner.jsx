import React from 'react';

export default function EmergencyBanner({ active }) {
  if (!active) return null;

  return (
    <div className="emergency-banner-container">
      <div className="emergency-banner" role="alert" aria-live="assertive">
        🚨 EMERGENCY MODE ACTIVE • Fire has not yet been cleared. Live monitoring is running.
      </div>
    </div>
  );
}

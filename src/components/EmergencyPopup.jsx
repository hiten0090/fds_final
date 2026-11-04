import React, { useEffect, useRef, useState } from 'react';
import { locationService } from '../services/locationService';
import { smsService } from '../services/smsService';
import { webcamService } from '../services/webcamService';
import {
  getRegisteredRecipients,
  buildWhatsAppMessage,
  getWhatsAppUrl,
  isAutoOpenEnabled,
  setAutoOpenEnabled
} from '../services/whatsappService';

export default function EmergencyPopup({
  severity,
  onClose,
  onViewDashboard,
  eventTime,
  facilityLocation,
  sensors
}) {
  const okBtnRef = useRef(null);
  const viewDashBtnRef = useRef(null);
  const videoRef = useRef(null);
  const [smsStatus, setSmsStatus] = useState(smsService.currentStatus);
  const [autoOpenWa, setAutoOpenWa] = useState(isAutoOpenEnabled());
  const [webcamState, setWebcamState] = useState(webcamService.getState());
  const loc = facilityLocation || locationService.getLocation();
  const isConfigured = locationService.isConfigured(loc);
  const mapsUrl = locationService.getGoogleMapsUrl(loc);

  const recipients = getRegisteredRecipients();
  const waMessage = buildWhatsAppMessage({
    sensorData: sensors || {},
    facilityLocation: loc,
    severity: severity || 'CRITICAL',
    eventTime
  });

  // Subscribe to webcam service updates
  useEffect(() => {
    const unsubWebcam = webcamService.subscribe((state) => {
      setWebcamState(state);
    });
    return unsubWebcam;
  }, []);

  // Auto-start laptop webcam immediately when emergency popup mounts
  useEffect(() => {
    if (!webcamService.isActive) {
      webcamService.startWebcam().catch((err) => {
        console.warn('[EmergencyPopup] Auto webcam start error:', err);
      });
    }
  }, []);

  // Bind live mediaStream to HTML5 video element
  useEffect(() => {
    if (videoRef.current && webcamState.stream) {
      videoRef.current.srcObject = webcamState.stream;
      videoRef.current.play().catch((err) => {
        console.warn('[EmergencyPopup] Video playback error:', err);
      });
    }
  }, [webcamState.stream]);

  useEffect(() => {
    const unsub = smsService.onStatusChange((status) => {
      setSmsStatus(status);
    });
    return unsub;
  }, []);

  // Auto-open WhatsApp on first active mount if preference is enabled
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenWa && !autoOpenedRef.current && recipients.length > 0) {
      autoOpenedRef.current = true;
      const targetUrl = getWhatsAppUrl(recipients[0].waNumber, waMessage);
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  }, [autoOpenWa, recipients, waMessage]);

  const toggleAutoOpen = (checked) => {
    setAutoOpenWa(checked);
    setAutoOpenEnabled(checked);
  };

  useEffect(() => {
    if (okBtnRef.current) {
      okBtnRef.current.focus();
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (onClose) onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="emergency-overlay visible"
      role="dialog"
      aria-modal="true"
      aria-labelledby="popup-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
    >
      <div className="emergency-card shake-anim">
        <div className="emergency-badge">🚨</div>
        <h2 id="popup-title">🚨 FIRE DETECTED</h2>
        <p className="emergency-subtitle">
          A fire condition has been confirmed by the Smart Fire Detection System.
          {eventTime ? ` Detected at ${eventTime}.` : ''}
        </p>

        <div className="severity-container">
          <span className="severity-label">FIRE SEVERITY</span>
          <span className={`severity-value ${(severity || 'critical').toLowerCase()}`} id="popup-severity">
            {(severity || 'CRITICAL').toUpperCase()}
          </span>
        </div>

        {/* Tactical Laptop WebCam Surveillance Stream */}
        <div className="popup-webcam-card">
          <div className="popup-webcam-hud-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className={`hud-dot ${webcamState.isActive ? 'active-pulse' : 'offline'}`}></span>
              <span className="popup-webcam-title font-mono">
                {webcamState.isActive ? 'LAPTOP WEBCAM • LIVE LOCAL SURVEILLANCE' : 'LAPTOP WEBCAM STANDBY'}
              </span>
            </div>
            <span className="popup-webcam-badge font-mono">
              {webcamState.isActive ? 'FEED ACTIVE • 720p' : 'OFFLINE'}
            </span>
          </div>

          <div className="popup-webcam-viewport">
            {webcamState.isActive && webcamState.stream ? (
              <div className="popup-video-wrapper">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="popup-live-video"
                />
                <div className="popup-video-overlay font-mono">
                  <span>● LIVE BROADCAST</span>
                  <span>{eventTime || new Date().toLocaleTimeString()}</span>
                </div>
              </div>
            ) : (
              <div className="popup-webcam-placeholder">
                {webcamState.error ? (
                  <div className="webcam-error-box font-mono">
                    <span>⚠️ {webcamState.error}</span>
                    <button
                      type="button"
                      onClick={() => webcamService.startWebcam()}
                      className="btn-webcam-retry"
                    >
                      Retry Camera Permission
                    </button>
                  </div>
                ) : (
                  <div className="webcam-activating-box">
                    <span className="webcam-icon-spin">📹</span>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B', marginTop: '6px' }}>
                      Activating Laptop WebCam...
                    </div>
                    <p style={{ fontSize: '11px', color: '#64748B', margin: '4px 0 8px 0' }}>
                      Visual surveillance automatically engaged upon fire confirmation.
                    </p>
                    <button
                      type="button"
                      onClick={() => webcamService.startWebcam()}
                      className="btn-webcam-retry"
                    >
                      ▶ Allow / Start Camera
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Row for Webcam */}
          {webcamState.isActive && (
            <div className="popup-webcam-actions-bar">
              <button
                type="button"
                onClick={() => {
                  const snap = webcamService.captureSnapshot(videoRef.current);
                  if (snap) {
                    const link = document.createElement('a');
                    link.href = snap;
                    link.download = `FireGuard_Emergency_Webcam_${Date.now()}.jpg`;
                    link.click();
                  }
                }}
                className="btn-webcam-snap"
                title="Save high-resolution visual evidence of the incident"
              >
                <span>📸</span>
                <span>Save Incident Photo</span>
              </button>
              <span className="font-mono" style={{ fontSize: '10.5px', color: '#15803D' }}>
                ✓ Streaming live from laptop hardware
              </span>
            </div>
          )}
        </div>

        {/* Facility Location Dispatch Box */}
        {isConfigured ? (
          <div className="popup-location-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#7F1D1D', letterSpacing: '0.04em' }}>
                📍 FACILITY DISPATCH LOCATION
              </span>
              <span style={{ fontSize: '10px', background: '#FEE2E2', color: '#991B1B', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                {loc.source === 'device' ? 'Device GPS' : 'Verified Facility'}
              </span>
            </div>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#172B4D', marginTop: '2px' }}>
              {loc.facilityName || 'FireGuard Monitored Facility'}
            </div>
            {mapsUrl && (
              <div style={{ marginTop: '6px' }}>
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="popup-maps-link"
                  onClick={(e) => e.stopPropagation()}
                >
                  🗺️ Open Route in Google Maps ↗
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="popup-location-box unconfigured">
            <div style={{ fontSize: '11.5px', color: '#92400E', fontWeight: 600 }}>
              ⚠️ Facility Location Not Configured
            </div>
          </div>
        )}

        {/* WhatsApp 1-Click Emergency Dispatch (Zero Provider / No API Key Required) */}
        <div className="popup-whatsapp-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '16px' }}>📲</span>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#166534' }}>
                  WHATSAPP 1-CLICK EMERGENCY DISPATCH
                </div>
                <div style={{ fontSize: '10.5px', color: '#15803D' }}>
                  Direct to phone • No SMS provider or API key needed
                </div>
              </div>
            </div>
            <span style={{ fontSize: '10px', background: '#DCFCE7', color: '#15803D', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
              {recipients.length > 0 ? `${recipients.length} Recipient${recipients.length > 1 ? 's' : ''}` : 'No Recipient'}
            </span>
          </div>

          {recipients.length > 0 ? (
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {recipients.map((r, idx) => (
                <a
                  key={idx}
                  href={getWhatsAppUrl(r.waNumber, waMessage)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-whatsapp-dispatch"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '15px' }}>💬</span>
                    <span>Send Emergency Alert to <strong>{r.masked}</strong></span>
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: 800 }}>➔</span>
                </a>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: '6px', fontSize: '11px', color: '#92400E' }}>
              ⚠️ No phone number configured. Configure your number on the dashboard emergency card.
            </div>
          )}

          {/* Auto-open toggle */}
          {recipients.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', fontSize: '11px', color: '#166534', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoOpenWa}
                onChange={(e) => toggleAutoOpen(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>Automatically open WhatsApp tab on fire alarms</span>
            </label>
          )}
        </div>

        {/* Emergency SMS Broadcast Status */}
        <div className="popup-sms-status-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#1E293B' }}>
              📱 EMERGENCY SMS BROADCAST
            </span>
            <span className={`sms-status-tag ${smsStatus.lastAlertStatus === 'SIMULATED — SMS NOT SENT' ? 'sms-badge-simulated' : smsStatus.lastAlertStatus === 'SENT — PROVIDER ACCEPTED' ? 'sms-badge-sent' : 'sms-badge-pending'}`} style={{ fontSize: '10px', padding: '2px 8px' }}>
              {smsStatus.lastAlertStatus || 'SIMULATED — SMS NOT SENT'}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>
            Recipient: <strong>{smsStatus.recipientMasked || 'Configured Contact'}</strong>
          </div>
          {smsStatus.lastAlertStatus === 'SIMULATED — SMS NOT SENT' && (
            <div style={{ fontSize: '10px', color: '#B45309', marginTop: '3px', fontWeight: 500 }}>
              ℹ️ Simulated in mock mode. To deliver real SMS to physical phones, enable Live SMS in settings with an SMS API key (e.g. Fast2SMS).
            </div>
          )}
        </div>

        <div className="safety-instructions">
          <div className="instruction-item">
            <span className="instruction-icon">🧘</span>
            <span>Stay Calm.</span>
          </div>
          <div className="instruction-item">
            <span className="instruction-icon">🏃</span>
            <span>Evacuate the building immediately.</span>
          </div>
          <div className="instruction-item">
            <span className="instruction-icon">🛗</span>
            <span>Avoid using elevators.</span>
          </div>
          <div className="instruction-item">
            <span className="instruction-icon">🚪</span>
            <span>Use the nearest emergency exit.</span>
          </div>
          <div className="instruction-item">
            <span className="instruction-icon">📞</span>
            <span>Emergency response alerted.</span>
          </div>
          <div className="instruction-item">
            <span className="instruction-icon">📋</span>
            <span>Follow safety protocols.</span>
          </div>
        </div>

        <div className="popup-actions">
          <button
            ref={okBtnRef}
            type="button"
            className="btn-emergency-primary"
            onClick={onClose}
            aria-label="Acknowledge alert and silence alarm"
          >
            ✔ Acknowledge Alert
          </button>
          <button
            ref={viewDashBtnRef}
            type="button"
            className="btn-emergency-secondary"
            onClick={onViewDashboard}
            aria-label="View Dashboard and Camera"
          >
            📊 View Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

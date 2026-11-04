import React, { useEffect, useState, useRef } from 'react';

export default function EmergencyPopup({ severity, onClose, onViewDashboard }) {
  const [isRendered, setIsRendered] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const autoCloseTimeoutRef = useRef(null);
  const okBtnRef = useRef(null);
  const viewDashBtnRef = useRef(null);

  // Initialize mounting state to trigger fade-in transition
  useEffect(() => {
    // Lock scroll
    document.body.classList.add('popup-open');

    // Slight delay to ensure DOM is ready for transition
    const timer = setTimeout(() => {
      setIsRendered(true);
    }, 10);

    // Initial focus on OK button
    if (okBtnRef.current) {
      okBtnRef.current.focus();
    }

    // Auto-close after 10 seconds
    autoCloseTimeoutRef.current = setTimeout(() => {
      handleClose(onClose);
    }, 10000);

    // Keydown handler for ESC and Tab trap
    const handleKeyDown = (e) => {
      // Any keydown resets auto close timeout
      resetAutoCloseTimer();

      if (e.key === 'Escape') {
        handleClose(onClose);
      } else if (e.key === 'Tab') {
        const focusable = [okBtnRef.current, viewDashBtnRef.current];
        const first = focusable[0];
        const last = focusable[1];

        if (e.shiftKey) {
          if (document.activeElement === first || !focusable.includes(document.activeElement)) {
            last?.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last || !focusable.includes(document.activeElement)) {
            first?.focus();
            e.preventDefault();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.body.classList.remove('popup-open');
      window.removeEventListener('keydown', handleKeyDown, true);
      if (autoCloseTimeoutRef.current) {
        clearTimeout(autoCloseTimeoutRef.current);
      }
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [onClose]);

  const resetAutoCloseTimer = () => {
    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current);
      autoCloseTimeoutRef.current = null;
    }
  };

  const handleClose = (callback) => {
    resetAutoCloseTimer();
    setIsClosing(true);
    // Wait for fade-out animation to complete (300ms)
    setTimeout(() => {
      callback();
    }, 300);
  };

  const handleContainerClick = (e) => {
    resetAutoCloseTimer();
    // Prevent modal close on background click (industrial protocol)
    if (e.target === e.currentTarget) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const severityClass = severity ? severity.toLowerCase() : 'critical';

  return (
    <div
      className={`emergency-overlay ${isRendered && !isClosing ? 'visible' : ''}`}
      onClick={handleContainerClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="popup-title"
    >
      <div
        className="emergency-card shake-anim"
        onClick={resetAutoCloseTimer}
      >
        <div className="emergency-badge">🚨</div>
        <h2 id="popup-title">🚨 FIRE DETECTED</h2>
        <p className="emergency-subtitle">A fire has been detected by the Smart Fire Detection System.</p>

        <div className="severity-container">
          <span className="severity-label">FIRE SEVERITY</span>
          <span className={`severity-value ${severityClass}`} id="popup-severity">
            {(severity || 'CRITICAL').toUpperCase()}
          </span>
        </div>

        <div className="safety-instructions">
          <div className="instruction-item">
            <span className="instruction-icon">🧘</span>
            <span>Stay Calm.</span>
          </div>
          <div className="instruction-item">
            <span className="instruction-icon">🏃</span>
            <span>Please evacuate the building immediately.</span>
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
            <span>Emergency response has been notified.</span>
          </div>
          <div className="instruction-item">
            <span className="instruction-icon">📋</span>
            <span>Follow all safety instructions.</span>
          </div>
        </div>

        <div className="popup-actions">
          <button
            ref={okBtnRef}
            className="btn-emergency-primary"
            onClick={() => handleClose(onClose)}
            aria-label="Acknowledge alert and close popup"
          >
            ✔ OK
          </button>
          <button
            ref={viewDashBtnRef}
            className="btn-emergency-secondary"
            onClick={() => handleClose(onViewDashboard)}
            aria-label="View Dashboard and close popup"
          >
            📊 View Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

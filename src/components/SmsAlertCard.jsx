// src/components/SmsAlertCard.jsx
// Emergency SMS configuration, status indicator, and manual test interface

import React, { useState, useEffect } from 'react';
import { smsService, validatePhoneNumber, SMS_STATUS } from '../services/smsService';
import {
  getRegisteredRecipients,
  buildWhatsAppMessage,
  openWhatsAppDispatch
} from '../services/whatsappService';

export default function SmsAlertCard({ isEmergency, facilityLocation }) {
  const [smsStatus, setSmsStatus] = useState(smsService.currentStatus);
  const [phoneNumberInput, setPhoneNumberInput] = useState('');
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [isConfiguringGateway, setIsConfiguringGateway] = useState(false);
  const [gatewayMode, setGatewayMode] = useState(smsService.currentStatus.mode || 'mock');
  const [gatewayProvider, setGatewayProvider] = useState(smsService.currentStatus.provider || 'fast2sms');
  const [gatewayApiKey, setGatewayApiKey] = useState('');
  const [validationError, setValidationError] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [isSavingGateway, setIsSavingGateway] = useState(false);

  useEffect(() => {
    // Initial fetch from backend
    smsService.fetchStatus().then((st) => {
      if (st) {
        setGatewayMode(st.mode || 'mock');
        setGatewayProvider(st.provider || 'fast2sms');
      }
    });

    // Subscribe to status updates
    const unsub = smsService.onStatusChange((status) => {
      setSmsStatus(status);
      setGatewayMode(status.mode || 'mock');
      setGatewayProvider(status.provider || 'fast2sms');
    });

    return unsub;
  }, []);

  const showToast = (msg, type = 'success') => {
    setFeedback({ msg, type });
    setTimeout(() => {
      setFeedback(null);
    }, 4000);
  };

  const handleSavePhone = async (e) => {
    e.preventDefault();
    setValidationError('');

    const val = validatePhoneNumber(phoneNumberInput);
    if (!val.valid) {
      setValidationError(val.error);
      return;
    }

    const res = await smsService.updateRecipient(phoneNumberInput);
    if (res.success) {
      setIsEditingPhone(false);
      setPhoneNumberInput('');
      showToast(`✔ Emergency recipient configured: ${res.masked}`);
    } else {
      setValidationError(res.error || 'Failed to update phone number.');
    }
  };

  const handleSaveGateway = async (e) => {
    e.preventDefault();
    setIsSavingGateway(true);
    try {
      const res = await smsService.updateConfig({
        mode: gatewayMode,
        provider: gatewayProvider,
        apiKey: gatewayApiKey
      });
      if (res.success) {
        setIsConfiguringGateway(false);
        showToast(`✔ SMS Gateway updated: ${gatewayMode.toUpperCase()} (${gatewayProvider})`);
      } else {
        showToast(`❌ Failed to update gateway: ${res.error || 'Server error'}`, 'error');
      }
    } catch (err) {
      showToast('❌ Gateway update failed.', 'error');
    } finally {
      setIsSavingGateway(false);
    }
  };

  const handleSendTestAlert = async () => {
    setIsSendingTest(true);
    try {
      const res = await smsService.sendTestAlert(facilityLocation || {});
      if (res.success) {
        if (res.mock) {
          showToast(`✔ SIMULATED — SMS NOT SENT (Mock test successful)`);
        } else {
          showToast(`✔ SMS dispatched to provider (${res.provider || 'Live'})`);
        }
      } else {
        showToast(`❌ SMS alert failed: ${res.error || 'Unknown error'}`, 'error');
      }
    } catch (e) {
      showToast('❌ Test alert request failed.', 'error');
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleOpenWhatsApp = () => {
    const recipients = getRegisteredRecipients();
    if (recipients.length === 0) {
      showToast('⚠️ Please configure an emergency number first.', 'error');
      return;
    }
    const msg = buildWhatsAppMessage({
      sensorData: {},
      facilityLocation: facilityLocation || {},
      severity: isEmergency ? 'CRITICAL' : 'DRILL-TEST',
      eventTime: new Date().toLocaleTimeString()
    });
    openWhatsAppDispatch(recipients[0].waNumber, msg);
    showToast(`✔ Opening WhatsApp emergency alert for ${recipients[0].masked}`);
  };

  // Determine badge styling based on exact status
  const getStatusBadgeClass = (status) => {
    switch (status) {
      case SMS_STATUS.SIMULATED:
        return 'sms-badge-simulated';
      case SMS_STATUS.SENT:
        return 'sms-badge-sent';
      case SMS_STATUS.DELIVERED:
        return 'sms-badge-delivered';
      case SMS_STATUS.FAILED:
        return 'sms-badge-failed';
      case SMS_STATUS.PENDING:
      default:
        return 'sms-badge-pending';
    }
  };

  return (
    <div className={`enterprise-card sms-alert-card ${isEmergency ? 'emergency-sms-theme' : ''}`}>
      {/* Header */}
      <div className="card-header-title">
        <div className="card-title-left">
          <span className="sms-icon">{isEmergency ? '🚨' : '📱'}</span>
          <div>
            <div style={{ fontSize: isEmergency ? '15.5px' : '14px', fontWeight: 800 }}>
              {isEmergency ? 'EMERGENCY SMS DISPATCH MATRIX' : 'Emergency SMS Alerts'}
            </div>
            <div style={{ fontSize: '11px', color: isEmergency ? '#991B1B' : 'var(--text-secondary)' }}>
              {isEmergency ? 'Critical incident alert broadcast' : 'Automated mobile notification'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Mode Pill */}
          <span className={`sms-mode-pill ${smsStatus.mode === 'mock' ? 'mock-mode' : 'live-mode'}`}>
            {smsStatus.mode === 'mock' ? '🧪 MOCK MODE' : '📡 LIVE SMS'}
          </span>
        </div>
      </div>

      {/* Status Bar */}
      <div className="sms-status-banner">
        <span className="sms-status-label">Current Dispatch Status:</span>
        <span className={`sms-status-tag ${getStatusBadgeClass(smsStatus.lastAlertStatus)}`}>
          {smsStatus.lastAlertStatus}
        </span>
      </div>

      {/* Recipient Configuration Info */}
      <div className="sms-recipient-box">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
              REGISTERED EMERGENCY RECIPIENT
            </div>
            <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'var(--text-primary)' }}>
              {smsStatus.recipientMasked || 'Not Configured'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className="btn-enterprise secondary"
              onClick={() => {
                setIsEditingPhone(!isEditingPhone);
                setIsConfiguringGateway(false);
                setValidationError('');
              }}
              style={{ fontSize: '11px', padding: '4px 10px' }}
            >
              {isEditingPhone ? 'Cancel' : '⚙️ Configure Number'}
            </button>
            <button
              type="button"
              className="btn-enterprise secondary"
              onClick={() => {
                setIsConfiguringGateway(!isConfiguringGateway);
                setIsEditingPhone(false);
              }}
              style={{ fontSize: '11px', padding: '4px 10px' }}
            >
              {isConfiguringGateway ? 'Cancel' : '📡 SMS Gateway & Keys'}
            </button>
          </div>
        </div>

        {/* Edit Phone Form */}
        {isEditingPhone && (
          <form onSubmit={handleSavePhone} className="sms-phone-edit-form">
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <input
                type="text"
                className="loc-form-input"
                placeholder="e.g. +919876543210, +919812345678 (comma-separated)"
                value={phoneNumberInput}
                onChange={(e) => setPhoneNumberInput(e.target.value)}
                style={{ flex: 1, fontSize: '12.5px', padding: '6px 10px' }}
                autoFocus
              />
              <button
                type="submit"
                className="btn-enterprise danger"
                style={{ fontSize: '12px', padding: '6px 12px', background: '#2563EB', borderColor: '#2563EB' }}
              >
                Save
              </button>
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Supports one or multiple numbers separated by commas (10 digits starting with 6-9 or +91XXXXXXXXXX)
            </div>
            {validationError && (
              <div className="loc-modal-error" style={{ marginTop: '6px', fontSize: '11.5px', padding: '4px 8px' }}>
                ⚠️ {validationError}
              </div>
            )}
          </form>
        )}

        {/* Configure Gateway & Provider Form */}
        {isConfiguringGateway && (
          <form onSubmit={handleSaveGateway} style={{ marginTop: '12px', padding: '10px', background: '#F8FAFC', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B', marginBottom: '8px' }}>
              📡 SMS GATEWAY & DELIVERY CONFIGURATION
            </div>

            {/* Mode selection */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
              <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="sms_mode"
                  value="mock"
                  checked={gatewayMode === 'mock'}
                  onChange={() => setGatewayMode('mock')}
                />
                🧪 <strong>Mock Mode</strong> (Safe Simulation - No SMS sent)
              </label>
              <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="sms_mode"
                  value="live"
                  checked={gatewayMode === 'live'}
                  onChange={() => setGatewayMode('live')}
                />
                📡 <strong>Live SMS</strong> (Sends Real SMS to Phone)
              </label>
            </div>

            {gatewayMode === 'live' ? (
              <>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <select
                    className="loc-form-input"
                    value={gatewayProvider}
                    onChange={(e) => setGatewayProvider(e.target.value)}
                    style={{ fontSize: '12px', padding: '5px 8px', width: '160px' }}
                  >
                    <option value="fast2sms">Fast2SMS (India)</option>
                    <option value="twilio">Twilio (Global)</option>
                  </select>
                  <input
                    type="password"
                    className="loc-form-input"
                    placeholder="Paste SMS Provider API Key"
                    value={gatewayApiKey}
                    onChange={(e) => setGatewayApiKey(e.target.value)}
                    style={{ flex: 1, fontSize: '12px', padding: '5px 8px' }}
                  />
                  <button
                    type="submit"
                    className="btn-enterprise danger"
                    disabled={isSavingGateway}
                    style={{ fontSize: '12px', padding: '5px 12px', background: '#16A34A', borderColor: '#16A34A' }}
                  >
                    {isSavingGateway ? 'Saving...' : 'Apply Live Key'}
                  </button>
                </div>
                <div style={{ fontSize: '10.5px', color: '#15803D', lineHeight: '1.4' }}>
                  💡 <strong>Instant Free Setup for India:</strong> Sign up at <a href="https://www.fast2sms.com" target="_blank" rel="noopener noreferrer" style={{ color: '#15803D', textDecoration: 'underline' }}>fast2sms.com</a> (free credits on signup), copy your <strong>Dev API Authorization Key</strong>, and paste it above!
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748B' }}>
                  In Mock Mode, emergency alerts simulate on dashboard without using real provider credits.
                </span>
                <button
                  type="submit"
                  className="btn-enterprise secondary"
                  disabled={isSavingGateway}
                  style={{ fontSize: '11px', padding: '4px 10px' }}
                >
                  Save Mode
                </button>
              </div>
            )}
          </form>
        )}
      </div>

      {/* Mode Explanation Notice */}
      {smsStatus.mode === 'mock' && (
        <div style={{
          marginTop: '10px',
          padding: '8px 10px',
          background: '#EFF6FF',
          border: '1px solid #BFDBFE',
          borderRadius: '6px',
          fontSize: '11px',
          color: '#1E40AF',
          lineHeight: '1.4'
        }}>
          ℹ️ <strong>Mock Mode Active:</strong> Alert tests simulate dispatch without charging SMS credits. Whenever an emergency alert triggers or a test is executed, SMS payloads are automatically processed for the registered number(s). To enable live delivery to physical phones, switch to <code>SMS_MODE=live</code> with a provider in <code>backend/.env</code>.
        </div>
      )}

      {/* Message Preview (If available) */}
      {smsStatus.lastMessagePreview && (
        <div className="sms-preview-box">
          <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
            LAST DISPATCH CONTENT {smsStatus.lastAlertTime ? `(${new Date(smsStatus.lastAlertTime).toLocaleTimeString()})` : ''}:
          </div>
          <pre className="sms-preview-text">
            {smsStatus.lastMessagePreview}
          </pre>
        </div>
      )}

      {/* Actions */}
      <div className="sms-actions-footer" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="btn-enterprise"
          onClick={handleOpenWhatsApp}
          style={{
            background: '#16A34A',
            borderColor: '#16A34A',
            color: '#FFFFFF',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
          title="Direct WhatsApp emergency dispatch without external SMS provider"
        >
          <span>💬</span>
          <span>Open WhatsApp Alert</span>
        </button>

        <button
          type="button"
          className={`btn-enterprise ${isEmergency ? 'danger' : 'secondary'} btn-test-sms`}
          onClick={handleSendTestAlert}
          disabled={isSendingTest}
          title={smsStatus.mode === 'mock' ? 'Simulate an SMS alert in mock mode without using provider credits' : 'Trigger live SMS dispatch'}
        >
          {isSendingTest ? '⏳ Dispatching...' : '🔔 Test SMS'}
        </button>

        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          WhatsApp 1-Click active
        </span>
      </div>

      {/* Toast Feedback */}
      {feedback && (
        <div className={`loc-feedback-toast ${feedback.type}`} style={{ marginTop: '10px' }}>
          {feedback.msg}
        </div>
      )}
    </div>
  );
}


// src/components/BackendDataTable.jsx
// Displays the live sensor_data database table from Supabase / Backend with real-time demo/hardware records

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export default function BackendDataTable({ isEmergency }) {
  const [tableData, setTableData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dataSource, setDataSource] = useState('connecting');
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const fetchTable = async () => {
    setIsLoading(true);
    let rows = null;

    // 1. Try Backend API first
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/api/fire/table?limit=25`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          rows = json.data;
          setDataSource('Backend API');
        }
      }
    } catch (e) {
      // Backend not running locally
    }

    // 2. If backend has no data or is offline, fetch directly from Supabase
    if (!rows || rows.length === 0) {
      try {
        const { data, error } = await supabase
          .from('sensor_data')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(25);

        if (!error && Array.isArray(data) && data.length > 0) {
          rows = data;
          setDataSource('Supabase Cloud Database');
        }
      } catch (err) {
        console.warn('Direct Supabase fetch error:', err);
      }
    }

    if (rows && rows.length > 0) {
      setTableData(rows);
      setLastRefreshed(new Date().toLocaleTimeString());
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchTable();
    // Refresh table every 4 seconds
    const interval = setInterval(fetchTable, 4000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (ts) => {
    if (!ts) return 'N/A';
    try {
      return new Date(ts).toLocaleTimeString();
    } catch (e) {
      return String(ts);
    }
  };

  return (
    <div className={`enterprise-card backend-data-table-card ${isEmergency ? 'emergency-sms-theme' : ''}`} style={{ marginTop: '20px' }}>
      <div className="card-header-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="card-title-left">
          <span style={{ fontSize: '16px' }}>🗄️</span>
          <div>
            <div style={{ fontSize: '14.5px', fontWeight: 800, fontFamily: 'var(--font-heading)' }}>
              Database Table (<code>sensor_data</code>)
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>
              Live hardware telemetry and incident records stored in database • {dataSource}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10.5px', background: '#F1F5F9', color: '#475569', padding: '3px 10px', borderRadius: '8px', fontWeight: 700, fontFamily: 'var(--font-tactical)', letterSpacing: '0.04em' }}>
            {tableData.length} RECORDS LOADED
          </span>
          <button
            type="button"
            className="btn-enterprise secondary"
            onClick={fetchTable}
            disabled={isLoading}
            style={{ fontSize: '11px', padding: '3px 8px' }}
            title="Refresh database records"
          >
            {isLoading ? '...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto', marginTop: '12px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', color: '#475569', fontFamily: 'var(--font-tactical)', letterSpacing: '0.06em' }}>
              <th style={{ padding: '8px 10px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '10.5px' }}>ID</th>
              <th style={{ padding: '8px 10px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '10.5px' }}>Timestamp</th>
              <th style={{ padding: '8px 10px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '10.5px' }}>Temperature</th>
              <th style={{ padding: '8px 10px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '10.5px' }}>Humidity</th>
              <th style={{ padding: '8px 10px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '10.5px' }}>Smoke / Gas</th>
              <th style={{ padding: '8px 10px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '10.5px' }}>Flame Sensor</th>
              <th style={{ padding: '8px 10px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '10.5px' }}>Alerts</th>
              <th style={{ padding: '8px 10px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '10.5px' }}>Buzzer</th>
              <th style={{ padding: '8px 10px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '10.5px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {tableData.length === 0 ? (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center', padding: '20px', color: '#94A3B8', fontFamily: 'var(--font-sans)' }}>
                  Waiting for hardware readings... ESP32 records will appear here as soon as uploaded.
                </td>
              </tr>
            ) : (
              tableData.map((row) => {
                const isFlameAlert = row.flame_state === 1 || row.flame_alert === true;
                const isTempAlert = row.temperature_alert === true;
                const isGasAlert = row.gas_alert === true;
                // Strict AND multi-sensor fire detection condition matching ESP32 ALARM_ACTIVE stage:
                const isFireRow = row.buzzer === true || (isFlameAlert && isTempAlert && isGasAlert) || row.fire_status === true;

                const isGasConnected = row.gas_state !== false && row.gas_value !== null && row.gas_value !== undefined && row.gas_value !== -1;
                const isTempConnected = row.temperature !== null && row.temperature !== undefined;
                const isFlameConnected = row.flame_sensor_state !== false;

                return (
                  <tr
                    key={row.id}
                    style={{
                      borderBottom: '1px solid #E2E8F0',
                      background: isFireRow ? '#FEE2E2' : 'transparent',
                      fontWeight: isFireRow ? 700 : 400,
                      color: isFireRow ? '#991B1B' : '#1E293B'
                    }}
                  >
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>#{row.id}</td>
                    <td style={{ padding: '8px 10px', color: isFireRow ? '#7F1D1D' : '#64748B', fontFamily: 'var(--font-mono)' }}>
                      {formatTime(row.created_at || row.timestamp)}
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>
                      {isTempConnected ? (
                        <span>{parseFloat(row.temperature).toFixed(1)} °C</span>
                      ) : (
                        <span style={{ color: '#EF4444', fontWeight: 600, fontFamily: 'var(--font-sans)' }}>null (Disconnected)</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>
                      {row.humidity !== null && row.humidity !== undefined ? (
                        <span>{row.humidity} %</span>
                      ) : (
                        <span style={{ color: '#94A3B8', fontFamily: 'var(--font-sans)' }}>null (Excluded)</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>
                      {isGasConnected ? (
                        <span style={{ color: '#047857', fontWeight: 600 }}>{parseInt(row.gas_value, 10)} PPM</span>
                      ) : (
                        <span style={{ color: '#EF4444', fontWeight: 600, fontFamily: 'var(--font-sans)' }}>null (Disconnected)</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {isFlameConnected ? (
                        isFlameAlert ? (
                          <span style={{ color: '#DC2626', fontWeight: 800, fontFamily: 'var(--font-tactical)' }}>🔥 1 (FLAME DETECTED)</span>
                        ) : (
                          <span style={{ color: '#16A34A', fontWeight: 600, fontFamily: 'var(--font-tactical)' }}>0 (SAFE / CLEAR)</span>
                        )
                      ) : (
                        <span style={{ color: '#EF4444', fontWeight: 600, fontFamily: 'var(--font-sans)' }}>null (Disconnected)</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {isTempAlert && <span style={{ background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA', padding: '1px 6px', borderRadius: '9999px', fontSize: '9px', fontWeight: 700, fontFamily: 'var(--font-tactical)', letterSpacing: '0.04em' }}>TEMP ALERT</span>}
                        {isGasAlert && <span style={{ background: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A', padding: '1px 6px', borderRadius: '9999px', fontSize: '9px', fontWeight: 700, fontFamily: 'var(--font-tactical)', letterSpacing: '0.04em' }}>GAS ALERT</span>}
                        {isFlameAlert && <span style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', padding: '1px 6px', borderRadius: '9999px', fontSize: '9px', fontWeight: 800, fontFamily: 'var(--font-tactical)', letterSpacing: '0.04em' }}>FLAME ALERT</span>}
                        {!isTempAlert && !isGasAlert && !isFlameAlert && <span style={{ color: '#94A3B8', fontSize: '10.5px', fontFamily: 'var(--font-sans)' }}>None</span>}
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {row.buzzer ? (
                        <span style={{ color: '#DC2626', fontWeight: 800, fontFamily: 'var(--font-tactical)' }}>🔔 ON (ACTIVE)</span>
                      ) : (
                        <span style={{ color: '#64748B', fontFamily: 'var(--font-tactical)' }}>🔕 OFF</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {isFireRow ? (
                        <span style={{ background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA', padding: '2px 8px', borderRadius: '9999px', fontSize: '10.5px', fontWeight: 700, fontFamily: 'var(--font-tactical)', letterSpacing: '0.04em' }}>
                          🚨 CRITICAL FIRE
                        </span>
                      ) : (
                        <span style={{ background: '#ECFDF5', color: '#047857', border: '1px solid #A7F3D0', padding: '2px 8px', borderRadius: '9999px', fontSize: '10.5px', fontWeight: 700, fontFamily: 'var(--font-tactical)', letterSpacing: '0.04em' }}>
                          NORMAL
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {lastRefreshed && (
        <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '8px', textAlign: 'right' }}>
          Live connected to <strong>{dataSource}</strong> • Last refreshed: {lastRefreshed}
        </div>
      )}
    </div>
  );
}

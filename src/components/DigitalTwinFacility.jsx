import React from 'react';

/**
 * Digital Twin Facility Component
 * Renders an architectural multi-tier schematic visualization of the monitored facility.
 * Displays real telemetry status across zones without claiming fake sensor coordinates.
 */
export default function DigitalTwinFacility({ isEmergency, isWarning, isStale, tempVal, smokeVal, flameDetected, cameraState }) {
  const safeTemp = typeof tempVal === 'number' && !isNaN(tempVal) ? `${tempVal.toFixed(1)}°C` : 'Temp: --';
  const safeSmoke = typeof smokeVal === 'number' && !isNaN(smokeVal) ? `${smokeVal.toFixed(0)} PPM` : 'Smoke: --';

  const facilityStatusText = isEmergency 
    ? 'HAZARD DETECTED — SECTOR A' 
    : isWarning 
    ? 'ELEVATED RISK ENVELOPE' 
    : isStale 
    ? 'TELEMETRY STALE / SIGNAL LOST' 
    : 'FACILITY INTEGRITY NOMINAL';

  const sectorAStatus = isEmergency ? 'hazard' : isWarning ? 'warning' : 'nominal';

  return (
    <div className={`digital-twin-card ${isEmergency ? 'emergency' : ''}`}>
      <div className="digital-twin-header">
        <div className="digital-twin-title-wrap">
          <div className="twin-pulse-indicator">
            <span className={`twin-dot ${isEmergency ? 'pulse-red' : isWarning ? 'pulse-amber' : isStale ? 'pulse-gray' : 'pulse-blue'}`}></span>
          </div>
          <div>
            <h3 className="digital-twin-title">Digital Twin • Facility Projection</h3>
            <p className="digital-twin-subtitle">Architectural BIM schematic & environmental telemetry projection</p>
          </div>
        </div>
        <div className="digital-twin-badge-wrap">
          <span className={`twin-status-badge ${sectorAStatus}`}>
            {facilityStatusText}
          </span>
        </div>
      </div>

      {/* SVG Architectural Isometric / Elevation Schematic */}
      <div className="digital-twin-viewport">
        <svg 
          viewBox="0 0 680 280" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
          className="digital-twin-svg"
        >
          <defs>
            <linearGradient id="wallGradNormal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563EB" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#2563EB" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="wallGradHazard" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#DC2626" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#DC2626" stopOpacity="0.08" />
            </linearGradient>
            <linearGradient id="gridGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#1D4ED8" stopOpacity="0.02" />
            </linearGradient>
            <filter id="hazardGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Perspective Ground Grid */}
          <path 
            d="M 40 250 L 640 250 M 80 260 L 600 260 M 130 270 L 550 270 M 120 240 L 40 275 M 240 240 L 200 275 M 340 240 L 340 275 M 440 240 L 480 275 M 560 240 L 640 275" 
            stroke="var(--border-grid, #DCE6F2)" 
            strokeWidth="1.2" 
            strokeDasharray="4 4"
          />

          {/* Main Building Shell Outer Wireframe */}
          <rect 
            x="80" 
            y="40" 
            width="520" 
            height="200" 
            rx="8" 
            fill="url(#wallGradNormal)" 
            stroke="var(--twin-outer-stroke, #2563EB)" 
            strokeWidth="1.8" 
            strokeOpacity="0.8"
          />

          {/* Roof Feature & HVAC Units */}
          <path d="M 120 40 L 120 26 L 190 26 L 190 40" stroke="var(--twin-outer-stroke, #2563EB)" strokeWidth="1.5" strokeOpacity="0.6" />
          <path d="M 480 40 L 480 20 L 560 20 L 560 40" stroke="var(--twin-outer-stroke, #2563EB)" strokeWidth="1.5" strokeOpacity="0.6" />
          <circle cx="520" cy="30" r="5" stroke="var(--twin-outer-stroke, #2563EB)" strokeWidth="1.2" strokeOpacity="0.6" />

          {/* Tier Separator: Floor 02 Line */}
          <line x1="80" y1="105" x2="600" y2="105" stroke="var(--twin-tier-stroke, #CBD5E1)" strokeWidth="1.5" />

          {/* Tier Separator: Floor 01 Line */}
          <line x1="80" y1="170" x2="600" y2="170" stroke="var(--twin-tier-stroke, #CBD5E1)" strokeWidth="1.5" />

          {/* Vertical Sector Dividers */}
          <line x1="260" y1="40" x2="260" y2="240" stroke="var(--twin-tier-stroke, #CBD5E1)" strokeWidth="1.2" strokeDasharray="3 3" />
          <line x1="440" y1="40" x2="440" y2="240" stroke="var(--twin-tier-stroke, #CBD5E1)" strokeWidth="1.2" strokeDasharray="3 3" />

          {/* === LEVEL 2: Executive & Control Offices === */}
          <text x="96" y="62" fill="var(--twin-label-muted, #64748B)" fontSize="10" fontWeight="600" letterSpacing="0.05em">LEVEL 02 • CONTROL ROOMS & IT</text>
          
          {/* Room windows / nodes level 2 */}
          <rect x="100" y="72" width="60" height="22" rx="4" fill="#FFFFFF" fillOpacity="0.7" stroke="var(--twin-tier-stroke, #CBD5E1)" strokeWidth="1" />
          <rect x="180" y="72" width="60" height="22" rx="4" fill="#FFFFFF" fillOpacity="0.7" stroke="var(--twin-tier-stroke, #CBD5E1)" strokeWidth="1" />
          <rect x="280" y="72" width="70" height="22" rx="4" fill="#FFFFFF" fillOpacity="0.7" stroke="var(--twin-tier-stroke, #CBD5E1)" strokeWidth="1" />
          <rect x="370" y="72" width="50" height="22" rx="4" fill="#FFFFFF" fillOpacity="0.7" stroke="var(--twin-tier-stroke, #CBD5E1)" strokeWidth="1" />
          <rect x="460" y="72" width="120" height="22" rx="4" fill="#FFFFFF" fillOpacity="0.7" stroke="var(--twin-tier-stroke, #CBD5E1)" strokeWidth="1" />

          {/* === LEVEL 1: Sector-A IoT Monitored Assembly Area === */}
          {/* This zone reflects the actual sensor payload */}
          <g className={`sector-a-zone ${isEmergency ? 'active-hazard-pulse' : ''}`}>
            <rect 
              x="82" 
              y="106" 
              width="177" 
              height="63" 
              fill={isEmergency ? 'url(#wallGradHazard)' : 'transparent'} 
              stroke={isEmergency ? '#DC2626' : 'none'} 
              strokeWidth={isEmergency ? '2' : '0'}
              filter={isEmergency ? 'url(#hazardGlow)' : 'none'}
            />
            <text x="94" y="125" fill={isEmergency ? '#DC2626' : 'var(--twin-label-primary, #172B4D)'} fontSize="10" fontWeight="700">
              SECTOR A • PRIMARY NODE
            </text>
            <text x="94" y="141" fill="var(--twin-label-muted, #64748B)" fontSize="9">
              ESP32 + MQ-2 + Flame + DHT11
            </text>
            <text x="94" y="157" fill={isEmergency ? '#B91C1C' : '#2563EB'} fontSize="9" fontWeight="600">
              {safeTemp} • {safeSmoke} • {flameDetected ? 'FLAME' : 'Safe'}
            </text>
          </g>

          <text x="276" y="125" fill="var(--twin-label-muted, #64748B)" fontSize="9.5" fontWeight="600">SECTOR B • STAGING &amp; LOGISTICS</text>
          <text x="456" y="125" fill="var(--twin-label-muted, #64748B)" fontSize="9.5" fontWeight="600">SECTOR C • EAST PASSAGE</text>

          {/* Camera Node Icon on Level 1 */}
          <g transform="translate(225, 115)">
            <circle cx="12" cy="12" r="10" fill={cameraState === 'Live' ? '#10B981' : isEmergency ? '#DC2626' : '#94A3B8'} fillOpacity="0.2" />
            <circle cx="12" cy="12" r="5" fill={cameraState === 'Live' ? '#10B981' : isEmergency ? '#DC2626' : '#94A3B8'} />
            <path d="M 8 9 L 14 9 L 14 15 L 8 15 Z M 14 10.5 L 17 9 L 17 15 L 14 13.5" fill="#FFFFFF" />
          </g>

          {/* === GROUND FLOOR: Safety Actuation, Sprinklers, Utility === */}
          <text x="96" y="190" fill="var(--twin-label-muted, #64748B)" fontSize="10" fontWeight="600" letterSpacing="0.05em">GROUND LEVEL • MECHANICAL & SUPPRESSION</text>
          
          {/* Main Entrance Door */}
          <rect x="320" y="200" width="40" height="40" rx="2" fill="none" stroke="var(--twin-tier-stroke, #CBD5E1)" strokeWidth="1.5" />
          <line x1="340" y1="200" x2="340" y2="240" stroke="var(--twin-tier-stroke, #CBD5E1)" strokeWidth="1" strokeDasharray="2 2" />

          {/* Sprinkler / Pump Station Node */}
          <g transform="translate(110, 205)">
            <rect x="0" y="0" width="110" height="26" rx="4" fill="#FFFFFF" fillOpacity="0.8" stroke="var(--twin-tier-stroke, #CBD5E1)" strokeWidth="1" />
            <circle cx="14" cy="13" r="5" fill={isEmergency ? '#DC2626' : '#16A34A'} />
            <text x="26" y="17" fill="var(--twin-label-primary, #172B4D)" fontSize="9" fontWeight="600">
              Sprinkler Relay
            </text>
          </g>

          {/* Emergency Exit Route Highlight */}
          {isEmergency && (
            <g className="evacuation-route">
              <path 
                d="M 220 168 L 220 220 L 320 220" 
                stroke="#DC2626" 
                strokeWidth="2.5" 
                strokeDasharray="6 4" 
                strokeLinecap="round"
              />
              <circle cx="320" cy="220" r="4" fill="#DC2626" />
              <text x="230" y="212" fill="#DC2626" fontSize="9" fontWeight="700">EVACUATION ROUTE</text>
            </g>
          )}

          {/* Status Overlay Pill in SVG */}
          <g transform="translate(500, 200)">
            <rect x="0" y="0" width="85" height="28" rx="6" fill="#0E2345" fillOpacity="0.85" />
            <text x="42" y="18" fill="#FFFFFF" fontSize="9" fontWeight="700" textAnchor="middle">
              {isEmergency ? 'EVACUATE' : 'SECURE'}
            </text>
          </g>
        </svg>
      </div>

      <div className="digital-twin-footer">
        <div className="twin-meta-item">
          <span className="twin-meta-label">Primary Zone:</span>
          <span className="twin-meta-val">Sector-A (Active Node)</span>
        </div>
        <div className="twin-meta-item">
          <span className="twin-meta-label">Camera Surveillance:</span>
          <span className="twin-meta-val">{cameraState === 'Live' ? 'Active Video Relay' : cameraState}</span>
        </div>
        <div className="twin-meta-item">
          <span className="twin-meta-label">Telemetry Status:</span>
          <span className="twin-meta-val">{isStale ? 'Stale (>30s)' : 'Live Data Stream'}</span>
        </div>
      </div>
    </div>
  );
}


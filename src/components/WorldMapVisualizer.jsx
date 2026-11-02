// src/components/WorldMapVisualizer.jsx
// Tactical World Map with live GPS radar tracking and Street View toggle

import React, { useState } from 'react';

// Simplified high-precision equirectangular continent polygon paths (800x400)
const CONTINENT_PATHS = {
  north_america: "M 26.7,53.3 L 40.0,66.7 L 26.7,82.2 L 55.6,73.3 L 86.7,66.7 L 100.0,80.0 L 122.2,88.9 L 124.4,115.6 L 140.0,128.9 L 155.6,148.9 L 166.7,155.6 L 184.4,160.0 L 204.4,164.4 L 215.6,177.8 L 228.9,182.2 L 222.2,180.0 L 217.8,168.9 L 202.2,153.3 L 184.4,142.2 L 200.0,133.3 L 217.8,144.4 L 222.2,144.4 L 233.3,122.2 L 244.4,106.7 L 257.8,100.0 L 266.7,97.8 L 277.8,84.4 L 266.7,77.8 L 257.8,66.7 L 233.3,62.2 L 217.8,55.6 L 204.4,44.4 L 188.9,33.3 L 133.3,31.1 L 100.0,44.4 L 55.6,42.2 L 33.3,44.4 Z",
  greenland: "M 302.2,66.7 L 322.2,55.6 L 344.4,44.4 L 355.6,28.9 L 333.3,15.6 L 277.8,15.6 L 244.4,28.9 L 277.8,44.4 L 288.9,55.6 L 300.0,66.7 Z",
  south_america: "M 228.9,182.2 L 240.0,175.6 L 264.4,177.8 L 288.9,200.0 L 322.2,211.1 L 317.8,226.7 L 308.9,246.7 L 293.3,262.2 L 277.8,275.6 L 255.6,293.3 L 251.1,320.0 L 233.3,311.1 L 235.6,288.9 L 242.2,266.7 L 231.1,231.1 L 220.0,211.1 L 224.4,195.6 L 228.9,182.2 Z",
  europe: "M 380.0,120.0 L 380.0,104.4 L 400.0,102.2 L 388.9,93.3 L 404.4,86.7 L 417.8,80.0 L 411.1,71.1 L 411.1,62.2 L 433.3,55.6 L 462.2,42.2 L 488.9,48.9 L 511.1,48.9 L 533.3,66.7 L 522.2,77.8 L 488.9,88.9 L 477.8,100.0 L 462.2,108.9 L 455.6,120.0 L 444.4,113.3 L 433.3,115.6 L 431.1,100.0 L 411.1,104.4 L 393.3,117.8 L 380.0,120.0 Z",
  uk_ireland: "M 377.8,84.4 L 386.7,77.8 L 377.8,80.0 L 386.7,71.1 L 395.6,71.1 L 402.2,84.4 L 388.9,88.9 L 377.8,84.4 Z",
  scandinavia: "M 411.1,62.2 L 422.2,71.1 L 440.0,75.6 L 448.9,66.7 L 462.2,44.4 L 455.6,42.2 L 433.3,48.9 L 411.1,62.2 Z",
  africa: "M 386.7,120.0 L 424.4,117.8 L 433.3,128.9 L 471.1,131.1 L 475.6,140.0 L 495.6,173.3 L 513.3,175.6 L 493.3,200.0 L 488.9,222.2 L 477.8,253.3 L 471.1,262.2 L 462.2,271.1 L 440.0,275.6 L 437.8,251.1 L 426.7,233.3 L 420.0,191.1 L 406.7,186.7 L 373.3,188.9 L 362.2,166.7 L 362.2,153.3 L 371.1,137.8 L 386.7,120.0 Z",
  madagascar: "M 497.8,226.7 L 511.1,231.1 L 504.4,255.6 L 495.6,255.6 L 497.8,226.7 Z",
  asia: "M 533.3,66.7 L 533.3,48.9 L 566.7,33.3 L 633.3,28.9 L 700.0,40.0 L 777.8,48.9 L 800.0,55.6 L 755.6,77.8 L 733.3,66.7 L 711.1,88.9 L 688.9,106.7 L 671.1,117.8 L 666.7,133.3 L 644.4,155.6 L 633.3,177.8 L 622.2,191.1 L 633.3,211.1 L 655.6,217.8 L 640.0,166.7 L 633.3,153.3 L 604.4,151.1 L 595.6,151.1 L 577.8,171.1 L 571.1,182.2 L 560.0,155.6 L 551.1,144.4 L 533.3,144.4 L 522.2,144.4 L 511.1,133.3 L 488.9,115.6 L 477.8,100.0 L 488.9,88.9 L 522.2,77.8 L 533.3,66.7 Z",
  japan: "M 711.1,102.2 L 715.6,111.1 L 704.4,122.2 L 691.1,126.7 L 688.9,131.1 L 695.6,124.4 L 711.1,115.6 L 711.1,102.2 Z",
  indonesia_philippines: "M 611.1,188.9 L 633.3,213.3 L 655.6,217.8 L 677.8,217.8 L 688.9,206.7 L 711.1,204.4 L 711.1,217.8 L 666.7,211.1 L 622.2,200.0 L 611.1,188.9 Z",
  australia: "M 653.3,248.9 L 653.3,275.6 L 666.7,275.6 L 688.9,271.1 L 706.7,277.8 L 726.7,284.4 L 740.0,262.2 L 722.2,233.3 L 715.6,224.4 L 702.2,226.7 L 688.9,228.9 L 675.6,235.6 L 653.3,248.9 Z",
  new_zealand: "M 782.2,277.8 L 795.6,282.2 L 788.9,293.3 L 777.8,302.2 L 768.9,302.2 L 782.2,291.1 L 782.2,277.8 Z",
  antarctica: "M 0.0,373.3 L 133.3,364.4 L 266.7,344.4 L 400.0,355.6 L 533.3,351.1 L 666.7,346.7 L 800.0,373.3 L 800.0,395.6 L 0.0,395.6 L 0.0,373.3 Z"
};

export default function WorldMapVisualizer({
  latitude = 28.840016,
  longitude = 77.112264,
  facilityName = 'FireGuard Monitored Facility',
  isEmergency = false
}) {
  const [mapMode, setMapMode] = useState('world'); // 'world' | 'street'

  // Equirectangular mapping to 800x400 canvas
  const safeLat = typeof latitude === 'number' && !isNaN(latitude) ? latitude : 28.840016;
  const safeLng = typeof longitude === 'number' && !isNaN(longitude) ? longitude : 77.112264;

  const pinX = Math.max(10, Math.min(790, ((safeLng + 180) / 360) * 800));
  const pinY = Math.max(10, Math.min(390, ((90 - safeLat) / 180) * 400));

  // OpenStreetMap Bounding Box
  const delta = 0.015;
  const bbox = `${(safeLng - delta).toFixed(5)}%2C${(safeLat - delta).toFixed(5)}%2C${(safeLng + delta).toFixed(5)}%2C${(safeLat + delta).toFixed(5)}`;
  const osmEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${safeLat}%2C${safeLng}`;

  return (
    <div className={`tactical-map-viewport ${isEmergency ? 'is-emergency' : ''}`}>
      {/* Top Map HUD Controls */}
      <div className="map-hud-bar">
        <div className="map-hud-title">
          <span className="map-radar-pulse"></span>
          <span>GEOGRAPHIC DISPATCH RADAR</span>
        </div>
        <div className="map-view-switcher">
          <button
            type="button"
            className={`map-switch-btn ${mapMode === 'world' ? 'active' : ''}`}
            onClick={() => setMapMode('world')}
          >
            🌐 World
          </button>
          <button
            type="button"
            className={`map-switch-btn ${mapMode === 'street' ? 'active' : ''}`}
            onClick={() => setMapMode('street')}
          >
            🗺️ Street
          </button>
        </div>
      </div>

      {/* Main Map Body */}
      <div className="map-display-area">
        {mapMode === 'world' ? (
          <div className="world-svg-container">
            <svg
              viewBox="0 0 800 400"
              className="world-map-svg"
              preserveAspectRatio="xMidYMid slice"
            >
              <defs>
                {/* Ocean background gradient */}
                <linearGradient id="oceanGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0B132B" />
                  <stop offset="100%" stopColor="#111C3A" />
                </linearGradient>
                {/* Continents gradient */}
                <linearGradient id="continentGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#2A3859" />
                  <stop offset="100%" stopColor="#1E293B" />
                </linearGradient>
                {/* Radar pulse gradient */}
                <radialGradient id="radarPulse" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(239, 68, 68, 0.8)" />
                  <stop offset="70%" stopColor="rgba(239, 68, 68, 0.25)" />
                  <stop offset="100%" stopColor="rgba(239, 68, 68, 0)" />
                </radialGradient>
              </defs>

              {/* Background Ocean */}
              <rect width="800" height="400" fill="url(#oceanGrad)" rx="8" />

              {/* Latitude Grid Lines (Parallels) */}
              <line x1="0" y1="66.7" x2="800" y2="66.7" stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="3,4" />
              <line x1="0" y1="133.3" x2="800" y2="133.3" stroke="rgba(255, 255, 255, 0.06)" strokeDasharray="3,4" />
              <line x1="0" y1="200" x2="800" y2="200" stroke="rgba(59, 130, 246, 0.22)" strokeDasharray="4,4" />
              <line x1="0" y1="266.7" x2="800" y2="266.7" stroke="rgba(255, 255, 255, 0.06)" strokeDasharray="3,4" />
              <line x1="0" y1="333.3" x2="800" y2="333.3" stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="3,4" />

              {/* Longitude Grid Lines (Meridians) */}
              <line x1="133.3" y1="0" x2="133.3" y2="400" stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="3,4" />
              <line x1="266.7" y1="0" x2="266.7" y2="400" stroke="rgba(255, 255, 255, 0.06)" strokeDasharray="3,4" />
              <line x1="400" y1="0" x2="400" y2="400" stroke="rgba(59, 130, 246, 0.22)" strokeDasharray="4,4" />
              <line x1="533.3" y1="0" x2="533.3" y2="400" stroke="rgba(255, 255, 255, 0.06)" strokeDasharray="3,4" />
              <line x1="666.7" y1="0" x2="666.7" y2="400" stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="3,4" />

              {/* Continent Landmasses */}
              <g className="world-continents-group">
                {Object.entries(CONTINENT_PATHS).map(([key, d]) => (
                  <path
                    key={key}
                    d={d}
                    fill="url(#continentGrad)"
                    stroke="#384C72"
                    strokeWidth="0.8"
                    opacity="0.85"
                  />
                ))}
              </g>

              {/* Target Reticle Crosshair at Coordinates */}
              <g className="target-reticle-group">
                <line
                  x1={pinX - 25}
                  y1={pinY}
                  x2={pinX + 25}
                  y2={pinY}
                  stroke={isEmergency ? '#EF4444' : '#10B981'}
                  strokeWidth="1"
                  strokeDasharray="2,3"
                  opacity="0.8"
                />
                <line
                  x1={pinX}
                  y1={pinY - 25}
                  x2={pinX}
                  y2={pinY + 25}
                  stroke={isEmergency ? '#EF4444' : '#10B981'}
                  strokeWidth="1"
                  strokeDasharray="2,3"
                  opacity="0.8"
                />

                {/* Animated Pulsing Sonar Rings */}
                <circle
                  cx={pinX}
                  cy={pinY}
                  r="14"
                  fill="none"
                  stroke={isEmergency ? '#EF4444' : '#10B981'}
                  strokeWidth="1.5"
                  className="sonar-ring-1"
                />
                <circle
                  cx={pinX}
                  cy={pinY}
                  r="26"
                  fill="none"
                  stroke={isEmergency ? '#EF4444' : '#10B981'}
                  strokeWidth="1"
                  className="sonar-ring-2"
                />

                {/* Center Core GPS Beacon */}
                <circle
                  cx={pinX}
                  cy={pinY}
                  r="4.5"
                  fill={isEmergency ? '#EF4444' : '#10B981'}
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  className="sonar-beacon-core"
                />
              </g>

              {/* Latitude / Longitude Equator / Prime Labels */}
              <text x="10" y="20" fill="rgba(255, 255, 255, 0.35)" fontSize="9" fontFamily="var(--font-mono)">
                80°N
              </text>
              <text x="10" y="196" fill="rgba(59, 130, 246, 0.6)" fontSize="9" fontFamily="var(--font-mono)">
                0° EQUATOR
              </text>
              <text x="10" y="385" fill="rgba(255, 255, 255, 0.35)" fontSize="9" fontFamily="var(--font-mono)">
                80°S
              </text>
              <text x="390" y="392" fill="rgba(59, 130, 246, 0.6)" fontSize="8.5" fontFamily="var(--font-mono)">
                0° MERIDIAN
              </text>
            </svg>

            {/* Floating Telemetry Coordinates Badge */}
            <div className="map-coords-overlay">
              <span className="coords-pulse-dot"></span>
              <span className="coords-text">
                {safeLat.toFixed(4)}°N, {safeLng.toFixed(4)}°E
              </span>
            </div>
          </div>
        ) : (
          <div className="street-map-frame-wrapper">
            <iframe
              title="Facility OpenStreetMap View"
              src={osmEmbedUrl}
              className="street-map-iframe"
              loading="lazy"
            />
          </div>
        )}
      </div>
    </div>
  );
}


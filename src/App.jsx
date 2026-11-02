import React, { useState, useEffect, useRef, useCallback } from 'react';
import Chart from 'chart.js/auto';
import { sensorService, mapDatabaseRow } from './services/sensorService';
import { websocketService } from './services/websocketService';
import { audioService } from './services/AudioService';
import { notificationService } from './services/NotificationService';
import EmergencyPopup from './components/EmergencyPopup';
import EmergencyBanner from './components/EmergencyBanner';
import DigitalTwinFacility from './components/DigitalTwinFacility';
import FacilityLocationCard from './components/FacilityLocationCard';
import LocationConfigModal from './components/LocationConfigModal';
import SmsAlertCard from './components/SmsAlertCard';
import { locationService } from './services/locationService';
import { smsService } from './services/smsService';

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const DEFAULT_RELAY_STREAM_URL = `${BACKEND_BASE_URL}/camera/stream`;

const safeFormatTemp = (val) => (typeof val === 'number' && !isNaN(val) ? `${val.toFixed(1)} °C` : 'DISCONNECTED');
const safeFormatSmoke = (val) => (typeof val === 'number' && !isNaN(val) ? `${val.toFixed(0)} PPM` : 'DISCONNECTED');
const safeFormatHumidity = (val) => (typeof val === 'number' && !isNaN(val) ? `${val.toFixed(0)} %` : 'EXCLUDED');

export default function App() {
  // Navigation tabs: 'overview', 'live', 'camera', 'sensors', 'history', 'diagnostics', 'settings'
  const [currentTab, setCurrentTab] = useState('overview');

  // System severity states: 'SAFE', 'WARNING', 'CRITICAL'
  const [systemState, setSystemState] = useState('SAFE');

  // Supabase Live Alarm states
  const [supabaseFireStatus, setSupabaseFireStatus] = useState(false);
  const [supabaseFireSeverity, setSupabaseFireSeverity] = useState('CRITICAL');
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [supabaseChannelStatus, setSupabaseChannelStatus] = useState('CONNECTING');

  // Backend WebSocket states
  const [wsStatus, setWsStatus] = useState('DISCONNECTED');
  const [backendCameraConnected, setBackendCameraConnected] = useState(false);

  // Audio system state
  const [audioState, setAudioState] = useState(audioService.getAudioState());

  // Hardware health status states
  const [backendHealth, setBackendHealth] = useState({
    deviceOnline: false,
    temperatureSensor: false,
    smokeSensor: false,
    flameSensor: false,
    wifiConnected: false,
    pumpStatus: false,
    cameraStatus: 'offline'
  });
  const [secondsSinceLastHeartbeat, setSecondsSinceLastHeartbeat] = useState(null);
  const lastHeartbeatTimeRef = useRef(null);
  const prevTimestampRef = useRef(null);
  const lastPacketTimeRef = useRef(null);
  const [isDataStale, setIsDataStale] = useState(false);

  // Manual & Auto Controls
  const [autoMode, setAutoMode] = useState(true);
  const [sprinklerActive, setSprinklerActive] = useState(false);
  const [emergencyOverride, setEmergencyOverride] = useState(false);

  // Emergency Popup manual dismiss flag
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [fireEventTimestamp, setFireEventTimestamp] = useState(null);

  // Facility Location state (persisted locally)
  const [facilityLocation, setFacilityLocation] = useState(locationService.getLocation());
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);

  // Subscribe to location updates
  useEffect(() => {
    const unsub = locationService.onLocationChange((loc) => {
      setFacilityLocation(loc);
    });
    return unsub;
  }, []);

  // Live Camera states: 'Offline', 'Connecting', 'Live', 'Disconnected', 'Stream unavailable', 'Reconnecting'
  const [cameraState, setCameraState] = useState('Offline');
  const [liveStreamUrl, setLiveStreamUrl] = useState(DEFAULT_RELAY_STREAM_URL);
  const [streamRetryCount, setStreamRetryCount] = useState(0);
  const streamRetryTimerRef = useRef(null);
  const cameraContainerRef = useRef(null);
  const dedicatedCameraRef = useRef(null);
  const [lastUpdateTime, setLastUpdateTime] = useState('');

  // Live telemetry values (actual sensor values, null if absent)
  const [sensors, setSensors] = useState({
    temp: { val: null, peak: null, min: null, status: 'UNKNOWN', active: false },
    smoke: { val: null, peak: null, min: null, status: 'UNKNOWN', active: false },
    flame: { detected: false, rawState: 0, status: 'SAFE', active: true, connected: true },
    humidity: { val: null, status: 'UNKNOWN' }
  });

  // Thresholds
  const thresholds = {
    temp: 20.0,
    smoke: 800,
    flame: 1.50
  };

  // Logs & Incident Lists
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [responseLogs, setResponseLogs] = useState([]);
  const [incidents, setIncidents] = useState([]);

  // Realtime Clock Strings
  const [timeStr, setTimeStr] = useState('');
  const [dateStr, setDateStr] = useState('');

  // Diagnostic drill test
  const [incidentStage, setIncidentStage] = useState(0);
  const drillTimerRef = useRef(null);

  // Mobile sidebar toggle
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Canvas and Chart Refs
  const mainCanvasRef = useRef(null);
  const tempCanvasRef = useRef(null);
  const smokeCanvasRef = useRef(null);
  const flameCanvasRef = useRef(null);

  // Dashboard Overview Detail Chart Refs
  const dashTempCanvasRef = useRef(null);
  const dashSmokeCanvasRef = useRef(null);
  const dashFlameCanvasRef = useRef(null);

  const mainChartRef = useRef(null);
  const tempChartRef = useRef(null);
  const smokeChartRef = useRef(null);
  const flameChartRef = useRef(null);

  const dashTempChartRef = useRef(null);
  const dashSmokeChartRef = useRef(null);
  const dashFlameChartRef = useRef(null);

  // Data Buffers for charts (sliding window of 24 ticks, initialized to 0/neutral)
  const maxTicks = 24;

  const chartLabelsRef = useRef(
    Array.from({ length: 24 }, (_, i) => {
      const d = new Date(Date.now() - (24 - i) * 1000);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    })
  );
  const chartTempDataRef = useRef(Array.from({ length: 24 }, () => 0));
  const chartSmokeDataRef = useRef(Array.from({ length: 24 }, () => 0));
  const chartFlameDataRef = useRef(Array.from({ length: 24 }, () => 0));

  // Refs to prevent stale closures
  const sensorsRef = useRef(sensors);
  const currentTabRef = useRef(currentTab);
  const autoModeRef = useRef(autoMode);
  const sprinklerActiveRef = useRef(sprinklerActive);
  const emergencyOverrideRef = useRef(emergencyOverride);
  const systemStateRef = useRef(systemState);
  const isFireActiveRef = useRef(false);
  const isDataStaleRef = useRef(true);

  useEffect(() => { sensorsRef.current = sensors; }, [sensors]);
  useEffect(() => { currentTabRef.current = currentTab; }, [currentTab]);
  useEffect(() => { autoModeRef.current = autoMode; }, [autoMode]);
  useEffect(() => { sprinklerActiveRef.current = sprinklerActive; }, [sprinklerActive]);
  useEffect(() => { emergencyOverrideRef.current = emergencyOverride; }, [emergencyOverride]);
  useEffect(() => { systemStateRef.current = systemState; }, [systemState]);
  useEffect(() => { isDataStaleRef.current = isDataStale; }, [isDataStale]);

  // Scroll reveal observer: smoothly brings tiles up on scroll and when navigating tabs
  useEffect(() => {
    const tileSelector = '.enterprise-card, .hero-sensor-card, .camera-feed-card, .facility-location-card, .sensor-detail-card, .sms-alert-card, .controls-panel, .incident-card-enterprise, .audit-logs-card, .dedicated-camera-card, .settings-diagnostics-card, .backend-data-table-card';

    // When tab changes, reset tiles inside inactive sections so they animate up when visited
    const allTiles = document.querySelectorAll(tileSelector);
    allTiles.forEach((tile) => {
      const parentSection = tile.closest('.page-section');
      if (parentSection && !parentSection.classList.contains('active')) {
        tile.classList.remove('tile-visible');
      }
    });

    const updateTileVisibility = () => {
      const activeSection = document.querySelector('.page-section.active');
      if (!activeSection) return;

      const activeTiles = activeSection.querySelectorAll(tileSelector);
      const windowHeight = window.innerHeight;

      activeTiles.forEach((tile) => {
        const rect = tile.getBoundingClientRect();
        // Skip hidden elements
        if (rect.width === 0 && rect.height === 0) return;

        // Reveal tile as soon as its top boundary enters the viewport
        if (rect.top <= windowHeight - 15 && rect.bottom >= 0) {
          tile.classList.add('tile-visible');
        } else if (rect.top > windowHeight + 120) {
          // Retain visibility until pushed completely below viewport
          tile.classList.remove('tile-visible');
        }
      });
    };

    // Staggered reveals on tab change & initial mount
    updateTileVisibility();
    const timer1 = setTimeout(updateTileVisibility, 40);
    const timer2 = setTimeout(updateTileVisibility, 140);
    const timer3 = setTimeout(updateTileVisibility, 320);

    let observer;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('tile-visible');
            } else if (entry.boundingClientRect.top > window.innerHeight + 120) {
              entry.target.classList.remove('tile-visible');
            }
          });
        },
        {
          root: null,
          threshold: 0.05,
          rootMargin: '40px 0px 40px 0px'
        }
      );

      const activeSection = document.querySelector('.page-section.active');
      if (activeSection) {
        const activeTiles = activeSection.querySelectorAll(tileSelector);
        activeTiles.forEach((tile) => observer.observe(tile));
      }
    }

    window.addEventListener('scroll', updateTileVisibility, { passive: true });
    window.addEventListener('resize', updateTileVisibility, { passive: true });

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      window.removeEventListener('scroll', updateTileVisibility);
      window.removeEventListener('resize', updateTileVisibility);
      if (observer) observer.disconnect();
    };
  }, [currentTab]);

  // Overall Emergency State computed (Condition: Supabase confirmed fire OR Manual Override OR CRITICAL sensor limits)
  // When device is offline/stale, stale historical records do NOT trigger emergency alarms!
  const isFireActive = !isDataStale && (supabaseFireStatus || (systemState === 'CRITICAL')) || emergencyOverride;
  isFireActiveRef.current = isFireActive;

  const activeSeverity = supabaseFireStatus ? supabaseFireSeverity : (emergencyOverride ? 'CRITICAL' : 'WARNING');
  const isBuzzerActive = sprinklerActive || isFireActive;
  const isWarningActive = !isDataStale && (systemState === 'WARNING') && !isFireActive;

  // Verified system status text for header
  let verifiedStatusMode = 'normal'; // 'normal', 'warning', 'emergency', 'unavailable'
  let verifiedStatusText = 'SYSTEM NOMINAL • SECURE';

  if (isFireActive) {
    verifiedStatusMode = 'emergency';
    verifiedStatusText = 'CRITICAL EMERGENCY • FIRE DETECTED';
  } else if (isWarningActive) {
    verifiedStatusMode = 'warning';
    verifiedStatusText = 'ELEVATED RISK • INSPECTION ADVISED';
  } else if (isDataStale || !supabaseConnected) {
    verifiedStatusMode = 'unavailable';
    verifiedStatusText = !supabaseConnected ? 'DATABASE OFFLINE' : 'HARDWARE OFFLINE (STANDBY)';
  }

  // Audio system state listener
  useEffect(() => {
    const unsub = audioService.onStateChange((state) => {
      setAudioState(state);
    });
    return unsub;
  }, []);

  // Connect to backend WebSocket server on mount
  useEffect(() => {
    websocketService.connect();

    const unsubStatus = websocketService.onStatusChange((status) => {
      setWsStatus(status);
    });

    const unsubMsg = websocketService.onMessage((msg) => {
      if (msg.type === 'FIRE_STATUS') {
        if (msg.fire_status) {
          setSupabaseFireStatus(true);
          if (msg.fire_severity) setSupabaseFireSeverity(msg.fire_severity);
          if (msg.data) {
            handleTelemetryUpdate(mapDatabaseRow(msg.data) || msg.data);
          }
        } else {
          setSupabaseFireStatus(false);
          if (msg.data) {
            handleTelemetryUpdate(mapDatabaseRow(msg.data) || msg.data);
          }
        }
      } else if (msg.type === 'TELEMETRY') {
        if (msg.data) {
          handleTelemetryUpdate(mapDatabaseRow(msg.data) || msg.data);
        }
      } else if (msg.type === 'CAMERA_STATUS') {
        setBackendCameraConnected(Boolean(msg.connected));
      } else if (msg.type === 'STREAM_STATUS') {
        if (msg.streaming) {
          if (cameraState !== 'Live') setCameraState('Connecting');
        } else {
          if (!isFireActiveRef.current) setCameraState('Offline');
        }
      } else if (msg.type === 'SMS_STATUS') {
        smsService.handleWebSocketEvent(msg);
      }
    });

    return () => {
      unsubStatus();
      unsubMsg();
      websocketService.disconnect();
    };
  }, []);

  // Camera activation lifecycle on confirmed fire detection
  useEffect(() => {
    if (isFireActive) {
      setCameraState((prev) => (prev === 'Offline' ? 'Connecting' : prev));
      setStreamRetryCount(0);
    } else {
      setCameraState('Offline');
      setStreamRetryCount(0);
      if (streamRetryTimerRef.current) {
        clearTimeout(streamRetryTimerRef.current);
        streamRetryTimerRef.current = null;
      }
    }
  }, [isFireActive]);

  // Safe camera stream error handler with backoff
  const handleCameraStreamError = () => {
    if (!isFireActiveRef.current) {
      setCameraState('Offline');
      return;
    }

    if (streamRetryCount < 3) {
      setCameraState('Reconnecting');
      const nextCount = streamRetryCount + 1;
      setStreamRetryCount(nextCount);

      if (streamRetryTimerRef.current) clearTimeout(streamRetryTimerRef.current);
      streamRetryTimerRef.current = setTimeout(() => {
        setLiveStreamUrl(`${DEFAULT_RELAY_STREAM_URL}?t=${Date.now()}`);
        setCameraState('Connecting');
      }, 4000);
    } else {
      setCameraState('Stream unavailable');
    }
  };

  const handleCameraStreamSuccess = () => {
    setCameraState('Live');
    setStreamRetryCount(0);
  };

  const manualRetryStream = () => {
    setStreamRetryCount(0);
    setCameraState('Connecting');
    setLiveStreamUrl(`${DEFAULT_RELAY_STREAM_URL}?t=${Date.now()}`);
  };

  const toggleFullscreen = (targetRef) => {
    const el = (targetRef && targetRef.current) || cameraContainerRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen().catch((err) => {
        console.warn("Fullscreen toggle error:", err);
      });
    } else {
      document.exitFullscreen().catch((err) => {
        console.warn("Exit fullscreen error:", err);
      });
    }
  };

  // Seed incident history
  useEffect(() => {
    try {
      const list = JSON.parse(localStorage.getItem('fire_incidents') || '[]');
      if (list.length === 0) {
        const defaultList = [
          {
            date: '05 July 2026',
            fireTime: '10:24 AM',
            alertTime: '10:24:08 AM',
            sensors: { flame: true, smoke: true, temp: true },
            status: 'Alert Sent Successfully'
          }
        ];
        localStorage.setItem('fire_incidents', JSON.stringify(defaultList));
        setIncidents(defaultList);
      } else {
        setIncidents(list);
      }
    } catch (e) {
      console.warn('Failed to parse incident history:', e);
    }
  }, []);

  // Clock tick
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
      setDateStr(now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  // Setup Charts on mount
  useEffect(() => {
    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      spanGaps: true,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            color: '#64748B',
            font: { family: 'Inter', size: 11, weight: '600' },
            usePointStyle: true,
            boxWidth: 8
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(220, 230, 242, 0.6)', drawBorder: false },
          ticks: { color: '#94A3B8', font: { family: 'Inter', size: 9 }, maxRotation: 0 }
        },
        y: {
          grid: { color: 'rgba(220, 230, 242, 0.6)', drawBorder: false },
          ticks: { color: '#94A3B8', font: { family: 'Inter', size: 9 } }
        }
      }
    };

    if (mainCanvasRef.current && !mainChartRef.current) {
      const ctxMain = mainCanvasRef.current.getContext('2d');
      mainChartRef.current = new Chart(ctxMain, {
        type: 'line',
        data: {
          labels: chartLabelsRef.current,
          datasets: [
            {
              label: 'Temp (°C)',
              data: chartTempDataRef.current,
              borderColor: '#F97316',
              backgroundColor: 'transparent',
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.35,
              yAxisID: 'y'
            },
            {
              label: 'Smoke (PPM)',
              data: chartSmokeDataRef.current,
              borderColor: '#8B5CF6',
              backgroundColor: 'transparent',
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.35,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          ...chartOptions,
          scales: {
            x: chartOptions.scales.x,
            y: {
              type: 'linear',
              display: true,
              position: 'left',
              grid: { color: 'rgba(226, 232, 240, 0.45)' },
              ticks: { color: '#F97316', font: { family: 'Inter', size: 9 } }
            },
            y1: {
              type: 'linear',
              display: false,
              position: 'right',
              grid: { drawOnChartArea: false },
              ticks: { color: '#8B5CF6', font: { family: 'Inter', size: 9 } }
            }
          }
        }
      });
    }

    const detailOptions = (suggestedMin, suggestedMax, unit = '') => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: '#0F172A',
          titleColor: '#94A3B8',
          bodyColor: '#F8FAFC',
          titleFont: { family: 'Inter', size: 10, weight: '500' },
          bodyFont: { family: 'Inter', size: 12, weight: '700' },
          padding: 8,
          boxPadding: 4,
          cornerRadius: 6,
          displayColors: false,
          callbacks: {
            title: (items) => items[0]?.label ? `Time: ${items[0].label}` : 'Live Telemetry',
            label: (ctx) => `Reading: ${ctx.parsed.y}${unit ? ' ' + unit : ''}`
          }
        }
      },
      scales: {
        x: { display: false, grid: { display: false } },
        y: { display: false, grid: { display: false }, suggestedMin, suggestedMax }
      }
    });

    const fullChartOptions = (suggestedMin, suggestedMax, unit = '', axisTitle = '', isBinary = false) => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: '#0F172A',
          titleColor: '#94A3B8',
          bodyColor: '#F8FAFC',
          titleFont: { family: "'Space Grotesk', 'Outfit', sans-serif", size: 11, weight: '700' },
          bodyFont: { family: "'JetBrains Mono', monospace", size: 13, weight: '700' },
          padding: 10,
          boxPadding: 6,
          cornerRadius: 8,
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          displayColors: false,
          callbacks: {
            title: (items) => items[0]?.label ? `Time: ${items[0].label}` : 'Live Telemetry',
            label: (ctx) => {
              if (isBinary) {
                return `Flame State: ${ctx.parsed.y >= 0.5 ? '🔥 1 (FLAME DETECTED)' : '🛡️ 0 (SAFE / CLEAR)'}`;
              }
              return `Reading: ${ctx.parsed.y}${unit ? ' ' + unit : ''}`;
            }
          }
        }
      },
      scales: {
        x: {
          display: true,
          grid: {
            display: true,
            color: 'rgba(226, 232, 240, 0.7)',
            lineWidth: 1,
            drawBorder: false
          },
          ticks: {
            display: true,
            color: '#64748B',
            font: { family: "'JetBrains Mono', monospace", size: 11, weight: '500' },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12
          },
          title: {
            display: true,
            text: 'Timeline (HH:MM:SS)',
            color: '#475569',
            font: { family: "'Space Grotesk', 'Outfit', sans-serif", size: 12, weight: '700' },
            padding: { top: 8, bottom: 2 }
          }
        },
        y: {
          display: true,
          suggestedMin,
          suggestedMax,
          grid: {
            display: true,
            color: 'rgba(226, 232, 240, 0.85)',
            lineWidth: 1,
            drawBorder: false
          },
          ticks: {
            display: true,
            color: '#334155',
            font: { family: "'JetBrains Mono', monospace", size: 11.5, weight: '600' },
            padding: 10,
            stepSize: isBinary ? 1 : undefined,
            callback: function(value) {
              if (isBinary) {
                if (value === 0) return '0 (Safe)';
                if (value === 1) return '1 (Flame)';
                return '';
              }
              return unit ? `${value} ${unit}` : value;
            }
          },
          title: {
            display: true,
            text: axisTitle || (unit ? `Unit: ${unit}` : 'Sensor Value'),
            color: '#1E293B',
            font: { family: "'Space Grotesk', 'Outfit', sans-serif", size: 12, weight: '700' },
            padding: { top: 2, bottom: 8 }
          }
        }
      }
    });

    const createGradientDataset = (data, borderColor, colorStart, colorEnd, pointColor) => ({
      data,
      borderColor,
      borderWidth: 2.5,
      tension: 0.45,
      fill: 'origin',
      backgroundColor: (context) => {
        const chart = context.chart;
        const { ctx, chartArea } = chart;
        if (!chartArea) return colorStart;
        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, colorStart);
        gradient.addColorStop(0.68, colorEnd);
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        return gradient;
      },
      pointRadius: (ctx) => {
        const index = ctx.dataIndex;
        const total = ctx.dataset.data.length;
        return index === total - 1 ? 4.5 : 0;
      },
      pointBackgroundColor: '#FFFFFF',
      pointBorderColor: pointColor || borderColor,
      pointBorderWidth: 2.5,
      pointHoverRadius: 6,
      pointHoverBackgroundColor: pointColor || borderColor,
      pointHoverBorderColor: '#FFFFFF',
      pointHoverBorderWidth: 2
    });

    if (tempCanvasRef.current && !tempChartRef.current) {
      const ctxTemp = tempCanvasRef.current.getContext('2d');
      tempChartRef.current = new Chart(ctxTemp, {
        type: 'line',
        data: {
          labels: chartLabelsRef.current,
          datasets: [createGradientDataset(chartTempDataRef.current, '#F97316', 'rgba(249, 115, 22, 0.38)', 'rgba(249, 115, 22, 0.08)', '#F97316')]
        },
        options: fullChartOptions(18, 42, '°C', 'Ambient Temperature (°C)')
      });
    }

    if (dashTempCanvasRef.current && !dashTempChartRef.current) {
      const ctx = dashTempCanvasRef.current.getContext('2d');
      dashTempChartRef.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: chartLabelsRef.current,
          datasets: [createGradientDataset(chartTempDataRef.current, '#F97316', 'rgba(249, 115, 22, 0.38)', 'rgba(249, 115, 22, 0.08)', '#F97316')]
        },
        options: detailOptions(18, 38, '°C')
      });
    }

    if (smokeCanvasRef.current && !smokeChartRef.current) {
      const ctxSmoke = smokeCanvasRef.current.getContext('2d');
      smokeChartRef.current = new Chart(ctxSmoke, {
        type: 'line',
        data: {
          labels: chartLabelsRef.current,
          datasets: [createGradientDataset(chartSmokeDataRef.current, '#8B5CF6', 'rgba(139, 92, 246, 0.38)', 'rgba(139, 92, 246, 0.08)', '#8B5CF6')]
        },
        options: fullChartOptions(100, 3600, 'PPM', 'Smoke / Gas Concentration (PPM)')
      });
    }

    if (dashSmokeCanvasRef.current && !dashSmokeChartRef.current) {
      const ctx = dashSmokeCanvasRef.current.getContext('2d');
      dashSmokeChartRef.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: chartLabelsRef.current,
          datasets: [createGradientDataset(chartSmokeDataRef.current, '#8B5CF6', 'rgba(139, 92, 246, 0.38)', 'rgba(139, 92, 246, 0.08)', '#8B5CF6')]
        },
        options: detailOptions(120, 320, 'PPM')
      });
    }

    if (flameCanvasRef.current && !flameChartRef.current) {
      const ctxFlame = flameCanvasRef.current.getContext('2d');
      flameChartRef.current = new Chart(ctxFlame, {
        type: 'line',
        data: {
          labels: chartLabelsRef.current,
          datasets: [createGradientDataset(chartFlameDataRef.current, '#10B981', 'rgba(16, 185, 129, 0.38)', 'rgba(16, 185, 129, 0.08)', '#10B981')]
        },
        options: fullChartOptions(-0.2, 1.25, '', 'Flame State (0 = Safe, 1 = Fire)', true)
      });
    }

    if (dashFlameCanvasRef.current && !dashFlameChartRef.current) {
      const ctx = dashFlameCanvasRef.current.getContext('2d');
      dashFlameChartRef.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: chartLabelsRef.current,
          datasets: [createGradientDataset(chartFlameDataRef.current, '#10B981', 'rgba(16, 185, 129, 0.38)', 'rgba(16, 185, 129, 0.08)', '#10B981')]
        },
        options: detailOptions(-0.25, 1.35, '')
      });
    }

    return () => {
      if (mainChartRef.current) { mainChartRef.current.destroy(); mainChartRef.current = null; }
      if (tempChartRef.current) { tempChartRef.current.destroy(); tempChartRef.current = null; }
      if (smokeChartRef.current) { smokeChartRef.current.destroy(); smokeChartRef.current = null; }
      if (flameChartRef.current) { flameChartRef.current.destroy(); flameChartRef.current = null; }
      if (dashTempChartRef.current) { dashTempChartRef.current.destroy(); dashTempChartRef.current = null; }
      if (dashSmokeChartRef.current) { dashSmokeChartRef.current.destroy(); dashSmokeChartRef.current = null; }
      if (dashFlameChartRef.current) { dashFlameChartRef.current.destroy(); dashFlameChartRef.current = null; }
    };
  }, []);

  // Real-time Chart Ticker (NO fake waves: pushes real values when live, neutral 0 when offline)
  useEffect(() => {
    const uiTick = () => {
      const isStale = isDataStaleRef.current;
      const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

      chartLabelsRef.current.push(timestamp);
      chartLabelsRef.current.shift();

      if (isStale) {
        chartTempDataRef.current.push(0);
        chartTempDataRef.current.shift();

        chartSmokeDataRef.current.push(0);
        chartSmokeDataRef.current.shift();

        chartFlameDataRef.current.push(0);
        chartFlameDataRef.current.shift();
      } else {
        const rawTemp = sensorsRef.current.temp.val;
        const tempVal = typeof rawTemp === 'number' && !isNaN(rawTemp) ? rawTemp : 0;
        chartTempDataRef.current.push(tempVal);
        chartTempDataRef.current.shift();

        const rawSmoke = sensorsRef.current.smoke.val;
        const smokeVal = typeof rawSmoke === 'number' && !isNaN(rawSmoke) ? rawSmoke : 0;
        chartSmokeDataRef.current.push(smokeVal);
        chartSmokeDataRef.current.shift();

        const flameDetected = sensorsRef.current.flame.detected;
        chartFlameDataRef.current.push(flameDetected ? 1.0 : 0.0);
        chartFlameDataRef.current.shift();
      }

      if (dashFlameChartRef.current && dashFlameChartRef.current.data?.datasets?.[0]) {
        const strokeColor = isStale ? '#94A3B8' : (sensorsRef.current.flame.detected ? '#EF4444' : '#10B981');
        dashFlameChartRef.current.data.datasets[0].borderColor = strokeColor;
        dashFlameChartRef.current.data.datasets[0].pointBackgroundColor = strokeColor;
      }
      if (flameChartRef.current && flameChartRef.current.data?.datasets?.[0]) {
        const strokeColor = isStale ? '#94A3B8' : (sensorsRef.current.flame.detected ? '#EF4444' : '#10B981');
        flameChartRef.current.data.datasets[0].borderColor = strokeColor;
        flameChartRef.current.data.datasets[0].pointBackgroundColor = strokeColor;
      }

      if (currentTabRef.current === 'overview' || currentTabRef.current === 'live') {
        if (mainChartRef.current) mainChartRef.current.update('none');
        if (dashTempChartRef.current) dashTempChartRef.current.update('none');
        if (dashSmokeChartRef.current) dashSmokeChartRef.current.update('none');
        if (dashFlameChartRef.current) dashFlameChartRef.current.update('none');
      }

      if (currentTabRef.current === 'sensors') {
        if (tempChartRef.current) tempChartRef.current.update('none');
        if (smokeChartRef.current) smokeChartRef.current.update('none');
        if (flameChartRef.current) flameChartRef.current.update('none');
      }
    };

    const interval = setInterval(uiTick, 1000);
    return () => clearInterval(interval);
  }, []);

  // Process incoming telemetry from Supabase
  const handleTelemetryUpdate = useCallback((data) => {
    if (!data) return;

    // Check packet freshness against server timestamp
    const packetTimestamp = data.timestamp || (data.createdAt ? new Date(data.createdAt).getTime() : null);
    const isLive = packetTimestamp ? (Date.now() - packetTimestamp < 20000) : false;

    if (isLive) {
      lastPacketTimeRef.current = Date.now();
      isDataStaleRef.current = false;
      setIsDataStale(false);
    } else {
      // Historical row from database when device is currently offline
      lastPacketTimeRef.current = packetTimestamp;
      isDataStaleRef.current = true;
      setIsDataStale(true);
    }

    const fStatus = isLive && data.fireStatus === true;
    const fSeverity = data.fireSeverity || 'CRITICAL';
    setSupabaseFireStatus(fStatus);
    setSupabaseFireSeverity(fSeverity);

    const tempVal = isLive ? data.temperature : null;
    const smokeVal = isLive ? data.gasValue : null;
    const isFlameActive = isLive && Boolean(data.flameDetected || data.flameState === 1 || data.flameAlert);
    const flameDetected = isFlameActive;
    const rawFlameState = isFlameActive ? 1 : 0;

    // Evaluate sensor warnings & limits against ESP32 alerts or thresholds
    let tempStatus = 'UNKNOWN';
    if (!isLive) {
      tempStatus = 'OFFLINE';
    } else if (data.temperatureAlert !== undefined && data.temperatureAlert !== null) {
      tempStatus = (data.temperatureAlert === true || data.temperatureAlert === 'true' || data.temperatureAlert === 1) ? 'CRITICAL' : (tempVal !== null ? 'SAFE' : 'UNKNOWN');
    } else if (tempVal !== null && tempVal !== undefined) {
      if (tempVal >= thresholds.temp) tempStatus = 'CRITICAL';
      else if (tempVal >= thresholds.temp * 0.75) tempStatus = 'WARNING';
      else tempStatus = 'SAFE';
    }

    let smokeStatus = 'UNKNOWN';
    if (!isLive) {
      smokeStatus = 'OFFLINE';
    } else if (data.gasAlert !== undefined && data.gasAlert !== null) {
      smokeStatus = (data.gasAlert === true || data.gasAlert === 'true' || data.gasAlert === 1) ? 'CRITICAL' : (smokeVal !== null ? 'SAFE' : 'UNKNOWN');
    } else if (smokeVal !== null && smokeVal !== undefined) {
      if (smokeVal >= thresholds.smoke) smokeStatus = 'CRITICAL';
      else if (smokeVal >= thresholds.smoke * 0.75) smokeStatus = 'WARNING';
      else smokeStatus = 'SAFE';
    }

    const flameStatus = !isLive ? 'OFFLINE' : (isFlameActive ? 'CRITICAL' : 'SAFE');

    // Strict Multi-Sensor AND Validation:
    const tempCritical = isLive && tempStatus === 'CRITICAL';
    const smokeCritical = isLive && smokeStatus === 'CRITICAL';
    const flameCritical = isLive && flameStatus === 'CRITICAL';
    const allThresholdsAchieved = tempCritical && smokeCritical && flameCritical;

    // Fire status is confirmed when ESP32 buzzer is active OR all thresholds achieved OR backend fire status is true
    const isFireConfirmed = isLive && Boolean(data.buzzer || allThresholdsAchieved || fStatus);

    // System state determination: CRITICAL only on live confirmed fire or manual override
    let maxSeverity = 'SAFE';
    if (emergencyOverrideRef.current || isFireConfirmed) {
      maxSeverity = 'CRITICAL';
    } else if (isLive && (tempCritical || smokeCritical || flameCritical || tempStatus === 'WARNING' || smokeStatus === 'WARNING')) {
      maxSeverity = 'WARNING';
    }

    if (maxSeverity !== systemStateRef.current) {
      triggerStateTransitionLogs(systemStateRef.current, maxSeverity, tempVal, smokeVal, flameDetected);
    }
    setSystemState(maxSeverity);

    // Auto-Action mode
    if (maxSeverity === 'CRITICAL' && autoModeRef.current && !sprinklerActiveRef.current) {
      setSprinklerActive(true);
      addResponseActionLog('ACTUATOR-ON', 'Automated sprinkler deluge relay opened.');
    }

    const isTempConnected = isLive && (data.dhtConnected ?? (tempVal !== null && tempVal !== undefined));
    const isGasConnected = isLive && (data.gasState ?? (smokeVal !== null && smokeVal !== undefined && smokeVal !== -1));

    setSensors((prev) => ({
      temp: {
        val: tempVal,
        connected: isTempConnected,
        peak: tempVal !== null ? (prev.temp.peak !== null ? Math.max(prev.temp.peak, tempVal) : tempVal) : prev.temp.peak,
        min: tempVal !== null ? (prev.temp.min !== null ? Math.min(prev.temp.min, tempVal) : tempVal) : prev.temp.min,
        status: isLive ? (isTempConnected ? tempStatus : 'DISCONNECTED') : 'OFFLINE',
        active: isTempConnected
      },
      smoke: {
        val: smokeVal,
        connected: isGasConnected,
        peak: smokeVal !== null ? (prev.smoke.peak !== null ? Math.max(prev.smoke.peak, smokeVal) : smokeVal) : prev.smoke.peak,
        min: smokeVal !== null ? (prev.smoke.min !== null ? Math.min(prev.smoke.min, smokeVal) : smokeVal) : prev.smoke.min,
        status: isLive ? (isGasConnected ? smokeStatus : 'DISCONNECTED') : 'OFFLINE',
        active: isGasConnected
      },
      flame: {
        detected: flameDetected,
        rawState: rawFlameState,
        connected: isLive,
        alert: isLive ? Boolean(data.flameAlert) : false,
        status: isLive ? (flameDetected ? 'CRITICAL' : 'SAFE') : 'OFFLINE',
        active: isLive
      },
      humidity: {
        val: isLive ? data.humidity : null,
        status: isLive ? (data.humidity !== null ? 'SAFE' : 'UNKNOWN') : 'OFFLINE'
      }
    }));

    setBackendHealth({
      deviceOnline: isLive,
      temperatureSensor: isTempConnected,
      smokeSensor: isGasConnected,
      flameSensor: isLive,
      wifiConnected: isLive,
      pumpStatus: Boolean(data.pumpStatus),
      cameraStatus: data.cameraStatus || 'offline'
    });

    if (data.timestamp !== undefined && data.timestamp !== null) {
      if (data.timestamp !== prevTimestampRef.current) {
        prevTimestampRef.current = data.timestamp;
        lastHeartbeatTimeRef.current = Date.now();
      }
    } else if (data.deviceOnline === true && lastHeartbeatTimeRef.current === null) {
      lastHeartbeatTimeRef.current = Date.now();
    }

    if (data.cameraStreamUrl && data.cameraStreamUrl.trim() !== '') {
      setLiveStreamUrl(data.cameraStreamUrl);
    }

    if (data.lastSeen) {
      setLastUpdateTime(new Date(data.lastSeen).toLocaleTimeString());
    } else if (data.timestamp) {
      setLastUpdateTime(new Date(data.timestamp).toLocaleTimeString());
    } else {
      setLastUpdateTime(new Date().toLocaleTimeString());
    }
  }, [thresholds.temp, thresholds.smoke]);

  // Supabase Real-time DB Listener
  useEffect(() => {
    let isMounted = true;

    const fetchInitial = async () => {
      try {
        const data = await sensorService.getLatestTelemetry();
        if (data && isMounted) {
          handleTelemetryUpdate(data);
        }
      } catch (err) {
        console.warn("Could not fetch initial telemetry from Supabase:", err);
      }
    };
    fetchInitial();

    const unsubscribe = sensorService.subscribeToTelemetry(
      (data) => {
        if (isMounted) handleTelemetryUpdate(data);
      },
      (status) => {
        if (!isMounted) return;
        setSupabaseChannelStatus(status);
        if (status === 'SUBSCRIBED') {
          setSupabaseConnected(true);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setSupabaseConnected(false);
        }
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [handleTelemetryUpdate]);

  // Stale Telemetry & Heartbeat Monitor
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      if (lastHeartbeatTimeRef.current !== null) {
        const diff = Math.max(0, Math.round((now - lastHeartbeatTimeRef.current) / 1000));
        setSecondsSinceLastHeartbeat(diff);
      } else {
        setSecondsSinceLastHeartbeat(null);
      }

      if (lastPacketTimeRef.current !== null) {
        const diffSeconds = (now - lastPacketTimeRef.current) / 1000;
        const stale = diffSeconds > 15;
        setIsDataStale(stale);
        isDataStaleRef.current = stale;
      } else {
        setIsDataStale(true);
        isDataStaleRef.current = true;
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const isEsp32Connected = backendHealth.deviceOnline &&
    secondsSinceLastHeartbeat !== null &&
    secondsSinceLastHeartbeat <= 20;

  // De-duplicated Alarm Trigger
  const prevFireStateRef = useRef(false);

  useEffect(() => {
    if (isFireActive) {
      if (!prevFireStateRef.current) {
        setAlertDismissed(false);
        const timeNow = new Date().toLocaleTimeString();
        setFireEventTimestamp(timeNow);

        notificationService.show(
          "🚨 FIRE DETECTED",
          `FireGuard Emergency Operations Center: Confirmed Fire Hazard (${activeSeverity.toUpperCase()}). Evacuate immediately.`
        );

        // Automatic Emergency SMS Dispatch to all registered emergency contact numbers
        smsService.sendEmergencyAlert(
          {
            temperature: sensorsRef.current.temp?.val,
            gas_value: sensorsRef.current.smoke?.val,
            flame: sensorsRef.current.flame?.detected,
            flame_state: sensorsRef.current.flame?.rawState,
            timestamp: new Date().toISOString(),
            severity: activeSeverity
          },
          facilityLocation
        ).then((res) => {
          if (res) {
            addResponseActionLog('SMS-BROADCAST', `Emergency SMS alert dispatched: ${res.status || 'OK'}`);
          }
        }).catch((err) => {
          console.warn('[SMS] Automatic dispatch error:', err);
        });
      }

      if (!alertDismissed) {
        audioService.startSiren();
      } else {
        audioService.stopSiren();
      }
    } else {
      audioService.stopSiren();
      setAlertDismissed(false);
      setFireEventTimestamp(null);
    }

    prevFireStateRef.current = isFireActive;
  }, [isFireActive, activeSeverity, alertDismissed]);

  const triggerStateTransitionLogs = (fromState, toState, tempVal, smokeVal, flameDetected) => {
    let title = '';
    let msg = '';
    const loc = 'Sector-A Assembly Area';

    if (toState === 'CRITICAL') {
      title = 'CRITICAL FIRE BREACH CONFIRMED';
      const tempDesc = safeFormatTemp(tempVal);
      const smokeDesc = safeFormatSmoke(smokeVal);
      const flameDesc = flameDetected ? 'DETECTED' : 'CLEAR';
      msg = `Hazard levels exceeded critical safety threshold! Temp: ${tempDesc}, Smoke: ${smokeDesc}, Flame: ${flameDesc}`;

      recordFireIncident(tempVal, smokeVal, flameDetected);
      addResponseActionLog('ALARM', 'Emergency siren array and evacuation protocols initialized.');
    } else if (toState === 'WARNING') {
      title = 'SAFETY ENVELOPE WARNING';
      msg = 'Sensors approaching operating threshold limits. Site inspection advised.';
    } else if (toState === 'SAFE' && fromState === 'CRITICAL') {
      title = 'HAZARD NEUTRALIZED';
      msg = 'All sensor readings verified within nominal envelope. Threat neutralized.';

      if (autoModeRef.current && sprinklerActiveRef.current) {
        setSprinklerActive(false);
        addResponseActionLog('ACTUATOR-OFF', 'Sprinkler deluge closed via auto-cooldown.');
      }
    }

    if (toState !== 'SAFE') {
      createTimelineAlert(title, msg, toState.toLowerCase(), loc);
    }
  };

  const recordFireIncident = (tempVal, smokeVal, flameDetected) => {
    const now = new Date();
    const fireDate = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const fireTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const alertTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    const incident = {
      date: fireDate,
      fireTime,
      alertTime,
      sensors: {
        flame: Boolean(flameDetected),
        smoke: smokeVal !== null && smokeVal >= thresholds.smoke,
        temp: tempVal !== null && tempVal >= thresholds.temp
      },
      status: 'Alert Sent Successfully'
    };

    setIncidents((prev) => {
      const list = [incident, ...prev];
      try {
        localStorage.setItem('fire_incidents', JSON.stringify(list.slice(0, 50)));
      } catch (e) {
        console.warn('Could not save incident to localStorage:', e);
      }
      return list;
    });
  };

  const addResponseActionLog = (type, details) => {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    const log = { type, time, details };
    setResponseLogs((prev) => [log, ...prev.slice(0, 99)]);
  };

  const createTimelineAlert = (title, message, severity, location) => {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false });
    const datestamp = new Date().toLocaleDateString();
    const alert = { title, message, severity, location, timestamp, datestamp };
    setActiveAlerts((prev) => [alert, ...prev.slice(0, 49)]);
  };

  const switchTab = (tabId) => {
    setCurrentTab(tabId);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      if ((tabId === 'overview' || tabId === 'live')) {
        if (mainChartRef.current) { mainChartRef.current.resize(); mainChartRef.current.update(); }
        if (dashTempChartRef.current) { dashTempChartRef.current.resize(); dashTempChartRef.current.update(); }
        if (dashSmokeChartRef.current) { dashSmokeChartRef.current.resize(); dashSmokeChartRef.current.update(); }
        if (dashFlameChartRef.current) { dashFlameChartRef.current.resize(); dashFlameChartRef.current.update(); }
      }
      if (tabId === 'sensors') {
        if (tempChartRef.current) { tempChartRef.current.resize(); tempChartRef.current.update(); }
        if (smokeChartRef.current) { smokeChartRef.current.resize(); smokeChartRef.current.update(); }
        if (flameChartRef.current) { flameChartRef.current.resize(); flameChartRef.current.update(); }
      }
    }, 60);
  };

  const triggerManualOverride = () => {
    const newVal = !emergencyOverride;
    setEmergencyOverride(newVal);
    if (newVal) {
      setAlertDismissed(false);
    }

    let nextState = systemState;
    if (newVal) {
      nextState = 'CRITICAL';
    } else {
      const tempCritical = typeof sensors.temp.val === 'number' && sensors.temp.val >= thresholds.temp;
      const smokeCritical = typeof sensors.smoke.val === 'number' && sensors.smoke.val >= thresholds.smoke;
      const flameCritical = sensors.flame.detected;

      const tempWarning = typeof sensors.temp.val === 'number' && sensors.temp.val >= thresholds.temp * 0.75;
      const smokeWarning = typeof sensors.smoke.val === 'number' && sensors.smoke.val >= thresholds.smoke * 0.75;

      // Strict Multi-Sensor AND condition: ALL thresholds must be achieved simultaneously
      const allThresholdsAchieved = tempCritical && smokeCritical && flameCritical;

      if (allThresholdsAchieved) {
        nextState = 'CRITICAL';
      } else if (tempCritical || smokeCritical || flameCritical || tempWarning || smokeWarning) {
        nextState = 'WARNING';
      } else {
        nextState = 'SAFE';
      }
    }

    if (nextState !== systemState) {
      triggerStateTransitionLogs(systemState, nextState, sensors.temp.val, sensors.smoke.val, sensors.flame.detected);
      setSystemState(nextState);
    }
  };

  const toggleSprinkler = () => {
    const nextVal = !sprinklerActive;
    setSprinklerActive(nextVal);
    addResponseActionLog(nextVal ? 'ACTUATOR-ON' : 'ACTUATOR-OFF', `Sprinkler suppression deluge ${nextVal ? 'engaged' : 'closed'} manually.`);
    if (nextVal) {
      createTimelineAlert('SPRINKLERS ENGAGED', 'Water discharge commenced via manual override.', 'info', 'All Sectors');
    }
  };

  const toggleAutoMode = () => {
    const nextVal = !autoMode;
    setAutoMode(nextVal);
    addResponseActionLog('MODE-CHANGE', `Auto Fire Defense ${nextVal ? 'ENABLED' : 'DISABLED'}.`);
  };

  const runDiagnosticTest = useCallback(() => {
    switchTab('overview');
    setIncidentStage(1);
    addResponseActionLog('DIAGNOSTICS', 'Mock hazard drill simulation initialized.');
    createTimelineAlert(
      'DRILL TESTING COMMENCED',
      'Diagnostics safety simulation active. Monitoring sensor behavior.',
      'info',
      'System Diagnostic Console'
    );

    // Also trigger mock SMS dispatch test during drill
    smsService.sendTestAlert(facilityLocation).then((res) => {
      if (res) {
        addResponseActionLog('SMS-DIAGNOSTIC', `SMS drill test: ${res.status || 'Simulated'}`);
      }
    }).catch(() => { });

    if (drillTimerRef.current) clearTimeout(drillTimerRef.current);
    drillTimerRef.current = setTimeout(() => {
      setIncidentStage(0);
      addResponseActionLog('DIAGNOSTICS', 'Mock hazard drill concluded. All systems nominal.');
    }, 8000);
  }, [switchTab, facilityLocation]);

  const resetEntireSystem = useCallback(() => {
    if (drillTimerRef.current) clearTimeout(drillTimerRef.current);
    setIncidentStage(0);
    setEmergencyOverride(false);
    setSprinklerActive(false);
    setAlertDismissed(true);
    setSupabaseFireStatus(false);
    setSupabaseFireSeverity('SAFE');
    setSystemState('SAFE');
    audioService.stopSiren();

    chartLabelsRef.current.fill('');
    chartTempDataRef.current = generateInitialWave(26.5, 0.55, 0.42);
    chartSmokeDataRef.current = generateInitialWave(204, 6.2, 0.35);
    chartFlameDataRef.current = Array.from({ length: 24 }, (_, i) => Number((0.04 + Math.sin(i * 0.45) * 0.02).toFixed(3)));

    if (mainChartRef.current) mainChartRef.current.update('none');
    if (tempChartRef.current) tempChartRef.current.update('none');
    if (smokeChartRef.current) smokeChartRef.current.update('none');
    if (flameChartRef.current) flameChartRef.current.update('none');
    if (dashTempChartRef.current) dashTempChartRef.current.update('none');
    if (dashSmokeChartRef.current) dashSmokeChartRef.current.update('none');
    if (dashFlameChartRef.current) dashFlameChartRef.current.update('none');

    addResponseActionLog('SYSTEM-RESET', 'Diagnostic states cleared. System returned to default calibration.');
    createTimelineAlert('SYSTEM CALIBRATED', 'Telemetry baseline re-calibrated. All overrides cleared.', 'safe', 'Control Console');
  }, []);

  const handlePopupClose = useCallback(() => {
    setAlertDismissed(true);
    audioService.stopSiren();
  }, []);

  const handlePopupViewDashboard = useCallback(() => {
    setAlertDismissed(true);
    audioService.stopSiren();
    switchTab('overview');
  }, [switchTab]);

  const getTabTitle = () => {
    switch (currentTab) {
      case 'live': return 'Live Monitoring • Digital Twin Operations';
      case 'camera': return 'Camera Surveillance • ESP32-CAM Relay';
      case 'sensors': return 'Sensor Analytics & Telemetry Envelopes';
      case 'history': return 'Event History & Incident Audits';
      case 'diagnostics': return 'System Diagnostics & Hardware Nodes';
      case 'settings': return 'System Settings & Control Matrix';
      default: return 'Overview • Command Center';
    }
  };

  return (
    <div className={`app-container ${isFireActive ? 'emergency-mode' : ''}`}>
      {/* Left Navigation Sidebar */}
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
        {/* Brand Logo */}
        <div className="sidebar-brand">
          <div className="brand-icon-wrapper">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              <path d="M12 8v4"></path>
              <path d="M12 16h.01"></path>
            </svg>
          </div>
          <div className="brand-text">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="brand-title">FireGuard</span>
              <span className="brand-pro-badge">PRO</span>
            </div>
            <span className="brand-subtitle">IoT Safety • Digital Twin</span>
          </div>
        </div>

        {/* ESP32 Gateway Status Pill */}
        <div className="sidebar-gateway-bar">
          <span className="gateway-label">ESP32-S3 N16R8</span>
          <span className="gateway-online-pill">
            <span className="status-dot-sm connected"></span> 99.8% Online
          </span>
        </div>

        {/* Sidebar Menu Items */}
        <ul className="sidebar-menu">
          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'overview' ? 'active' : ''}`}
              onClick={() => switchTab('overview')}
              data-nav="overview"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9" rx="1"></rect>
                <rect x="14" y="3" width="7" height="5" rx="1"></rect>
                <rect x="14" y="12" width="7" height="9" rx="1"></rect>
                <rect x="3" y="16" width="7" height="5" rx="1"></rect>
              </svg>
              <span className="sidebar-btn-label">Overview</span>
            </button>
          </li>

          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'camera' ? 'active' : ''}`}
              onClick={() => switchTab('camera')}
              data-nav="camera"
              title="Camera Surveillance • ESP32-CAM Relay"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z"></path>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
              </svg>
              <span className="sidebar-btn-label">Camera Surveillance</span>
              <span className={`sidebar-badge ${cameraState === 'Live' ? 'badge-camera-live' : isFireActive ? 'badge-camera-alert' : 'badge-camera-stby'}`}>
                {cameraState === 'Live' && <span className="sidebar-badge-pulse" />}
                {cameraState === 'Live' ? 'LIVE' : isFireActive ? 'ALERT' : 'STBY'}
              </span>
            </button>
          </li>

          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'sensors' ? 'active' : ''}`}
              onClick={() => switchTab('sensors')}
              data-nav="sensors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18"></path>
                <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"></path>
              </svg>
              <span className="sidebar-btn-label">Sensor Analytics</span>
            </button>
          </li>

          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'history' ? 'active' : ''}`}
              onClick={() => switchTab('history')}
              data-nav="history"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8v4l3 3"></path>
                <circle cx="12" cy="12" r="9"></circle>
              </svg>
              <span className="sidebar-btn-label">Event History</span>
              <span className="sidebar-badge badge-event-count">{incidents.length}</span>
            </button>
          </li>

          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'settings' ? 'active' : ''}`}
              onClick={() => switchTab('settings')}
              data-nav="settings"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
              <span className="sidebar-btn-label">Settings</span>
            </button>
          </li>
        </ul>

        {/* Project Credits Card */}
        <div className="sidebar-credits-section">
          <div className="sidebar-credits-card">
            <div className="credits-badge-row">
              <span className="credits-badge">MADE BY</span>
            </div>
            <div className="credits-team-grid">
              <div className="credits-member" title="Lakshay Jain">
                <span className="credits-initials">LJ</span>
                <span className="credits-name">Lakshay Jain</span>
              </div>
              <div className="credits-member" title="Arnav Jain">
                <span className="credits-initials">AJ</span>
                <span className="credits-name">Arnav Jain</span>
              </div>
              <div className="credits-member" title="Hiten Shah">
                <span className="credits-initials">HS</span>
                <span className="credits-name">Hiten Shah</span>
              </div>
              <div className="credits-member" title="Bhavye Sani">
                <span className="credits-initials">BS</span>
                <span className="credits-name">Bhavye Sani</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="app-main">
        {/* Sticky Pulsing Emergency Banner */}
        <EmergencyBanner
          active={isFireActive}
          timestamp={fireEventTimestamp || lastUpdateTime}
          severity={activeSeverity}
          onAcknowledge={handlePopupClose}
          facilityName={facilityLocation.facilityName}
        />

        {/* Top Header Bar */}
        <header className="top-header">
          <div className="header-left">
            <div className="header-branding">
              <div className="header-icon-badge">
                <span className="header-fire-icon">🔥</span>
              </div>
              <h1 className="header-title">Fire Safety Control Center</h1>
              <span className="header-live-status-pill">
                <span className="live-status-dot"></span>
                LIVE
              </span>
            </div>
          </div>

          <div className="header-right">
            {/* Real-time Time & Date Pill */}
            <div className="header-time-pill">
              <span className="header-time-icon">🕒</span>
              <span className="header-time">{timeStr}</span>
              <span className="header-dot">•</span>
              <span className="header-date">{dateStr}</span>
            </div>

            {/* Siren Armed Button */}
            <button
              onClick={() => audioService.unlockAudio()}
              className={`header-action-btn siren-btn ${audioState.isUnlocked ? 'armed' : 'unarmed'}`}
              title={audioState.isUnlocked ? 'Audio siren armed and unmuted' : 'Click to enable siren audio in browser'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              </svg>
              <span>{audioState.isUnlocked ? 'Siren Armed' : 'Enable Siren'}</span>
            </button>
          </div>
        </header>

        {/* Main Content Wrapper */}
        <main className={`main-wrapper ${isFireActive && !alertDismissed ? 'is-blurred' : ''}`}>

          {/* =================================================================
             VIEW 1: OVERVIEW (MAIN DASHBOARD)
             ================================================================= */}
          <section className={`page-section ${currentTab === 'overview' ? 'active' : ''}`}>

            {/* =================================================================
               ROW 1: TOP 3 HERO SENSOR TELEMETRY CARDS (DHT22, MQ-2, FLAME)
               ================================================================= */}
            <div className="hero-sensors-grid" style={{ marginBottom: '20px' }}>
              {/* Card 1: Ambient Temperature */}
              <div className="enterprise-card hero-sensor-card hero-temp-card">
                <div className="hero-card-header">
                  <div className="hero-chip-group">
                    <span className={`hero-chip ${isDataStale ? 'chip-offline' : 'chip-orange'}`}>DHT22</span>
                    <span className="hero-chip-sub">Digital Thermistor (GPIO 4)</span>
                  </div>
                  <div className={`hero-icon-box ${isDataStale ? 'box-offline' : 'box-orange'}`}>🌡️</div>
                </div>
                <div className="hero-sensor-title">Ambient Temperature</div>
                <div className="hero-reading-row">
                  <span className={`hero-reading-value ${isDataStale || sensors.temp.val === null ? 'is-disconnected' : ''}`}>
                    {isDataStale || sensors.temp.val === null ? '--.- °C' : safeFormatTemp(sensors.temp.val)}
                  </span>
                  <span className={`hero-pill-hw ${!isDataStale && sensors.temp.connected ? 'hw-connected' : 'hw-offline'}`}>
                    <span className={`status-dot-sm ${!isDataStale && sensors.temp.connected ? 'connected' : 'offline'}`}></span>
                    {!isDataStale && sensors.temp.connected ? 'Hardware Connected' : 'Hardware Offline'}
                  </span>
                </div>
                <div className="hero-status-row">
                  <div className="hero-status-left">
                    <span className={`status-dot-sm ${!isDataStale && sensors.temp.connected ? (sensors.temp.status === 'SAFE' ? 'connected' : 'disconnected') : 'offline'}`}></span>
                    <span className="hero-status-text" style={{ color: isDataStale ? '#64748B' : undefined }}>
                      {isDataStale ? 'Device Offline / Standby' : (sensors.temp.connected ? (sensors.temp.status === 'SAFE' ? 'Normal Operating Envelope' : sensors.temp.status) : 'Hardware Disconnected')}
                    </span>
                  </div>
                  <span className="hero-limit-text">Limit: 20°C (Baseline +2.0°C)</span>
                </div>
                <div className="hero-chart-container">
                  <canvas ref={dashTempCanvasRef} id="dashTempDetailChart"></canvas>
                </div>
                <div className="hero-card-footer">
                  <span>-60s</span>
                  <span className="footer-mid">
                    <span className={`pulse-indicator-dot ${isDataStale ? 'pulse-grey' : 'pulse-orange'}`}></span>
                    {isDataStale ? 'STANDBY (DEVICE OFFLINE)' : 'LIVE 1.0Hz SAMPLING'}
                  </span>
                  <span>NOW</span>
                </div>
              </div>

              {/* Card 2: Gas / Smoke Concentration */}
              <div className="enterprise-card hero-sensor-card hero-smoke-card">
                <div className="hero-card-header">
                  <div className="hero-chip-group">
                    <span className={`hero-chip ${isDataStale ? 'chip-offline' : 'chip-purple'}`}>MQ-2</span>
                    <span className="hero-chip-sub">Combustible Gas &amp; Smoke (GPIO 5)</span>
                  </div>
                  <div className={`hero-icon-box ${isDataStale ? 'box-offline' : 'box-purple'}`}>💨</div>
                </div>
                <div className="hero-sensor-title">Gas / Smoke Concentration</div>
                <div className="hero-reading-row">
                  <span className={`hero-reading-value ${isDataStale || sensors.smoke.val === null ? 'is-disconnected' : ''}`}>
                    {isDataStale || sensors.smoke.val === null ? '-- PPM' : safeFormatSmoke(sensors.smoke.val)}
                  </span>
                  <span className={`hero-pill-hw ${!isDataStale && sensors.smoke.connected ? 'hw-connected' : 'hw-offline'}`}>
                    <span className={`status-dot-sm ${!isDataStale && sensors.smoke.connected ? 'connected' : 'offline'}`}></span>
                    {!isDataStale && sensors.smoke.connected ? 'Hardware Connected' : 'Hardware Offline'}
                  </span>
                </div>
                <div className="hero-status-row">
                  <div className="hero-status-left">
                    <span className={`status-dot-sm ${!isDataStale && sensors.smoke.connected ? (sensors.smoke.status === 'SAFE' ? 'connected' : 'disconnected') : 'offline'}`}></span>
                    <span className="hero-status-text" style={{ color: isDataStale ? '#64748B' : undefined }}>
                      {isDataStale ? 'Device Offline / Standby' : (sensors.smoke.connected ? (sensors.smoke.status === 'SAFE' ? 'Normal Operating Envelope' : sensors.smoke.status) : 'Signal Unavailable / Disconnected')}
                    </span>
                  </div>
                  <span className="hero-limit-text">Trigger: 800 ADC (Baseline +150)</span>
                </div>
                <div className="hero-chart-container">
                  <canvas ref={dashSmokeCanvasRef} id="dashSmokeDetailChart"></canvas>
                </div>
                <div className="hero-card-footer">
                  <span>-60s</span>
                  <span className="footer-mid">
                    <span className={`pulse-indicator-dot ${isDataStale ? 'pulse-grey' : 'pulse-purple'}`}></span>
                    {isDataStale ? 'STANDBY (DEVICE OFFLINE)' : 'PPM: 12-BIT RES'}
                  </span>
                  <span>NOW</span>
                </div>
              </div>

              {/* Card 3: Optical Flame Sensor */}
              <div className={`enterprise-card hero-sensor-card hero-flame-card ${!isDataStale && sensors.flame.detected ? 'card-flame-critical' : ''}`}>
                <div className="hero-card-header">
                  <div className="hero-chip-group">
                    <span className={`hero-chip ${isDataStale ? 'chip-offline' : (sensors.flame.detected ? 'chip-red' : 'chip-green')}`}>
                      {isDataStale ? 'OFFLINE' : (sensors.flame.detected ? 'CRITICAL' : 'DIGITAL IR')}
                    </span>
                    <span className="hero-chip-sub">Active-Low Flame Sensor (GPIO 6)</span>
                  </div>
                  <div className={`hero-icon-box ${isDataStale ? 'box-offline' : (sensors.flame.detected ? 'box-red' : 'box-green')}`}>🔥</div>
                </div>
                <div className="hero-sensor-title">Optical Flame Sensor</div>
                <div className="hero-reading-row">
                  <span className={`hero-reading-value ${isDataStale ? 'val-flame-offline' : (sensors.flame.detected ? 'val-flame-alert' : 'val-flame-safe')}`}>
                    {isDataStale ? 'OFFLINE ( -- )' : (sensors.flame.detected ? '🔥 CRITICAL (1)' : 'CLEAR / SAFE (0)')}
                  </span>
                  <span className={`hero-pill-hw ${isDataStale ? 'hw-offline' : (sensors.flame.detected ? 'hw-alert-pill' : 'hw-connected')}`}>
                    <span className={`status-dot-sm ${isDataStale ? 'offline' : (sensors.flame.detected ? 'disconnected pulse-dot' : 'connected')}`}></span>
                    {isDataStale ? 'Hardware Offline' : (sensors.flame.detected ? 'CRITICAL HAZARD' : 'Hardware Connected')}
                  </span>
                </div>
                <div className="hero-status-row">
                  <div className="hero-status-left">
                    <span className={`status-dot-sm ${isDataStale ? 'offline' : (sensors.flame.detected ? 'disconnected' : 'connected')}`}></span>
                    <span className="hero-status-text" style={{ color: isDataStale ? '#64748B' : (sensors.flame.detected ? '#DC2626' : '#047857'), fontWeight: !isDataStale && sensors.flame.detected ? 700 : 600 }}>
                      {isDataStale ? 'Device Offline / Standby' : (sensors.flame.detected ? 'CRITICAL: FIRE HAZARD DETECTED' : 'Optical Baseline Safe (0)')}
                    </span>
                  </div>
                  <span className="hero-limit-text">Active: LOW (0V)</span>
                </div>
                <div className="hero-chart-container">
                  <canvas ref={dashFlameCanvasRef} id="dashFlameDetailChart"></canvas>
                </div>
                <div className="hero-card-footer">
                  <span>SAFE (0)</span>
                  <span className="footer-mid">
                    <span className={`pulse-indicator-dot ${isDataStale ? 'pulse-grey' : (sensors.flame.detected ? 'pulse-red' : 'pulse-green')}`}></span>
                    {isDataStale ? 'STANDBY (DEVICE OFFLINE)' : (sensors.flame.detected ? 'CRITICAL FLAME ACTIVE' : 'ACTIVE OPTICAL')}
                  </span>
                  <span>FLAME (1)</span>
                </div>
              </div>
            </div>

            {/* =================================================================
               ROW 2: 2-COLUMN GRID (ESP32-CAM SURVEILLANCE & FACILITY LOCATION)
               ================================================================= */}
            <div className="overview-row-grid" style={{ marginBottom: '22px' }}>
              {/* Left Column: ESP32-CAM Tactical Surveillance (Prominent Observation Viewport) */}
              <div
                ref={cameraContainerRef}
                className={`enterprise-card camera-feed-card ${isFireActive ? 'camera-card-priority' : ''}`}
                style={{ padding: '0', overflow: 'hidden' }}
              >
                <div className="camera-tactical-viewport">
                  {/* Top Tactical HUD */}
                  <div className="tactical-hud-header">
                    <div className="tactical-hud-cam-id">
                      <span className={`tactical-dot ${cameraState === 'Live' ? 'green' : isFireActive ? 'red' : 'green'}`}></span>
                      <div className="tactical-cam-text">
                        <span className="cam-code">CAM-01</span>
                        <span className="cam-sub">ESP32-CAM [STANDBY]</span>
                      </div>
                    </div>
                    <div className="tactical-hud-stats">
                      <span className="stat-badge">1.4 MBPS</span>
                      <span className="stat-badge">FOV: 120°</span>
                    </div>
                  </div>

                  {/* Center HUD / Feed */}
                  {isFireActive || cameraState === 'Live' ? (
                    <div className="tactical-live-feed-wrap">
                      <img
                        src={liveStreamUrl}
                        className="camera-img-feed"
                        alt="ESP32-CAM Stream"
                        onLoad={handleCameraStreamSuccess}
                        onError={handleCameraStreamError}
                      />
                      <div className="tactical-feed-badge">LIVE RELAY • ACTIVE</div>
                    </div>
                  ) : (
                    <div className="tactical-reticle-box">
                      <div className="tactical-title">Conditions Are Normal</div>
                      <div className="tactical-subtitle">OV2640 Sensor • Auto Flashlight Prime Ready</div>
                      <button className="tactical-connect-btn" onClick={manualRetryStream}>
                        ▶ Connect Live Stream
                      </button>
                    </div>
                  )}

                  {/* Bottom Tactical HUD */}
                  <div className="tactical-hud-footer">
                    <span className="tactical-fps">L-FPS: MJPEG</span>
                    <span className="tactical-res">1080p READY</span>
                    <span className="tactical-status-dot">●</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Facility Location & Routing */}
              <FacilityLocationCard
                location={facilityLocation}
                isEmergency={isFireActive}
                eventTimestamp={fireEventTimestamp || lastUpdateTime}
                onOpenConfig={() => setIsLocationModalOpen(true)}
              />
            </div>

            {/* =================================================================
               ROW 3: 2-COLUMN GRID (EMERGENCY SMS & SAFETY CONTROLS)
               ================================================================= */}
            <div className="overview-row-grid" style={{ marginBottom: '22px' }}>
              {/* Left Column: Emergency SMS Alerts */}
              <SmsAlertCard
                isEmergency={isFireActive}
                facilityLocation={facilityLocation}
              />

              {/* Right Column: Safety Command & Control Panel */}
              <div className="enterprise-card controls-panel">
                <div className="card-header-clean">
                  <h3 className="card-heading-sm">Safety Command &amp; Control</h3>
                  <span className="incident-count-chip">Incidents: {incidents.length}</span>
                </div>
                <button
                  className={`btn-enterprise danger ${emergencyOverride ? 'active' : ''}`}
                  onClick={triggerManualOverride}
                  style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 700 }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  </svg>
                  <span>{emergencyOverride ? 'Cancel Emergency Override' : 'Manual Emergency Override'}</span>
                </button>

                <button className="btn-enterprise secondary" onClick={toggleSprinkler} style={{ padding: '10px 14px' }}>
                  <span>Sprinkler Relay: {sprinklerActive ? 'ACTIVE' : 'OFF'}</span>
                </button>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn-enterprise secondary" style={{ flex: 1, padding: '9px 12px' }} onClick={toggleAutoMode}>
                    Auto Mode: {autoMode ? 'ON' : 'OFF'}
                  </button>
                  <button className="btn-enterprise secondary" style={{ flex: 1, padding: '9px 12px' }} onClick={runDiagnosticTest}>
                    {incidentStage > 0 ? '⏳ Drill Active...' : 'Drill Test'}
                  </button>
                </div>

                <button
                  className="btn-enterprise secondary"
                  style={{ marginTop: '4px', fontSize: '11.5px', color: '#64748B', padding: '8px 12px' }}
                  onClick={resetEntireSystem}
                >
                  Calibrate System Baseline
                </button>
              </div>
            </div>
          </section>

          {/* =================================================================
             VIEW 2: LIVE MONITORING (EXPANDED DIGITAL TWIN)
             ================================================================= */}
          <section className={`page-section ${currentTab === 'live' ? 'active' : ''}`}>
            <DigitalTwinFacility
              isEmergency={isFireActive}
              isWarning={isWarningActive}
              isStale={isDataStale}
              tempVal={sensors.temp.val}
              smokeVal={sensors.smoke.val}
              flameDetected={sensors.flame.detected}
              cameraState={cameraState}
            />
            <div style={{ marginTop: '20px' }}>
              <div className="enterprise-card">
                <div className="card-header-title">
                  <div className="card-title-left">
                    <span>Active Telemetry Matrix</span>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                  <div style={{ padding: '12px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-tactical)', letterSpacing: '0.04em' }}>TEMPERATURE NODE</div>
                    <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px', fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>
                      {safeFormatTemp(sensors.temp.val)}
                    </div>
                  </div>
                  <div style={{ padding: '12px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-tactical)', letterSpacing: '0.04em' }}>SMOKE NODE</div>
                    <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px', fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>
                      {safeFormatSmoke(sensors.smoke.val)}
                    </div>
                  </div>
                  <div style={{ padding: '12px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-tactical)', letterSpacing: '0.04em' }}>FLAME DETECTION</div>
                    <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px', color: sensors.flame.detected ? '#DC2626' : '#16A34A', fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>
                      {sensors.flame.detected ? 'DETECTED' : 'CLEAR'}
                    </div>
                  </div>
                  <div style={{ padding: '12px', background: 'var(--bg-main)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-tactical)', letterSpacing: '0.04em' }}>CAMERA RELAY</div>
                    <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px', fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>
                      {cameraState}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* =================================================================
             VIEW 3: CAMERA SURVEILLANCE (DEDICATED FULL-SCREEN/LARGE VIEW)
             ================================================================= */}
          <section className={`page-section ${currentTab === 'camera' ? 'active' : ''}`}>
            <div
              ref={dedicatedCameraRef}
              className="enterprise-card dedicated-camera-card"
              style={{ padding: '24px', background: '#0B1329', border: '1px solid #1E293B' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: cameraState === 'Live' ? '#16A34A' : '#DC2626',
                    boxShadow: cameraState === 'Live' ? '0 0 10px #16A34A' : '0 0 10px #DC2626'
                  }}></div>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: '#F8FAFC' }}>
                    ESP32-CAM Surveillance Feed Relay
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn-enterprise secondary"
                    onClick={() => toggleFullscreen(dedicatedCameraRef)}
                  >
                    ⛶ Toggle Fullscreen
                  </button>
                  <button
                    className="btn-enterprise secondary"
                    onClick={manualRetryStream}
                  >
                    🔄 Reconnect Stream
                  </button>
                  <button
                    className="btn-enterprise secondary"
                    onClick={() => switchTab('overview')}
                  >
                    ← Back to Overview
                  </button>
                </div>
              </div>

              {/* Large Camera Feed Display Box */}
              <div className="camera-preview-box" style={{ height: 'calc(100vh - 250px)', minHeight: '480px', maxHeight: '720px', aspectRatio: '16/9', borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
                {isFireActive || cameraState === 'Live' || cameraState === 'Connecting' || cameraState === 'Reconnecting' ? (
                  cameraState === 'Live' ? (
                    <img
                      src={liveStreamUrl}
                      className="camera-img-feed"
                      alt="ESP32-CAM Large Live Feed"
                      style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                      onLoad={handleCameraStreamSuccess}
                      onError={handleCameraStreamError}
                    />
                  ) : (
                    <div className="camera-standby-overlay">
                      <div className="camera-spinner"></div>
                      <div className="camera-standby-title" style={{ fontSize: '16px' }}>
                        Connecting to ESP32-CAM Relay ({cameraState})
                      </div>
                      <div className="camera-standby-desc">
                        Relaying MJPEG stream through backend at {DEFAULT_RELAY_STREAM_URL}...
                      </div>
                      <button
                        className="btn-enterprise secondary"
                        onClick={manualRetryStream}
                        style={{ marginTop: '12px' }}
                      >
                        Retry Now
                      </button>
                    </div>
                  )
                ) : (
                  <div className="camera-standby-overlay">
                    <div style={{ fontSize: '42px', marginBottom: '12px' }}>📹</div>
                    <div className="camera-standby-title" style={{ fontSize: '16px' }}>ESP32-CAM Surveillance Standby</div>
                    <div className="camera-standby-desc">Live camera feed activates automatically on fire detection. You can also preview or test the stream manually.</div>
                    <button
                      className="btn-enterprise secondary"
                      onClick={manualRetryStream}
                      style={{ marginTop: '14px', background: 'rgba(255, 255, 255, 0.1)', color: '#FFFFFF', borderColor: 'rgba(255, 255, 255, 0.2)' }}
                    >
                      ▶ Test / Preview Camera Stream
                    </button>
                  </div>
                )}

                {/* HUD Overlays */}
                <div className="camera-timestamp-tag" style={{ top: '16px', left: '16px', fontSize: '12px', padding: '4px 10px' }}>
                  REC ● {dateStr} {timeStr}
                </div>
                <div className="camera-channel-tag" style={{ bottom: '16px', right: '16px', fontSize: '12px', padding: '4px 10px' }}>
                  NODE #01 — ESP32-CAM Relay ({cameraState.toUpperCase()})
                </div>
              </div>
            </div>
          </section>

          {/* =================================================================
             VIEW 4: SENSOR ANALYTICS (DETAILED CHARTS - FULL WIDTH STACK)
             ================================================================= */}
          <section className={`page-section ${currentTab === 'sensors' ? 'active' : ''}`}>
            <div className="sensors-page-grid">
              {/* Temperature Detail - Full Width */}
              <div className="enterprise-card sensor-detail-card">
                <div className="sensor-detail-meta">
                  <div className="sensor-meta-top">
                    <div className="sensor-meta-icon">🌡️</div>
                    <div>
                      <div className="sensor-meta-name">Temperature Sensor (DHT22)</div>
                      <div className="sensor-meta-id">S-TEMP-001 (ESP32-S3 GPIO 4) • Real-time Micro-Climate Monitoring</div>
                    </div>
                  </div>
                  <div className="sensor-meta-right">
                    <div className="sensor-meta-val">
                      {safeFormatTemp(sensors.temp.val)}
                    </div>
                    <span className={`sensor-status-tag ${sensors.temp.val !== null ? (sensors.temp.status === 'SAFE' ? 'safe' : sensors.temp.status === 'WARNING' ? 'warning' : 'critical') : 'unavailable'}`}>
                      {sensors.temp.val !== null ? (sensors.temp.status === 'SAFE' ? 'Normal Operating Envelope' : sensors.temp.status) : 'Disconnected'}
                    </span>
                  </div>
                </div>
                <div className="chart-container-box" style={{ height: '280px', width: '100%', position: 'relative' }}>
                  <canvas ref={tempCanvasRef} id="tempDetailChart"></canvas>
                </div>
              </div>

              {/* Smoke Detail - Full Width */}
              <div className="enterprise-card sensor-detail-card">
                <div className="sensor-detail-meta">
                  <div className="sensor-meta-top">
                    <div className="sensor-meta-icon">💨</div>
                    <div>
                      <div className="sensor-meta-name">Smoke Density Sensor (MQ-2)</div>
                      <div className="sensor-meta-id">S-SMOK-002 (ESP32-S3 GPIO 5) • 12-Bit Analog ADC/PPM Telemetry</div>
                    </div>
                  </div>
                  <div className="sensor-meta-right">
                    <div className="sensor-meta-val">
                      {safeFormatSmoke(sensors.smoke.val)}
                    </div>
                    <span className={`sensor-status-tag ${sensors.smoke.val !== null ? (sensors.smoke.status === 'SAFE' ? 'safe' : sensors.smoke.status === 'WARNING' ? 'warning' : 'critical') : 'unavailable'}`}>
                      {sensors.smoke.val !== null ? (sensors.smoke.status === 'SAFE' ? 'Normal Operating Envelope' : sensors.smoke.status) : 'Disconnected'}
                    </span>
                  </div>
                </div>
                <div className="chart-container-box" style={{ height: '280px', width: '100%', position: 'relative' }}>
                  <canvas ref={smokeCanvasRef} id="smokeDetailChart"></canvas>
                </div>
              </div>

              {/* Flame Detail - Full Width */}
              <div className="enterprise-card sensor-detail-card">
                <div className="sensor-detail-meta">
                  <div className="sensor-meta-top">
                    <div className="sensor-meta-icon">🔥</div>
                    <div>
                      <div className="sensor-meta-name">Digital Flame Sensor (Active-Low)</div>
                      <div className="sensor-meta-id">S-FLAM-003 (ESP32-S3 GPIO 6) • IR Optical Phototransistor Detection</div>
                    </div>
                  </div>
                  <div className="sensor-meta-right">
                    <div className="sensor-meta-val" style={{ fontSize: '24px' }}>
                      {sensors.flame.detected ? '🔥 1 (FLAME DETECTED)' : '🛡️ 0 (CLEAR / SAFE)'}
                    </div>
                    <span className={`sensor-status-tag ${sensors.flame.detected ? 'critical' : 'safe'}`}>
                      {sensors.flame.detected ? 'FIRE HAZARD DETECTED' : 'Optical Baseline Safe'}
                    </span>
                  </div>
                </div>
                <div className="chart-container-box" style={{ height: '280px', width: '100%', position: 'relative' }}>
                  <canvas ref={flameCanvasRef} id="flameDetailChart"></canvas>
                </div>
              </div>
            </div>
          </section>

          {/* =================================================================
             VIEW 5: EVENT HISTORY & AUDIT LOGS
             ================================================================= */}
          <section className={`page-section ${currentTab === 'history' ? 'active' : ''}`}>
            <div className="history-cards-container">
              {incidents.map((incident, index) => (
                <div className="enterprise-card incident-card-enterprise" key={index}>
                  <div className="incident-card-header">
                    🔥 Fire Incident #{incidents.length - index}
                  </div>
                  <div className="incident-row">
                    <span>Date:</span>
                    <span>{incident.date}</span>
                  </div>
                  <div className="incident-row">
                    <span>Fire Time:</span>
                    <span>{incident.fireTime}</span>
                  </div>
                  <div className="incident-row">
                    <span>Alert Time:</span>
                    <span>{incident.alertTime}</span>
                  </div>
                  <div className="incident-row">
                    <span>Sensors Triggered:</span>
                    <span>
                      {incident.sensors?.temp ? 'Temp ' : ''}
                      {incident.sensors?.smoke ? 'Smoke ' : ''}
                      {incident.sensors?.flame ? 'Flame ' : ''}
                      {(!incident.sensors?.temp && !incident.sensors?.smoke && !incident.sensors?.flame) ? 'Alarm Protocol' : ''}
                    </span>
                  </div>
                  <div className="alert-status-badge" style={{ marginTop: '8px' }}>
                    ✔ {incident.status}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* =================================================================
             VIEW 6: SYSTEM DIAGNOSTICS & SETTINGS
             ================================================================= */}
          <section className={`page-section ${(currentTab === 'diagnostics' || currentTab === 'settings') ? 'active' : ''} settings-tab-section`}>
            <div className="enterprise-card settings-diagnostics-card">
              <div className="card-header-title">
                <span style={{ fontSize: '16px', fontWeight: 700 }}>{getTabTitle()}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '12px' }}>
                <div style={{ background: 'var(--bg-main)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-card)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>System Calibration</div>
                  <div style={{ fontSize: '18px', fontWeight: '800', marginTop: '4px' }}>
                    {isFireActive ? 'Emergency Active' : 'Calibrated'}
                  </div>
                </div>
                <div style={{ background: 'var(--bg-main)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-card)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Telemetry Latency</div>
                  <div style={{ fontSize: '18px', fontWeight: '800', marginTop: '4px' }}>
                    {isDataStale ? '> 30s (Stale)' : '< 1s (Live Stream)'}
                  </div>
                </div>
                <div style={{ background: 'var(--bg-main)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-card)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Fail-safe Relay</div>
                  <div style={{ fontSize: '18px', fontWeight: '800', marginTop: '4px' }}>
                    {sprinklerActive ? 'ENGAGED' : 'ARMED / READY'}
                  </div>
                </div>
              </div>
            </div>

            {/* Facility Location Management in Settings */}
            <div style={{ marginTop: '20px' }}>
              <FacilityLocationCard
                location={facilityLocation}
                isEmergency={isFireActive}
                eventTimestamp={fireEventTimestamp || lastUpdateTime}
                onOpenConfig={() => setIsLocationModalOpen(true)}
              />
            </div>

            {/* Emergency SMS Alerts Configuration in Settings */}
            <div style={{ marginTop: '20px' }}>
              <SmsAlertCard
                isEmergency={isFireActive}
                facilityLocation={facilityLocation}
              />
            </div>
          </section>

        </main>
      </div>

      {/* Fullscreen Emergency Modal on Confirmed Fire */}
      {isFireActive && !alertDismissed && (
        <EmergencyPopup
          severity={activeSeverity}
          eventTime={fireEventTimestamp || lastUpdateTime}
          facilityLocation={facilityLocation}
          sensors={sensors}
          onClose={handlePopupClose}
          onViewDashboard={handlePopupViewDashboard}
        />
      )}

      {/* Facility Location Configuration Modal */}
      <LocationConfigModal
        isOpen={isLocationModalOpen}
        onClose={() => setIsLocationModalOpen(false)}
        onSaveSuccess={(newLoc) => setFacilityLocation(newLoc)}
      />
    </div>
  );
}

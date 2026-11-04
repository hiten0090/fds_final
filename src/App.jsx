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
import BackendDataTable from './components/BackendDataTable';
import { locationService } from './services/locationService';
import { smsService } from './services/smsService';
import { webcamService } from './services/webcamService';

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

  // Laptop WebCam & Multi-Source Camera State
  const [cameraSource, setCameraSource] = useState('auto'); // 'auto' | 'webcam' | 'esp32'
  const [webcamState, setWebcamState] = useState(webcamService.getState());
  const webcamVideoRef = useRef(null);
  const dedicatedWebcamVideoRef = useRef(null);

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

  // ── Card Layout: Drag-and-Drop Order & Size Controls ──────────────────────
  // cardOrder: array of card ids, determines render sequence
  // cardSizes: { id: 1 | 2 } — 1 = normal (1 col), 2 = expanded (2 cols)
  const [cardOrder, setCardOrder] = useState(['temp', 'smoke', 'flame']);
  const [cardSizes, setCardSizes] = useState({ temp: 1, smoke: 1, flame: 1 });
  const dragCardIdRef = useRef(null);

  // Toggle a card between normal (1) and wide (2)
  const toggleCardSize = (id) => {
    setCardSizes(prev => ({ ...prev, [id]: prev[id] === 1 ? 2 : 1 }));
  };

  // Drag handlers — pure layout, zero sensor logic touched
  const handleCardDragStart = (e, id) => {
    dragCardIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.45';
  };
  const handleCardDragEnd = (e) => {
    e.currentTarget.style.opacity = '';
    dragCardIdRef.current = null;
    document.querySelectorAll('.hero-drag-over').forEach(el => el.classList.remove('hero-drag-over'));
  };
  const handleCardDragOver = (e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleCardDragEnter = (e) => {
    e.currentTarget.classList.add('hero-drag-over');
  };
  const handleCardDragLeave = (e) => {
    e.currentTarget.classList.remove('hero-drag-over');
  };
  const handleCardDrop = (e, targetId) => {
    e.preventDefault();
    e.currentTarget.classList.remove('hero-drag-over');
    const sourceId = dragCardIdRef.current;
    if (!sourceId || sourceId === targetId) return;
    setCardOrder(prev => {
      const next = [...prev];
      const si = next.indexOf(sourceId);
      const ti = next.indexOf(targetId);
      next.splice(si, 1);
      next.splice(ti, 0, sourceId);
      return next;
    });
  };
  // ─────────────────────────────────────────────────────────────────────────

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

  // Mobile sidebar & Desktop collapse toggle
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [historyTabMode, setHistoryTabMode] = useState('incidents'); // 'incidents' | 'live_table'
  const [selectedFacilityLevel, setSelectedFacilityLevel] = useState('Level 01 - Charging Dock & Storage');
  const [chartTimeRange, setChartTimeRange] = useState('1 Hour');

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

  // Subscribe to webcam service updates
  useEffect(() => {
    const unsub = webcamService.subscribe((st) => {
      setWebcamState(st);
      if (st.isActive) {
        setCameraState('Live');
      }
    });
    return unsub;
  }, []);

  // Camera & Laptop WebCam activation lifecycle on confirmed fire detection
  useEffect(() => {
    if (isFireActive) {
      setCameraState((prev) => (prev === 'Offline' ? 'Connecting' : prev));
      setStreamRetryCount(0);
      // Automatically turn ON laptop webcam when fire alert triggers!
      webcamService.startWebcam().catch((err) => {
        console.warn("[App] Auto laptop webcam start error on fire alert:", err);
      });
    } else {
      setCameraState('Offline');
      setStreamRetryCount(0);
      if (streamRetryTimerRef.current) {
        clearTimeout(streamRetryTimerRef.current);
        streamRetryTimerRef.current = null;
      }
      // Stop laptop webcam when fire alert ends unless user manually chose webcam source
      if (cameraSource !== 'webcam') {
        webcamService.stopWebcam();
      }
    }
  }, [isFireActive, cameraSource]);

  // Bind live mediaStream to HTML5 video elements whenever stream or view changes
  useEffect(() => {
    if (webcamVideoRef.current && webcamState.stream) {
      webcamVideoRef.current.srcObject = webcamState.stream;
      webcamVideoRef.current.play().catch((e) => console.warn("[Webcam] Overview video play error:", e));
    }
    if (dedicatedWebcamVideoRef.current && webcamState.stream) {
      dedicatedWebcamVideoRef.current.srcObject = webcamState.stream;
      dedicatedWebcamVideoRef.current.play().catch((e) => console.warn("[Webcam] Dedicated video play error:", e));
    }
  }, [webcamState.stream, currentTab, cameraSource, isFireActive]);

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
              label: 'Temperature (°C)',
              data: chartTempDataRef.current,
              borderColor: '#2563EB',
              backgroundColor: 'rgba(37, 99, 235, 0.08)',
              borderWidth: 2.2,
              pointRadius: 0,
              tension: 0.35,
              fill: true,
              yAxisID: 'y'
            },
            {
              label: 'Gas Concentration (ppm)',
              data: chartSmokeDataRef.current,
              borderColor: '#F59E0B',
              backgroundColor: 'rgba(245, 158, 11, 0.06)',
              borderWidth: 2.2,
              pointRadius: 0,
              tension: 0.35,
              fill: true,
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
              ticks: { color: '#2563EB', font: { family: 'Inter', size: 9 } }
            },
            y1: {
              type: 'linear',
              display: false,
              position: 'right',
              grid: { drawOnChartArea: false },
              ticks: { color: '#F59E0B', font: { family: 'Inter', size: 9 } }
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
          datasets: [createGradientDataset(chartTempDataRef.current, '#2563EB', 'rgba(37, 99, 235, 0.32)', 'rgba(37, 99, 235, 0.05)', '#2563EB')]
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
          datasets: [createGradientDataset(chartSmokeDataRef.current, '#F59E0B', 'rgba(245, 158, 11, 0.32)', 'rgba(245, 158, 11, 0.05)', '#F59E0B')]
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

  const exportTelemetryCsv = () => {
    const labels = chartLabelsRef.current || [];
    const temps = chartTempDataRef.current || [];
    const smokes = chartSmokeDataRef.current || [];
    const flames = chartFlameDataRef.current || [];

    let csv = 'Timestamp,Temperature (°C),Smoke/Gas (PPM),Flame State (Binary)\n';
    for (let i = 0; i < labels.length; i++) {
      csv += `${labels[i] || ''},${temps[i] ?? ''},${smokes[i] ?? ''},${flames[i] ?? ''}\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `FireGuard_Telemetry_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
        {/* Brand Logo & Collapse Toggle */}
        <div className="sidebar-brand">
          <div className="brand-icon-wrapper" onClick={() => switchTab('overview')} style={{ cursor: 'pointer' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              <path d="M9 12l2 2 4-4"></path>
            </svg>
          </div>
          {!sidebarCollapsed && (
            <div className="brand-text">
              <span className="brand-title">FIREGUARD</span>
              <span className="brand-subtitle">SAFETY INTELLIGENCE</span>
            </div>
          )}
          <button
            className="sidebar-collapse-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label="Toggle sidebar collapse"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              {sidebarCollapsed ? (
                <polyline points="9 18 15 12 9 6"></polyline>
              ) : (
                <polyline points="15 18 9 12 15 6"></polyline>
              )}
            </svg>
          </button>
        </div>

        {/* Navigation Category Label */}
        {!sidebarCollapsed && (
          <div className="sidebar-category-label">NAVIGATION</div>
        )}

        {/* Sidebar Menu Items */}
        <ul className="sidebar-menu">
          {/* 01 Overview */}
          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'overview' ? 'active' : ''}`}
              onClick={() => switchTab('overview')}
              data-nav="overview"
              title="Overview • Command Center"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
              {!sidebarCollapsed && <span className="sidebar-btn-label">Overview</span>}
              {!sidebarCollapsed && <span className="sidebar-item-num">01</span>}
            </button>
          </li>

          {/* 02 Surveillance */}
          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'camera' ? 'active' : ''}`}
              onClick={() => switchTab('camera')}
              data-nav="camera"
              title="Camera Surveillance • Dual Stream Relay"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z"></path>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
              </svg>
              {!sidebarCollapsed && <span className="sidebar-btn-label">Surveillance</span>}
              {!sidebarCollapsed && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                  {webcamState.isActive ? (
                    <span className="sidebar-badge badge-camera-live">
                      <span className="sidebar-badge-pulse"></span>CAM
                    </span>
                  ) : cameraState === 'Live' ? (
                    <span className="sidebar-badge badge-camera-live">
                      <span className="sidebar-badge-pulse"></span>LIVE
                    </span>
                  ) : isFireActive ? (
                    <span className="sidebar-badge badge-camera-alert">ALERT</span>
                  ) : (
                    <span className="sidebar-badge badge-camera-stby">STBY</span>
                  )}
                  <span className="sidebar-item-num">02</span>
                </div>
              )}
            </button>
          </li>

          {/* 03 Incident History */}
          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'history' ? 'active' : ''}`}
              onClick={() => switchTab('history')}
              data-nav="history"
              title="Incident History & Supabase Database Logs"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              {!sidebarCollapsed && <span className="sidebar-btn-label">Incident History</span>}
              {!sidebarCollapsed && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                  <span className="sidebar-badge badge-event-count">{incidents.length || 21}</span>
                  <span className="sidebar-item-num">03</span>
                </div>
              )}
            </button>
          </li>

          {/* 04 Settings */}
          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'settings' ? 'active' : ''}`}
              onClick={() => switchTab('settings')}
              data-nav="settings"
              title="System Settings & Hardware Diagnostics"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
              {!sidebarCollapsed && <span className="sidebar-btn-label">Settings</span>}
              {!sidebarCollapsed && <span className="sidebar-item-num">04</span>}
            </button>
          </li>
        </ul>

      </aside>

      {/* Main Content Area */}
      <div className={`app-main ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Sticky Pulsing Emergency Banner */}
        <EmergencyBanner
          active={isFireActive}
          timestamp={fireEventTimestamp || lastUpdateTime}
          severity={activeSeverity}
          onAcknowledge={handlePopupClose}
          facilityName={facilityLocation.facilityName}
        />

        {/* Top Header Bar (Matching Exact Reference Screenshot) */}
        <header className="top-header">
          <div className="header-left">
            {/* Mobile Hamburger Toggle */}
            <button
              className="header-mobile-toggle"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Toggle mobile menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>

            {/* Breadcrumb Navigation Matching Screenshot: Baytown Complex > Sector 4 Console • Operational */}
            <div className="header-breadcrumb-row">
              <span className="breadcrumb-site">Baytown Complex</span>
              <span className="breadcrumb-arrow">›</span>
              <span className="breadcrumb-target">Sector 4 Console</span>
              <span className="breadcrumb-sep">•</span>
              <span className="header-operational-pill">
                <span className="status-dot-sm connected"></span>
                <span>Operational</span>
              </span>
            </div>
          </div>

          <div className="header-right">
            {/* 14 Online */}
            <div className="header-metric-pill" title="Mesh telemetry nodes online">
              <span className="metric-pill-icon">❄</span>
              <span>14 Online</span>
            </div>

            {/* Network Latency: 22ms Latency */}
            <div className="header-metric-pill" title="Gateway round-trip latency">
              <span className="metric-pill-icon">📶</span>
              <span className="tabular-nums">{isDataStale ? '> 30s' : '22ms'} Latency</span>
            </div>

            {/* Alerts • */}
            <div
              className="header-metric-pill clickable"
              onClick={() => { if (isFireActive) setIsFireAlertOpen(true); else switchTab('history'); }}
              title="Active Alerts Indicator"
            >
              <span className="metric-pill-icon">🔔</span>
              <span>Alerts</span>
              <span className={`alerts-dot ${isFireActive ? 'pulse-red' : ''}`}></span>
            </div>

            {/* Emergency 911 / Override Button - Vibrant Red Rounded-Full Pill */}
            <button
              onClick={triggerManualOverride}
              className={`header-emergency-pill-btn ${emergencyOverride ? 'override-active' : ''}`}
              title={emergencyOverride ? "Cancel emergency override" : "Dispatch facility emergency 911 override"}
            >
              <span>🚨</span>
              <span>{emergencyOverride ? 'Cancel Override' : 'Emergency 911'}</span>
            </button>
          </div>
        </header>

        {/* Main Content Wrapper */}
        <main className={`main-wrapper ${isFireActive && !alertDismissed ? 'is-blurred' : ''}`}>

          {/* =================================================================
             VIEW 1: OVERVIEW (MAIN DASHBOARD)
             ================================================================= */}
          <section className={`page-section ${currentTab === 'overview' ? 'active' : ''}`}>

            {/* Top Facility Control Toolbar (Actions fill area) */}
            <div className="facility-dashboard-header" style={{ marginBottom: '14px' }}>
              <div className="facility-header-actions" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="facility-select-wrapper">
                  <select
                    className="facility-level-select font-mono"
                    value={selectedFacilityLevel}
                    onChange={(e) => setSelectedFacilityLevel(e.target.value)}
                    title="Select facility level and containment area"
                  >
                    <option value="Level 01 - Charging Dock & Storage">Level 01 - Charging Dock &amp; Storage</option>
                    <option value="Level 02 - Cryogenic Tank Vault">Level 02 - Cryogenic Tank Vault</option>
                    <option value="Level 03 - Server Rack Containment">Level 03 - Server Rack Containment</option>
                    <option value="Level 04 - Exhaust Ventilation Plenum">Level 04 - Exhaust Ventilation Plenum</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    className="btn-facility-action"
                    onClick={runDiagnosticTest}
                    title="Simulate 3-stage emergency drill test"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    </svg>
                    <span>{incidentStage > 0 ? `Drill (${incidentStage}/3)` : 'Fire Drill'}</span>
                  </button>

                  <button
                    className={`btn-facility-action ${audioState.isUnlocked ? 'siren-armed' : ''}`}
                    onClick={() => audioService.unlockAudio()}
                    title={audioState.isUnlocked ? 'Audio siren armed and unmuted' : 'Click to arm siren audio in browser'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                      {audioState.isUnlocked ? (
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                      ) : (
                        <line x1="23" y1="9" x2="17" y2="15"></line>
                      )}
                    </svg>
                    <span>{audioState.isUnlocked ? 'Siren Armed' : 'Mute (10m)'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Environmental Safety Notice Callout Strip (Amber/Warning matching Screenshot) */}
            <div className={`safety-notice-callout ${isFireActive ? 'notice-critical' : isWarningActive ? 'notice-warning' : 'notice-nominal'}`} style={{ marginBottom: '14px' }}>
              <div className="notice-icon-box">
                <span className="notice-warn-triangle">⚠️</span>
              </div>
              <div className="notice-content">
                <div className="notice-headline">
                  <span className="notice-tag-badge">NOTICE</span>
                  <span className="notice-title-text">
                    {isFireActive
                      ? 'CRITICAL ALERT: Fire Hazard Confirmed — Automatic Safety Containment Engaged!'
                      : isWarningActive
                      ? `Elevated Gas & Air Quality concentration in Sector 4-B dock ${safeFormatSmoke(sensors.smoke.val)} (Thresh: 150)`
                      : `Elevated Gas & Air Quality concentration in Sector 4-B dock ${safeFormatSmoke(sensors.smoke.val)} (Thresh: 150)`}
                  </span>
                </div>
                <span className="notice-sub">
                  Automated scrubbers engaged. Acknowledged by Safety Engineer.
                </span>
              </div>
              <div className="notice-actions">
                <button
                  className="btn-notice-white"
                  onClick={() => audioService.mute()}
                  title="Silence audio annunciator"
                >
                  Silence Horn
                </button>
                <button
                  className="btn-notice-amber"
                  onClick={toggleSprinkler}
                  title="Override Exhaust & Deluge Scrubber"
                >
                  Override Exhaust
                </button>
              </div>
            </div>

            {/* Sub-Header: Interactive Telemetry Matrix & Status */}
            <div className="telemetry-sub-header">
              <div className="telemetry-sub-left">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="telemetry-sub-dot">●</span>
                  <span className="telemetry-sub-title">Interactive Telemetry Matrix</span>
                  <span className="telemetry-sub-pill">{supabaseConnected ? 'LIVE SENSOR DATA' : 'DEMO DATA'}</span>
                </div>
                <p className="telemetry-sub-desc">
                  Live multi-sensor telemetry &amp; containment diagnostics powered by React Bits MagicBento
                </p>
              </div>
              <div className="telemetry-sub-right">
                <span className="sub-glow-text">✨ Hover or click cards for glow dynamics</span>
                <span className="sub-sync-status font-mono">
                  <span className="status-dot-sm connected"></span> Synchronous 500ms
                </span>
              </div>
            </div>

            {/* Row 1: Top 2 Wide KPI Cards (FLEET MESH TELEMETRY & SAFETY COMPLIANCE) */}
            <div className="overview-kpi-grid" style={{ marginBottom: '16px' }}>
              {/* Card 1: FLEET MESH TELEMETRY */}
              <div className="enterprise-card kpi-summary-card">
                <div className="kpi-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="kpi-icon-circle blue">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="22" y1="12" x2="18" y2="12"></line>
                        <line x1="6" y1="12" x2="2" y2="12"></line>
                        <line x1="12" y1="6" x2="12" y2="2"></line>
                        <line x1="12" y1="22" x2="12" y2="18"></line>
                      </svg>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="kpi-label">FLEET MESH TELEMETRY</span>
                      <span className="kpi-subcode font-mono">NODE-GRP-54</span>
                    </div>
                  </div>
                  <span className="kpi-badge-green">100% Active</span>
                </div>

                <div className="kpi-body">
                  <div className="kpi-main-metric">
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                      <span className="kpi-metric-number tabular-nums">4 / 4</span>
                      <span className="kpi-metric-unit">Controllers Online</span>
                    </div>
                    <span className="kpi-metric-desc">14 secondary mesh sensors reporting without packet loss.</span>
                  </div>

                  <div className="kpi-bus-bars">
                    <div className="bus-bar-item">
                      <div className="bus-bar-labels">
                        <span>Primary Bus (CAN-01)</span>
                        <span className="font-mono">12ms • 99.8%</span>
                      </div>
                      <div className="bus-progress-track">
                        <div className="bus-progress-fill blue" style={{ width: '99.8%' }}></div>
                      </div>
                    </div>
                    <div className="bus-bar-item">
                      <div className="bus-bar-labels">
                        <span>Redundant Fiber (RF-02)</span>
                        <span className="font-mono">22ms • 100%</span>
                      </div>
                      <div className="bus-progress-track">
                        <div className="bus-progress-fill green" style={{ width: '100%' }}></div>
                      </div>
                    </div>
                  </div>

                  <div className="kpi-card-footer">
                    <span className="kpi-footer-status">
                      <span className="status-dot-sm connected"></span> Zero dropouts
                    </span>
                    <button className="kpi-footer-link" onClick={() => switchTab('settings')}>
                      Ping Mesh →
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 2: SAFETY & COMPLIANCE */}
              <div className="enterprise-card kpi-summary-card">
                <div className="kpi-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="kpi-icon-circle amber">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                      </svg>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="kpi-label">SAFETY &amp; COMPLIANCE</span>
                      <span className="kpi-subcode font-mono">NFPA 855 / 72</span>
                    </div>
                  </div>
                  <span className="kpi-badge-amber">
                    1 Warning
                  </span>
                </div>

                <div className="kpi-body">
                  <div className="kpi-main-metric">
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                      <span className="kpi-metric-number tabular-nums">99.8%</span>
                      <span className="kpi-metric-unit">NFPA Safety Rating</span>
                    </div>
                    <span className="kpi-metric-desc">Charging dock exhaust review in progress. Fire suppression armed.</span>
                  </div>

                  <div className="kpi-meta-grid">
                    <div className="kpi-meta-box">
                      <span className="kpi-meta-label">CONTAINMENT</span>
                      <span className="kpi-meta-val font-mono">1.4s response</span>
                    </div>
                    <div className="kpi-meta-box">
                      <span className="kpi-meta-label">AUDIT CYCLE</span>
                      <span className="kpi-meta-val font-mono">Valid 42d</span>
                    </div>
                  </div>

                  <div className="kpi-card-footer">
                    <span className="kpi-footer-status text-amber">
                      <span>🛡️</span> Suppression Armed
                    </span>
                    <button className="kpi-footer-link" onClick={() => switchTab('history')}>
                      Audit Log
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 2: Live Transducer Array (2/3 width) + Optical Flame Detection (1/3 width) */}
            <div className="overview-transducers-grid" style={{ marginBottom: '20px' }}>
              {/* Left: Live Transducer Array (2/3 width) */}
              <div className="enterprise-card live-transducer-array-card">
                <div className="array-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div className="array-icon-circle">
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M4.93 19.07a10 10 0 0 1 0-14.14"></path>
                        <path d="M7.76 16.24a6 6 0 0 1 0-8.48"></path>
                        <circle cx="12" cy="12" r="2"></circle>
                        <path d="M16.24 7.76a6 6 0 0 1 0 8.48"></path>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                      </svg>
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h3 className="array-card-title">Live Transducer Array</h3>
                        <span className="array-sensor-badge font-mono">DHT22 • MQ-2</span>
                      </div>
                      <span className="array-card-sub">Sector 4 Battery Vault &amp; Adjacent Charging Bay</span>
                    </div>
                  </div>

                  <div className="array-header-right font-mono">
                    <span className="array-chip-live blue">
                      <span className="dot-blue"></span> DHT22: {safeFormatTemp(sensors.temp.val)}
                    </span>
                    <span className="array-chip-live amber">
                      <span className="dot-amber"></span> MQ-2: {safeFormatSmoke(sensors.smoke.val)}
                    </span>
                  </div>
                </div>

                {/* Dual Sub-columns Grid */}
                <div className="array-subcolumns-grid">
                  {/* Sub-col 1: DHT22 Temp / Humid */}
                  <div className="array-subcol">
                    <div className="subcol-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="subcol-icon">🌡️</span>
                        <span className="subcol-title">DHT22 Temp / Humid</span>
                      </div>
                      <span className={`subcol-pill ${sensors.temp.val !== null && sensors.temp.val >= thresholds.temp ? 'pill-critical' : 'pill-normal'}`}>
                        {sensors.temp.val !== null && sensors.temp.val >= thresholds.temp ? 'Critical' : 'Normal'}
                      </span>
                    </div>

                    <div className="subcol-reading-row">
                      <div className="subcol-value-box">
                        <span className="subcol-value tabular-nums">{safeFormatTemp(sensors.temp.val)}</span>
                      </div>
                      <span className="subcol-secondary-metric font-mono">
                        RH {sensors.humidity.val !== null && typeof sensors.humidity.val === 'number' ? `${sensors.humidity.val.toFixed(0)}%` : '42%'}
                      </span>
                    </div>

                    {/* Sparkline Canvas */}
                    <div className="subcol-chart-box">
                      <canvas ref={dashTempCanvasRef} id="dashTempDetailChart"></canvas>
                    </div>

                    <div className="subcol-footer font-mono">
                      <span>Baseline: 20.0°C</span>
                      <span style={{ color: '#2563EB' }}>+0.4°C Trend</span>
                    </div>
                  </div>

                  {/* Sub-col 2: MQ-2 Combustibles */}
                  <div className="array-subcol">
                    <div className="subcol-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="subcol-icon">💨</span>
                        <span className="subcol-title">MQ-2 Combustibles</span>
                      </div>
                      <span className={`subcol-pill ${sensors.smoke.val !== null && sensors.smoke.val >= thresholds.smoke ? 'pill-critical' : sensors.smoke.val !== null && sensors.smoke.val >= 150 ? 'pill-elevated' : 'pill-normal'}`}>
                        {sensors.smoke.val !== null && sensors.smoke.val >= thresholds.smoke ? 'Critical' : sensors.smoke.val !== null && sensors.smoke.val >= 150 ? 'Elevated' : 'Normal'}
                      </span>
                    </div>

                    <div className="subcol-reading-row">
                      <div className="subcol-value-box">
                        <span className="subcol-value tabular-nums">{safeFormatSmoke(sensors.smoke.val)}</span>
                      </div>
                      <span className="subcol-secondary-metric font-mono" style={{ color: '#F59E0B' }}>
                        &gt; 150 Warn
                      </span>
                    </div>

                    {/* Sparkline Canvas */}
                    <div className="subcol-chart-box">
                      <canvas ref={dashSmokeCanvasRef} id="dashSmokeDetailChart"></canvas>
                    </div>

                    <div className="subcol-footer font-mono">
                      <span>Thresh: 800 ppm</span>
                      <span style={{ color: '#F59E0B' }}>
                        {sensors.smoke.val && sensors.smoke.val > 150 ? `+${(sensors.smoke.val - 150).toFixed(0)} ppm Exceed` : '+34 ppm Exceed'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Bottom Actions Bar */}
                <div className="array-card-bottom-bar">
                  <div className="array-sprinkler-status">
                    <span>⚙️</span>
                    <span className="font-mono">Auto-Sprinkler: {sprinklerActive ? 'Stage 1 Engaged' : 'Armed & Ready'}</span>
                  </div>
                  <div className="array-action-links">
                    <button className="array-link-btn" onClick={resetEntireSystem}>Calibrate Range</button>
                    <button className="array-link-btn" onClick={() => switchTab('sensors')}>Inspect Raw Data</button>
                    <button className="array-link-btn" onClick={runDiagnosticTest}>Run Self Test</button>
                    <button className="array-link-btn" onClick={() => switchTab('history')}>Diagnostic Log</button>
                  </div>
                </div>
              </div>

              {/* Right: Optical Flame Detection (1/3 width) */}
              <div className={`enterprise-card optical-flame-card ${!isDataStale && sensors.flame.detected ? 'card-flame-active' : ''}`}>
                <div className="optical-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="optical-icon-circle">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path>
                      </svg>
                    </div>
                    <div>
                      <h3 className="optical-card-title">OPTICAL FLAME DETECTION</h3>
                      <span className="optical-card-sub font-mono">UV/IR-ARRAY-01</span>
                    </div>
                  </div>
                  <span className={`optical-status-pill ${sensors.flame.detected ? 'pill-critical' : 'pill-clear'}`}>
                    {sensors.flame.detected ? 'CRITICAL FIRE' : 'Clear'}
                  </span>
                </div>

                {/* Center Box */}
                <div className="optical-center-box">
                  <div className={`optical-shield-icon ${sensors.flame.detected ? 'fire' : 'safe'}`}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    </svg>
                  </div>
                  <h4 className="optical-main-state">
                    {sensors.flame.detected ? 'Critical Flame Detected' : 'Flame Spectrum Absent'}
                  </h4>
                  <p className="optical-main-sub">
                    {sensors.flame.detected ? 'Active-low optical trigger engaged • Emergency deluge active' : 'Infrared signature zero • Trigger latency 0.0 ms'}
                  </p>
                </div>

                {/* Waveform Canvas */}
                <div className="optical-chart-box">
                  <canvas ref={dashFlameCanvasRef} id="dashFlameDetailChart"></canvas>
                </div>

                {/* Self-Diagnostic Health */}
                <div className="optical-diagnostics-section">
                  <span className="diagnostics-label font-mono">SELF-DIAGNOSTIC HEALTH</span>
                  <div className="diagnostic-row">
                    <div className="diag-item">
                      <span className="status-dot-sm connected"></span>
                      <span>Optics Routine Pass</span>
                    </div>
                    <span className="diag-time font-mono">08:12 UTC</span>
                  </div>
                  <div className="diagnostic-row">
                    <div className="diag-item">
                      <span className="status-dot-sm connected"></span>
                      <span>Spectral Baseline Clean</span>
                    </div>
                    <span className="diag-time font-mono">08:00 UTC</span>
                  </div>
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
                      <span className={`tactical-dot ${webcamState.isActive ? 'red live-pulse' : cameraState === 'Live' ? 'green' : isFireActive ? 'red' : 'green'}`}></span>
                      <div className="tactical-cam-text">
                        <span className="cam-code">{webcamState.isActive ? 'CAM-LOCAL' : 'CAM-01'}</span>
                        <span className="cam-sub">
                          {webcamState.isActive ? 'LAPTOP WEBCAM [LIVE SURVEILLANCE]' : `ESP32-CAM [${cameraState.toUpperCase()}]`}
                        </span>
                      </div>
                    </div>

                    <div className="tactical-hud-stats" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {/* Camera Source Selector */}
                      <div className="tactical-source-toggle font-mono">
                        <button
                          type="button"
                          className={`btn-source-tab ${cameraSource === 'auto' ? 'active' : ''}`}
                          onClick={(e) => { e.stopPropagation(); setCameraSource('auto'); }}
                          title="Auto-trigger Laptop WebCam on fire alert"
                        >
                          AUTO
                        </button>
                        <button
                          type="button"
                          className={`btn-source-tab ${cameraSource === 'webcam' ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCameraSource('webcam');
                            webcamService.startWebcam().catch((err) => console.warn(err));
                          }}
                          title="Use Laptop WebCam"
                        >
                          WEBCAM
                        </button>
                        <button
                          type="button"
                          className={`btn-source-tab ${cameraSource === 'esp32' ? 'active' : ''}`}
                          onClick={(e) => { e.stopPropagation(); setCameraSource('esp32'); }}
                          title="Use ESP32-CAM Stream"
                        >
                          ESP32
                        </button>
                      </div>

                      <button
                        className="tactical-hud-fs-btn"
                        onClick={(e) => { e.stopPropagation(); toggleFullscreen(cameraContainerRef); }}
                        title="Toggle Fullscreen Viewport"
                        style={{
                          background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)',
                          color: '#F8FAFC', borderRadius: '4px', cursor: 'pointer', padding: '2px 6px',
                          fontSize: '11px', lineHeight: 1
                        }}
                      >
                        ⛶
                      </button>
                    </div>
                  </div>

                  {/* Center HUD / Feed: Laptop WebCam or ESP32-CAM Stream */}
                  {webcamState.isActive && (cameraSource === 'webcam' || cameraSource === 'auto' || isFireActive) ? (
                    <div className="tactical-live-feed-wrap">
                      <video
                        ref={webcamVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="camera-video-feed"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <div className="tactical-feed-badge alert-badge font-mono">
                        <span>● LIVE LAPTOP SURVEILLANCE FEED</span>
                      </div>
                    </div>
                  ) : isFireActive || cameraState === 'Live' ? (
                    <div className="tactical-live-feed-wrap">
                      <img
                        src={liveStreamUrl}
                        className="camera-img-feed"
                        alt="ESP32-CAM Stream"
                        onLoad={handleCameraStreamSuccess}
                        onError={handleCameraStreamError}
                      />
                      <div className="tactical-feed-badge font-mono">LIVE RELAY • ACTIVE</div>
                    </div>
                  ) : (
                    <div className="tactical-reticle-box">
                      <div className="tactical-title">Conditions Are Normal</div>
                      <div className="tactical-subtitle">OV2640 &amp; Laptop WebCam • Auto-Arms on Fire Detection</div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <button
                          className="tactical-connect-btn"
                          onClick={() => {
                            setCameraSource('webcam');
                            webcamService.startWebcam().catch((err) => console.warn(err));
                          }}
                        >
                          📹 Test Laptop WebCam
                        </button>
                        <button className="tactical-connect-btn" onClick={manualRetryStream}>
                          ▶ Connect ESP32 Stream
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Bottom Tactical HUD */}
                  <div className="tactical-hud-footer font-mono">
                    <span className="tactical-fps">{webcamState.isActive ? '30 FPS • WEBCAM' : 'L-FPS: MJPEG'}</span>
                    {webcamState.isActive && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const snap = webcamService.captureSnapshot(webcamVideoRef.current);
                          if (snap) {
                            const a = document.createElement('a');
                            a.href = snap;
                            a.download = `FireGuard_Laptop_Snapshot_${Date.now()}.jpg`;
                            a.click();
                          }
                        }}
                        className="tactical-snap-btn"
                        title="Capture and download snapshot"
                      >
                        📸 Snap
                      </button>
                    )}
                    <button
                      onClick={() => switchTab('camera')}
                      style={{
                        background: 'transparent',
                        border: '1px solid rgba(255, 255, 255, 0.25)',
                        borderRadius: '3px',
                        color: '#38BDF8',
                        fontSize: '9.5px',
                        padding: '1.5px 6px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        textTransform: 'uppercase'
                      }}
                      title="Switch to dedicated Camera Surveillance tab"
                    >
                      ↗ Full View
                    </button>
                    <span className="tactical-res">720p HD</span>
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

                <button
                  className={`btn-enterprise secondary ${sprinklerActive ? 'relay-active' : ''}`}
                  onClick={toggleSprinkler}
                  style={{
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>💧</span>
                    <span>Sprinkler Relay</span>
                  </span>
                  <span className={`status-pill ${sprinklerActive ? 'pill-active' : 'pill-idle'}`} style={{
                    fontSize: '10.5px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: sprinklerActive ? '#EFF6FF' : '#F1F5F9',
                    color: sprinklerActive ? '#2563EB' : '#64748B',
                    border: '1px solid ' + (sprinklerActive ? '#BFDBFE' : '#E2E8F0'),
                    fontWeight: 700
                  }}>
                    {sprinklerActive ? 'DELUGE ENGAGED' : 'ARMED / OFF'}
                  </span>
                </button>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn-enterprise secondary"
                    style={{ flex: 1, padding: '9px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    onClick={toggleAutoMode}
                  >
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: autoMode ? '#16A34A' : '#94A3B8' }}></span>
                    <span>Auto: {autoMode ? 'ACTIVE' : 'MANUAL'}</span>
                  </button>
                  <button
                    className="btn-enterprise secondary"
                    style={{ flex: 1, padding: '9px 12px' }}
                    onClick={runDiagnosticTest}
                  >
                    {incidentStage > 0 ? `⏳ Stage ${incidentStage}/3...` : '⚡ Drill Test'}
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

            {/* =================================================================
               ROW 4: SYNCHRONIZED ENVIRONMENTAL CORRELATION (GRAND CHART)
               Real-time multi-dataset alignment of temperature and smoke
               ================================================================= */}
            <div className="enterprise-card grand-correlation-card" style={{ marginBottom: '22px' }}>
              <div className="correlation-card-header">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="correlation-icon">📈</span>
                    <h3 className="correlation-title">Synchronized Environmental Correlation</h3>
                    <span className="correlation-badge font-mono">1.0 Hz Realtime</span>
                  </div>
                  <p className="correlation-subtitle">
                    Real-time cross-channel analysis of thermal trends and gas levels.
                  </p>
                </div>

                <div className="correlation-header-right">
                  {/* Time Range Filters (Matching Reference Video) */}
                  <div className="correlation-time-filters font-mono">
                    {['15 Min', '1 Hour', '24 Hours', '7 Days'].map((t) => (
                      <button
                        key={t}
                        className={`btn-time-filter ${chartTimeRange === t ? 'active' : ''}`}
                        onClick={() => setChartTimeRange(t)}
                        title={`Filter telemetry range to ${t}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <button
                    className="btn-export-telemetry"
                    onClick={exportTelemetryCsv}
                    title="Download current rolling telemetry buffer as CSV"
                  >
                    <span>📊</span>
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              {/* Legend matching Screenshot */}
              <div className="correlation-legend-strip font-mono">
                <span className="legend-item">
                  <span className="legend-dot blue"></span>
                  <span>Temperature (°C)</span>
                </span>
                <span className="legend-item">
                  <span className="legend-dot amber"></span>
                  <span>Gas Concentration (ppm)</span>
                </span>
                <span className="legend-item">
                  <span className="legend-dot red"></span>
                  <span>Flame Detection Spike</span>
                </span>
              </div>

              {/* Grand Chart Canvas */}
              <div className="grand-chart-viewport" style={{ height: '260px', width: '100%', position: 'relative' }}>
                <canvas ref={mainCanvasRef} id="mainSyncCorrelationChart"></canvas>
              </div>

              <div className="correlation-footer-bar font-mono">
                <div className="correlation-footer-note">
                  <span className="info-icon">ℹ️</span>
                  <span>Bi-variate correlation between charging cycle and ambient off-gas. Early thermal runaway indicators are Standby / Nominal.</span>
                </div>
                <button
                  className="btn-generate-report"
                  onClick={exportTelemetryCsv}
                  title="Generate full facility compliance audit report"
                >
                  Generate Report
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: (webcamState.isActive || cameraState === 'Live') ? '#16A34A' : '#DC2626',
                    boxShadow: (webcamState.isActive || cameraState === 'Live') ? '0 0 10px #16A34A' : '0 0 10px #DC2626'
                  }}></div>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: '#F8FAFC' }}>
                    {webcamState.isActive ? 'Laptop WebCam Local Surveillance Feed' : 'ESP32-CAM Surveillance Feed Relay'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {/* WebCam / ESP32 source switcher */}
                  <button
                    className="btn-enterprise secondary"
                    onClick={() => {
                      if (webcamState.isActive) {
                        webcamService.stopWebcam();
                        setCameraSource('esp32');
                      } else {
                        setCameraSource('webcam');
                        webcamService.startWebcam().catch(err => console.warn(err));
                      }
                    }}
                    style={{ background: webcamState.isActive ? '#1E293B' : undefined, color: webcamState.isActive ? '#38BDF8' : undefined }}
                  >
                    📹 {webcamState.isActive ? 'Stop Laptop WebCam' : 'Start Laptop WebCam'}
                  </button>
                  {webcamState.isActive && (
                    <button
                      className="btn-enterprise secondary"
                      onClick={() => {
                        const snap = webcamService.captureSnapshot(dedicatedWebcamVideoRef.current);
                        if (snap) {
                          const a = document.createElement('a');
                          a.href = snap;
                          a.download = `FireGuard_Evidence_${Date.now()}.jpg`;
                          a.click();
                        }
                      }}
                    >
                      📸 Capture Evidence Photo
                    </button>
                  )}
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
                {webcamState.isActive && (cameraSource === 'webcam' || cameraSource === 'auto' || isFireActive) ? (
                  <video
                    ref={dedicatedWebcamVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="camera-video-feed"
                    style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                  />
                ) : isFireActive || cameraState === 'Live' || cameraState === 'Connecting' || cameraState === 'Reconnecting' ? (
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
                    <div className="camera-standby-title" style={{ fontSize: '16px' }}>Surveillance System Standby</div>
                    <div className="camera-standby-desc">Laptop WebCam and ESP32-CAM both activate automatically on confirmed fire alarms. You can also start the stream manually.</div>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                      <button
                        className="btn-enterprise secondary"
                        onClick={() => {
                          setCameraSource('webcam');
                          webcamService.startWebcam().catch(err => console.warn(err));
                        }}
                        style={{ background: '#2563EB', color: '#FFFFFF', borderColor: '#3B82F6' }}
                      >
                        📹 Start Laptop WebCam
                      </button>
                      <button
                        className="btn-enterprise secondary"
                        onClick={manualRetryStream}
                        style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#FFFFFF', borderColor: 'rgba(255, 255, 255, 0.2)' }}
                      >
                        ▶ Test ESP32-CAM Stream
                      </button>
                    </div>
                  </div>
                )}

                {/* HUD Overlays */}
                <div className="camera-timestamp-tag" style={{ top: '16px', left: '16px', fontSize: '12px', padding: '4px 10px' }}>
                  REC ● {dateStr} {timeStr}
                </div>
                <div className="camera-channel-tag font-mono" style={{ bottom: '16px', right: '16px', fontSize: '12px', padding: '4px 10px' }}>
                  {webcamState.isActive ? 'NODE #02 — LAPTOP WEBCAM (720p HD)' : `NODE #01 — ESP32-CAM Relay (${cameraState.toUpperCase()})`}
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
             VIEW 5: EVENT HISTORY & AUDIT LOGS + SUPABASE DATA TABLE
             ================================================================= */}
          <section className={`page-section ${currentTab === 'history' ? 'active' : ''}`}>
            {/* Top Interactive Mode Switcher */}
            <div className="history-tab-header" style={{ marginBottom: '18px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  className={`btn-enterprise ${historyTabMode === 'incidents' ? 'primary' : 'secondary'}`}
                  onClick={() => setHistoryTabMode('incidents')}
                  style={{
                    padding: '8px 16px',
                    fontSize: '12.5px',
                    background: historyTabMode === 'incidents' ? '#2563EB' : '#FFFFFF',
                    color: historyTabMode === 'incidents' ? '#FFFFFF' : '#334155',
                    border: '1px solid ' + (historyTabMode === 'incidents' ? '#2563EB' : '#CBD5E1'),
                    borderRadius: '6px'
                  }}
                >
                  📋 Incident Logs ({incidents.length})
                </button>
                <button
                  className={`btn-enterprise ${historyTabMode === 'live_table' ? 'primary' : 'secondary'}`}
                  onClick={() => setHistoryTabMode('live_table')}
                  style={{
                    padding: '8px 16px',
                    fontSize: '12.5px',
                    background: historyTabMode === 'live_table' ? '#2563EB' : '#FFFFFF',
                    color: historyTabMode === 'live_table' ? '#FFFFFF' : '#334155',
                    border: '1px solid ' + (historyTabMode === 'live_table' ? '#2563EB' : '#CBD5E1'),
                    borderRadius: '6px'
                  }}
                >
                  ⚡ Supabase Live Database Stream
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11.5px', color: '#64748B' }}>
                <span className="tabular-nums font-mono">
                  {incidents.length} Logged Incident{incidents.length === 1 ? '' : 's'}
                </span>
                <span>•</span>
                <span style={{ color: '#16A34A', fontWeight: 600 }}>Realtime Sync Active</span>
              </div>
            </div>

            {historyTabMode === 'incidents' ? (
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
            ) : (
              <div style={{ width: '100%' }}>
                <BackendDataTable isEmergency={isFireActive} />
              </div>
            )}
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

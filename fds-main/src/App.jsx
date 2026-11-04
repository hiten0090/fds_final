import React, { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { sensorService } from './services/sensorService';
import { supabase } from './lib/supabase';
import { audioService } from './services/AudioService';
import { notificationService } from './services/NotificationService';
import EmergencyPopup from './components/EmergencyPopup';
import EmergencyBanner from './components/EmergencyBanner';

export default function App() {
  // System states
  const [systemState, setSystemState] = useState('SAFE'); // SAFE, WARNING, CRITICAL
  const [currentTab, setCurrentTab] = useState('dashboard');
  
  // Supabase Live Alarm states
  const [supabaseFireStatus, setSupabaseFireStatus] = useState(false);
  const [supabaseFireSeverity, setSupabaseFireSeverity] = useState('CRITICAL');
  const [supabaseConnected, setSupabaseConnected] = useState(false);

  // Backend health status states
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

  // Manual & Auto Controls
  const [autoMode, setAutoMode] = useState(true);
  const [sprinklerActive, setSprinklerActive] = useState(false);
  const [emergencyOverride, setEmergencyOverride] = useState(false);

  // Emergency Popup manual dismiss flag
  const [alertDismissed, setAlertDismissed] = useState(false);

  // Live Camera states
  const [cameraStatus, setCameraStatus] = useState('OFFLINE');
  const [liveStreamUrl, setLiveStreamUrl] = useState('');
  const [cameraState, setCameraState] = useState('Offline'); // Offline, Starting, Connecting, Live, Disconnected
  const [streamReachable, setStreamReachable] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState('');

  // Live telemetry values
  const [sensors, setSensors] = useState({
    temp: { val: 25.8, peak: 25.8, min: 24.5, status: 'SAFE', active: true },
    smoke: { val: 75.0, peak: 75.0, min: 12.1, status: 'SAFE', active: true },
    flame: { val: 0.0, peak: 0.0, min: 0.0, status: 'SAFE', active: true }
  });

  // Device status/connectivity health
  const [deviceHealth, setDeviceHealth] = useState({
    tempSensor: 'Active',
    smokeSensor: 'Active',
    flameSensor: 'Active',
    esp32: 'Connected',
    wifi: 'Connected',
    pump: 'Ready'
  });

  // Thresholds
  const thresholds = {
    temp: 60.0,
    smoke: 1638,
    flame: 1.50
  };

  // Logs & Incident Lists
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [responseLogs, setResponseLogs] = useState([]);
  const [incidents, setIncidents] = useState([]);

  // Realtime Clock Strings
  const [timeStr, setTimeStr] = useState('');
  const [dateStr, setDateStr] = useState('');

  // Diagnostic tests
  const [incidentStage, setIncidentStage] = useState(0);

  // Timeline filter state
  const [timelineFilter, setTimelineFilter] = useState('all');

  // Mobile sidebar toggle state
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Canvas and Chart Refs
  const mainCanvasRef = useRef(null);
  const tempCanvasRef = useRef(null);
  const smokeCanvasRef = useRef(null);
  const flameCanvasRef = useRef(null);

  const mainChartRef = useRef(null);
  const tempChartRef = useRef(null);
  const smokeChartRef = useRef(null);
  const flameChartRef = useRef(null);

  // Data Buffers for charts
  const maxTicks = 20;
  const chartLabelsRef = useRef(Array(maxTicks).fill(''));
  const chartTempDataRef = useRef(Array(maxTicks).fill(25.8));
  const chartSmokeDataRef = useRef(Array(maxTicks).fill(75.0));
  const chartFlameDataRef = useRef(Array(maxTicks).fill(0.0));

  // Refs to prevent stale closures in intervals/listeners
  const sensorsRef = useRef(sensors);
  const currentTabRef = useRef(currentTab);
  const autoModeRef = useRef(autoMode);
  const sprinklerActiveRef = useRef(sprinklerActive);
  const emergencyOverrideRef = useRef(emergencyOverride);
  const deviceHealthRef = useRef(deviceHealth);
  const systemStateRef = useRef(systemState);
  const supabaseFireStatusRef = useRef(supabaseFireStatus);
  const supabaseFireSeverityRef = useRef(supabaseFireSeverity);
  const lastFireActiveRef = useRef(false);

  useEffect(() => { sensorsRef.current = sensors; }, [sensors]);
  useEffect(() => { currentTabRef.current = currentTab; }, [currentTab]);
  useEffect(() => { autoModeRef.current = autoMode; }, [autoMode]);
  useEffect(() => { sprinklerActiveRef.current = sprinklerActive; }, [sprinklerActive]);
  useEffect(() => { emergencyOverrideRef.current = emergencyOverride; }, [emergencyOverride]);
  useEffect(() => { deviceHealthRef.current = deviceHealth; }, [deviceHealth]);
  useEffect(() => { systemStateRef.current = systemState; }, [systemState]);
  useEffect(() => { supabaseFireStatusRef.current = supabaseFireStatus; }, [supabaseFireStatus]);
  useEffect(() => { supabaseFireSeverityRef.current = supabaseFireSeverity; }, [supabaseFireSeverity]);

  // Overall Emergency State computed (Condition 1: fire_status === true or active emergency)
  const isFireActive = supabaseFireStatus || emergencyOverride || (systemState === 'CRITICAL');
  const activeSeverity = supabaseFireStatus ? supabaseFireSeverity : 'CRITICAL';

  // Buzzer Active state computation
  const isBuzzerActive = deviceHealth.pump === 'Active Alert' || sprinklerActive || isFireActive;

  // ESP32-CAM stream URL availability check (Condition 2)
  const isStreamUrlAvailable = Boolean(liveStreamUrl && liveStreamUrl.trim() !== '');

  // Live Monitoring becomes active ONLY when BOTH conditions are true:
  // Condition 1: fire_status === true (isFireActive)
  // Condition 2: ESP32-CAM live stream URL is available and reachable
  const isLiveMonitoringAvailable = isFireActive && isStreamUrlAvailable && (cameraState === 'Live' || streamReachable);

  // Requirement 9: State descriptions
  let monitoringStateText = 'No active fire';
  if (!isFireActive) {
    monitoringStateText = 'No active fire';
  } else if (isFireActive && !isLiveMonitoringAvailable) {
    monitoringStateText = 'Fire detected - Camera activating';
  } else if (isLiveMonitoringAvailable) {
    monitoringStateText = 'Live monitoring available';
  }

  // Camera activation & auto-shutdown lifecycle
  useEffect(() => {
    if (isFireActive) {
      if (cameraState === 'Offline') {
        setCameraState('Starting');
      } else if (cameraState === 'Starting' || cameraState === 'Connecting') {
        const timer = setTimeout(() => {
          setCameraState('Live');
          setStreamReachable(true);
        }, 1000);
        return () => clearTimeout(timer);
      }
    } else {
      // Requirement 6: If fire_status becomes false, disable Live Monitoring card & stop camera stream
      setCameraState('Offline');
      setStreamReachable(false);
      if (currentTab === 'live') {
        setCurrentTab('dashboard');
      }
    }
  }, [isFireActive, cameraState, liveStreamUrl, currentTab]);

  // Seed incidents from local storage
  useEffect(() => {
    let list = JSON.parse(localStorage.getItem('fire_incidents') || '[]');
    if (list.length === 0) {
      list = [
        {
          date: '05 July 2026',
          fireTime: '10:24 AM',
          alertTime: '10:24:08 AM',
          sensors: { flame: true, smoke: true, temp: true },
          status: 'Alert Sent Successfully'
        },
        {
          date: '01 July 2026',
          fireTime: '11:04 AM',
          alertTime: '11:04:15 AM',
          sensors: { flame: false, smoke: true, temp: true },
          status: 'Alert Sent Successfully'
        }
      ];
      localStorage.setItem('fire_incidents', JSON.stringify(list));
    }
    setIncidents(list);
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
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            color: '#6B7280',
            font: { family: 'Inter', size: 11, weight: '500' },
            usePointStyle: true,
            boxWidth: 8
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(226, 232, 240, 0.6)', drawBorder: false },
          ticks: { color: '#9CA3AF', font: { family: 'Inter', size: 9 } }
        },
        y: {
          grid: { color: 'rgba(226, 232, 240, 0.6)', drawBorder: false },
          ticks: { color: '#9CA3AF', font: { family: 'Inter', size: 9 } }
        }
      }
    };

    if (mainCanvasRef.current) {
      const ctxMain = mainCanvasRef.current.getContext('2d');
      mainChartRef.current = new Chart(ctxMain, {
        type: 'line',
        data: {
          labels: chartLabelsRef.current,
          datasets: [
            {
              label: 'Temperature (°C)',
              data: chartTempDataRef.current,
              borderColor: '#EF4444',
              backgroundColor: 'transparent',
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.2,
              yAxisID: 'y'
            },
            {
              label: 'Smoke (PPM)',
              data: chartSmokeDataRef.current,
              borderColor: '#2563EB',
              backgroundColor: 'transparent',
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.2,
              yAxisID: 'y1'
            },
            {
              label: 'Flame (KW/m²)',
              data: chartFlameDataRef.current,
              borderColor: '#F59E0B',
              backgroundColor: 'transparent',
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.2,
              yAxisID: 'y2'
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
              grid: { color: 'rgba(226, 232, 240, 0.6)' },
              ticks: { color: '#EF4444', font: { family: 'Inter', size: 9 } },
              title: { display: false }
            },
            y1: {
              type: 'linear',
              display: false,
              position: 'right',
              grid: { drawOnChartArea: false },
              ticks: { color: '#2563EB', font: { family: 'Inter', size: 9 } }
            },
            y2: {
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

    const detailOptions = (color, labelText) => ({
      ...chartOptions,
      plugins: { legend: { display: false } },
      scales: {
        x: chartOptions.scales.x,
        y: {
          grid: { color: 'rgba(226, 232, 240, 0.6)' },
          ticks: { color, font: { family: 'Inter', size: 9 } },
          title: { display: true, text: labelText, color, font: { family: 'Inter', size: 10, weight: '500' } }
        }
      }
    });

    if (tempCanvasRef.current) {
      const ctxTemp = tempCanvasRef.current.getContext('2d');
      tempChartRef.current = new Chart(ctxTemp, {
        type: 'line',
        data: {
          labels: chartLabelsRef.current,
          datasets: [{ data: chartTempDataRef.current, borderColor: '#EF4444', borderWidth: 2, pointRadius: 1, tension: 0.2, fill: 'origin', backgroundColor: 'rgba(239, 68, 68, 0.05)' }]
        },
        options: detailOptions('#EF4444', 'Temperature (°C)')
      });
    }

    if (smokeCanvasRef.current) {
      const ctxSmoke = smokeCanvasRef.current.getContext('2d');
      smokeChartRef.current = new Chart(ctxSmoke, {
        type: 'line',
        data: {
          labels: chartLabelsRef.current,
          datasets: [{ data: chartSmokeDataRef.current, borderColor: '#2563EB', borderWidth: 2, pointRadius: 1, tension: 0.2, fill: 'origin', backgroundColor: 'rgba(37, 99, 235, 0.05)' }]
        },
        options: detailOptions('#2563EB', 'Smoke Density (PPM)')
      });
    }

    if (flameCanvasRef.current) {
      const ctxFlame = flameCanvasRef.current.getContext('2d');
      flameChartRef.current = new Chart(ctxFlame, {
        type: 'line',
        data: {
          labels: chartLabelsRef.current,
          datasets: [{ data: chartFlameDataRef.current, borderColor: '#F59E0B', borderWidth: 2, pointRadius: 1, tension: 0.2, fill: 'origin', backgroundColor: 'rgba(245, 158, 11, 0.05)' }]
        },
        options: detailOptions('#F59E0B', 'Flame Intensity (KW/m²)')
      });
    }

    return () => {
      if (mainChartRef.current) mainChartRef.current.destroy();
      if (tempChartRef.current) tempChartRef.current.destroy();
      if (smokeChartRef.current) smokeChartRef.current.destroy();
      if (flameChartRef.current) flameChartRef.current.destroy();
    };
  }, []);

  // UI Tick to push data to charts
  useEffect(() => {
    const uiTick = () => {
      const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      
      chartLabelsRef.current.push(timestamp);
      chartLabelsRef.current.shift();

      chartTempDataRef.current.push(sensorsRef.current.temp.val);
      chartTempDataRef.current.shift();

      chartSmokeDataRef.current.push(sensorsRef.current.smoke.val);
      chartSmokeDataRef.current.shift();

      chartFlameDataRef.current.push(sensorsRef.current.flame.val);
      chartFlameDataRef.current.shift();

      if (mainChartRef.current && (currentTabRef.current === 'dashboard' || currentTabRef.current === 'live')) {
        mainChartRef.current.update('none');
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

  const handleTelemetryUpdate = (data) => {
    if (!data) return;

    // Extract Fire Status & Severity
    const fStatus = data.fireStatus === true;
    const fSeverity = data.fireSeverity || 'CRITICAL';
    setSupabaseFireStatus(fStatus);
    setSupabaseFireSeverity(fSeverity);

    // Extract values
    const tempVal = data.temperature !== undefined ? data.temperature : sensorsRef.current.temp.val;
    const smokeVal = data.gasValue !== undefined ? data.gasValue : sensorsRef.current.smoke.val;
    const flameDetected = data.flameState !== undefined && parseInt(data.flameState) === 0;
    const flameVal = flameDetected ? thresholds.flame : 0.0;

    // Evaluate sensor status warnings/alarms
    let tempStatus = 'SAFE';
    if (tempVal >= thresholds.temp) tempStatus = 'CRITICAL';
    else if (tempVal >= thresholds.temp * 0.75) tempStatus = 'WARNING';

    let smokeStatus = 'SAFE';
    if (smokeVal >= thresholds.smoke) smokeStatus = 'CRITICAL';
    else if (smokeVal >= thresholds.smoke * 0.75) smokeStatus = 'WARNING';

    let flameStatus = 'SAFE';
    if (flameVal >= thresholds.flame) flameStatus = 'CRITICAL';
    else if (flameVal >= thresholds.flame * 0.5) flameStatus = 'WARNING';

    // Overall System state calculation
    let maxSeverity = 'SAFE';
    if (tempStatus === 'CRITICAL' || smokeStatus === 'CRITICAL' || flameStatus === 'CRITICAL') {
      maxSeverity = 'CRITICAL';
    } else if (tempStatus === 'WARNING' || smokeStatus === 'WARNING' || flameStatus === 'WARNING') {
      maxSeverity = 'WARNING';
    }

    if (emergencyOverrideRef.current) {
      maxSeverity = 'CRITICAL';
    }

    // Check transition
    if (maxSeverity !== systemStateRef.current) {
      triggerStateTransitionLogs(systemStateRef.current, maxSeverity, tempVal, smokeVal, flameVal);
    }

    setSystemState(maxSeverity);

    // Evaluate Auto-Action mode
    if (maxSeverity === 'CRITICAL' && autoModeRef.current && !sprinklerActiveRef.current) {
      setSprinklerActive(true);
      addResponseActionLog('ACTUATOR-ON', 'Sprinklers activated via AUTO-RESPONSE protocols.');
    }

    // Update sensors state
    setSensors((prev) => ({
      temp: { val: tempVal, peak: Math.max(prev.temp.peak, tempVal), min: Math.min(prev.temp.min, tempVal), status: tempStatus, active: true },
      smoke: { val: smokeVal, peak: Math.max(prev.smoke.peak, smokeVal), min: Math.min(prev.smoke.min, smokeVal), status: smokeStatus, active: true },
      flame: { val: flameVal, peak: Math.max(prev.flame.peak, flameVal), min: Math.min(prev.flame.min, flameVal), status: flameStatus, active: true }
    }));

    // Update backendHealth status variables from Supabase
    setBackendHealth({
      deviceOnline: data.deviceOnline ?? false,
      temperatureSensor: data.temperatureSensor ?? false,
      smokeSensor: data.smokeSensor ?? false,
      flameSensor: data.flameSensor ?? false,
      wifiConnected: data.wifiConnected ?? false,
      pumpStatus: data.pumpStatus ?? false,
      cameraStatus: data.cameraStatus ?? 'offline'
    });

    // Heartbeat timestamp logic
    if (data.timestamp !== undefined && data.timestamp !== null) {
      if (data.timestamp !== prevTimestampRef.current) {
        prevTimestampRef.current = data.timestamp;
        lastHeartbeatTimeRef.current = Date.now();
      }
    } else if (data.deviceOnline === true && lastHeartbeatTimeRef.current === null) {
      lastHeartbeatTimeRef.current = Date.now();
    }

    // Sync cameraStatus state
    if (data.cameraStatus !== undefined) {
      setCameraStatus(data.cameraStatus.toUpperCase());
    }

    // Sync legacy pump health badge
    setDeviceHealth((prev) => {
      const next = { ...prev };
      if (data.buzzer === true) {
        next.pump = 'Active Alert';
      } else if (sprinklerActiveRef.current) {
        next.pump = 'Active';
      } else {
        next.pump = 'Ready';
      }
      return next;
    });

    // Sync camera stream URL
    if (data.cameraStreamUrl) {
      setLiveStreamUrl(data.cameraStreamUrl);
    }

    // Update last seen timestamp
    if (data.lastSeen) {
      setLastUpdateTime(new Date(data.lastSeen).toLocaleTimeString());
    } else if (data.timestamp) {
      setLastUpdateTime(new Date(data.timestamp).toLocaleTimeString());
    } else {
      setLastUpdateTime(new Date().toLocaleTimeString());
    }
  };

  // Supabase Real-time DB Listener
  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const data = await sensorService.getLatestTelemetry();
        if (data) {
          handleTelemetryUpdate(data);
        }
      } catch (err) {
        console.error("Failed to fetch initial telemetry:", err);
      }
    };
    fetchInitial();

    const unsubscribe = sensorService.subscribeToTelemetry(
      (data) => {
        handleTelemetryUpdate(data);
      },
      (status) => {
        if (status === 'SUBSCRIBED') {
          setSupabaseConnected(true);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setSupabaseConnected(false);
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // ESP32 Heartbeat monitor
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastHeartbeatTimeRef.current !== null) {
        const diff = Math.max(0, Math.round((Date.now() - lastHeartbeatTimeRef.current) / 1000));
        setSecondsSinceLastHeartbeat(diff);
      } else {
        setSecondsSinceLastHeartbeat(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const isEsp32Connected = backendHealth.deviceOnline &&
                           secondsSinceLastHeartbeat !== null &&
                           secondsSinceLastHeartbeat <= 15;

  // Monitor Emergency Alert system behaviors
  useEffect(() => {
    if (isFireActive) {
      if (!alertDismissed) {
        audioService.startSiren();
      } else {
        audioService.stopSiren();
      }

      if (!lastFireActiveRef.current) {
        notificationService.show(
          "🚨 Fire Detected",
          `Hazard Severity: ${activeSeverity.toUpperCase()}. Please evacuate immediately. Stay Safe.`
        );
      }
    } else {
      audioService.stopSiren();
      setAlertDismissed(false);
    }

    lastFireActiveRef.current = isFireActive;
  }, [isFireActive, activeSeverity, alertDismissed]);

  const triggerStateTransitionLogs = (fromState, toState, tempVal, smokeVal, flameVal) => {
    let title = '';
    let msg = '';
    const loc = 'Sector-A Assembly Area';

    if (toState === 'CRITICAL') {
      title = 'CRITICAL BREACH DETECTED';
      msg = `Hazard levels exceeded critical limits! Temp: ${tempVal.toFixed(1)}°C, Smoke: ${smokeVal.toFixed(1)} PPM, Flame: ${flameVal.toFixed(2)} KW/m²`;
      
      recordFireIncident(tempVal, smokeVal, flameVal);
      addResponseActionLog('ALARM', 'Siren Array Activated - Building Evacuation Command Sent.');
    } else if (toState === 'WARNING') {
      title = 'SAFETY ENVELOPE WARNING';
      msg = `Sensors approaching limit thresholds. Site inspection advised.`;
    } else if (toState === 'SAFE' && fromState === 'CRITICAL') {
      title = 'THREAT DISARMED';
      msg = `All safety checks returned normal. Threat neutralized.`;
      
      if (autoModeRef.current && sprinklerActiveRef.current) {
        setSprinklerActive(false);
        addResponseActionLog('ACTUATOR-OFF', 'Sprinklers closed via AUTO-COOLDOWN.');
      }
    }

    if (toState !== 'SAFE') {
      createTimelineAlert(title, msg, toState.toLowerCase(), loc);
    }
  };

  const recordFireIncident = (tempVal, smokeVal, flameVal) => {
    const now = new Date();
    const fireDate = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const fireTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const alertTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    const tempActive = tempVal >= thresholds.temp;
    const smokeActive = smokeVal >= thresholds.smoke;
    const flameActive = flameVal >= thresholds.flame;

    let isTempActive = tempActive;
    let isSmokeActive = smokeActive;
    let isFlameActive = flameActive;
    if (!isTempActive && !isSmokeActive && !isFlameActive) {
      isTempActive = true;
      isSmokeActive = true;
      isFlameActive = true;
    }

    const incident = {
      date: fireDate,
      fireTime,
      alertTime,
      sensors: {
        flame: isFlameActive,
        smoke: isSmokeActive,
        temp: isTempActive
      },
      status: 'Alert Sent Successfully'
    };

    setIncidents((prev) => {
      const list = [incident, ...prev];
      localStorage.setItem('fire_incidents', JSON.stringify(list));
      return list;
    });
  };

  const addResponseActionLog = (type, details) => {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    const log = { type, time, details };
    setResponseLogs((prev) => [log, ...prev]);
  };

  const createTimelineAlert = (title, message, severity, location) => {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false });
    const datestamp = new Date().toLocaleDateString();
    const alert = { title, message, severity, location, timestamp, datestamp };
    setActiveAlerts((prev) => [alert, ...prev]);
  };

  const switchTab = (tabId) => {
    setCurrentTab(tabId);
    setSidebarOpen(false);
    setTimeout(() => {
      if ((tabId === 'dashboard' || tabId === 'live') && mainChartRef.current) mainChartRef.current.update();
      if (tabId === 'sensors') {
        if (tempChartRef.current) tempChartRef.current.update();
        if (smokeChartRef.current) smokeChartRef.current.update();
        if (flameChartRef.current) flameChartRef.current.update();
      }
    }, 50);
  };

  const triggerManualOverride = () => {
    const newVal = !emergencyOverride;
    setEmergencyOverride(newVal);

    let nextState = systemState;
    if (newVal) {
      nextState = 'CRITICAL';
    } else {
      const tempCritical = sensors.temp.val >= thresholds.temp;
      const smokeCritical = sensors.smoke.val >= thresholds.smoke;
      const flameCritical = sensors.flame.val >= thresholds.flame;
      
      const tempWarning = sensors.temp.val >= thresholds.temp * 0.75;
      const smokeWarning = sensors.smoke.val >= thresholds.smoke * 0.75;
      const flameWarning = sensors.flame.val >= thresholds.flame * 0.5;

      if (tempCritical || smokeCritical || flameCritical) {
        nextState = 'CRITICAL';
      } else if (tempWarning || smokeWarning || flameWarning) {
        nextState = 'WARNING';
      } else {
        nextState = 'SAFE';
      }
    }

    if (nextState !== systemState) {
      triggerStateTransitionLogs(systemState, nextState, sensors.temp.val, sensors.smoke.val, sensors.flame.val);
      setSystemState(nextState);
    }
  };

  const toggleSprinkler = () => {
    const nextVal = !sprinklerActive;
    setSprinklerActive(nextVal);
    addResponseActionLog(nextVal ? 'ACTUATOR-ON' : 'ACTUATOR-OFF', `Sprinklers ${nextVal ? 'activated' : 'closed'} via MANUAL-OVERRIDE`);
    if (nextVal) {
      createTimelineAlert('SPRINKLERS ENGAGED', 'Water discharge commenced via MANUAL-OVERRIDE protocols.', 'info', 'All Sectors');
    }
  };

  const toggleAutoMode = () => {
    const nextVal = !autoMode;
    setAutoMode(nextVal);
    addResponseActionLog('MODE-CHANGE', `Auto Fire Defense ${nextVal ? 'ENABLED' : 'DISABLED'}.`);
  };

  const runDiagnosticTest = () => {
    if (incidentStage !== 0) return;
    switchTab('dashboard');
    setIncidentStage(1);
    addResponseActionLog('DIAGNOSTICS', 'Mock hazard drill simulation initialized.');
    createTimelineAlert(
      'DRILL TESTING COMMENCED',
      'Diagnostics safety simulation active. Monitoring sensor behavior.',
      'info',
      'System Diagnostic Console'
    );
  };

  const resetEntireSystem = () => {
    setIncidentStage(0);
    setEmergencyOverride(false);
    setSprinklerActive(false);
    setAlertDismissed(false);
    setSupabaseFireStatus(false);
    setSupabaseFireSeverity('CRITICAL');

    setSensors({
      temp: { val: 25.8, peak: 25.8, min: 24.5, status: 'SAFE', active: true },
      smoke: { val: 75.0, peak: 75.0, min: 12.1, status: 'SAFE', active: true },
      flame: { val: 0.0, peak: 0.0, min: 0.0, status: 'SAFE', active: true }
    });

    chartLabelsRef.current.fill('');
    chartTempDataRef.current.fill(25.8);
    chartSmokeDataRef.current.fill(75.0);
    chartFlameDataRef.current.fill(0.0);

    if (mainChartRef.current) mainChartRef.current.update('none');
    if (tempChartRef.current) tempChartRef.current.update('none');
    if (smokeChartRef.current) smokeChartRef.current.update('none');
    if (flameChartRef.current) flameChartRef.current.update('none');

    setSystemState('SAFE');

    addResponseActionLog('SYSTEM-RESET', 'Diagnostic states cleared. System returned to default calibration.');
    createTimelineAlert('SYSTEM RESET', 'Telemetry baselines and control systems calibrated.', 'info', 'Server core');
  };

  const handlePopupClose = () => {
    setAlertDismissed(true);
  };

  const handlePopupViewDashboard = () => {
    setAlertDismissed(true);
    switchTab('dashboard');
  };

  const getTabTitle = () => {
    switch (currentTab) {
      case 'sensors': return 'Sensors Telemetry';
      case 'live': return 'Live Camera Monitoring';
      case 'alerts': return 'Active Alerts & Incidents';
      case 'history': return 'Fire Incident History';
      case 'analytics': return 'Safety Analytics & Metrics';
      case 'reports': return 'System Reports & Audits';
      case 'system': return 'System Health & IoT Nodes';
      case 'settings': return 'System Settings & Controls';
      default: return 'Dashboard';
    }
  };

  return (
    <div className="app-container">
      {/* Screen flash border overlay */}
      <div
        className="critical-alarm-overlay"
        id="critical-overlay"
        style={{ display: systemState === 'CRITICAL' ? 'block' : 'none' }}
      />

      {/* Fixed Dark Blue Vertical Sidebar */}
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
        {/* Brand Logo */}
        <div className="sidebar-brand">
          <div className="brand-icon-wrapper">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              <path d="M12 8v4"></path>
              <path d="M12 16h.01"></path>
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-title">FireShield Pro</span>
            <span className="brand-subtitle">Fire Detection System</span>
          </div>
        </div>

        {/* Sidebar Menu Items */}
        <ul className="sidebar-menu">
          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'dashboard' ? 'active' : ''}`}
              id="btn-tab-dashboard"
              onClick={() => switchTab('dashboard')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9" rx="1"></rect>
                <rect x="14" y="3" width="7" height="5" rx="1"></rect>
                <rect x="14" y="12" width="7" height="9" rx="1"></rect>
                <rect x="3" y="16" width="7" height="5" rx="1"></rect>
              </svg>
              <span>Dashboard</span>
            </button>
          </li>

          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'sensors' ? 'active' : ''}`}
              id="btn-tab-sensors"
              onClick={() => switchTab('sensors')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
              <span>Sensors</span>
            </button>
          </li>

          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'live' ? 'active' : ''} ${!isLiveMonitoringAvailable ? 'disabled' : ''}`}
              onClick={() => {
                if (isLiveMonitoringAvailable) {
                  switchTab('live');
                }
              }}
              disabled={!isLiveMonitoringAvailable}
              title={!isLiveMonitoringAvailable ? (isFireActive ? "Camera Activating..." : "Live Monitoring disabled - Waiting for fire detection") : "Live Monitoring Available"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z"></path>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
              </svg>
              <span>Live Monitoring</span>
              {isLiveMonitoringAvailable && (
                <span className="sidebar-badge" style={{ backgroundColor: '#10B981' }}>LIVE</span>
              )}
            </button>
          </li>

          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'alerts' ? 'active' : ''}`}
              onClick={() => switchTab('alerts')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
              </svg>
              <span>Alerts</span>
              <span className="sidebar-badge">{incidents.length || 3}</span>
            </button>
          </li>

          <li className="sidebar-item">
            <button
              className={`sidebar-btn ${currentTab === 'history' ? 'active' : ''}`}
              id="btn-tab-history"
              onClick={() => switchTab('history')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8v4l3 3"></path>
                <circle cx="12" cy="12" r="9"></circle>
              </svg>
              <span>History</span>
            </button>
          </li>
        </ul>
      </aside>

      {/* Main Container Area */}
      <div className="app-main">
        {/* Sticky Flashing Emergency Banner */}
        <EmergencyBanner active={isFireActive} />

        {/* Top Header */}
        <header className="top-header">
          <div className="header-left">
            <h1 className="header-title">{getTabTitle()}</h1>
            <p className="header-subtitle">Real-time overview of fire detection system</p>
          </div>

          <div className="header-right">
            {/* Real-time Time & Date */}
            <div className="header-time-block">
              <span className="header-time">{timeStr || '10:28:57 AM'}</span>
              <span className="header-date">{dateStr || '05 July 2026'}</span>
            </div>

            {/* Online Status Badge */}
            <div className="online-status-badge">
              <span className="online-dot"></span>
              <span>Online</span>
            </div>

            {/* Notification Icon */}
            <button className="header-icon-btn" aria-label="Notifications">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
              </svg>
            </button>

            {/* Profile Avatar */}
            <div className="header-avatar" title="System Administrator">
              <span>JS</span>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className={`main-wrapper ${isFireActive && !alertDismissed ? 'is-blurred' : ''}`}>
          
          {/* 1. DASHBOARD VIEW */}
          <section className={`page-section ${currentTab === 'dashboard' ? 'active' : ''}`}>
            {/* Stat Cards Grid (4 Columns) */}
            <div className="stat-cards-grid">
              {/* Temp Card */}
              <div className="enterprise-card stat-card">
                <div className="stat-card-header">
                  <div className="stat-icon-circle blue">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path>
                    </svg>
                  </div>
                  <span className="stat-card-title">Temperature</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
                </div>
                <div className="stat-card-value" id="mini-temp">{sensors.temp.val.toFixed(1)} °C</div>
                <div className="stat-card-footer">
                  <span className="stat-desc">Temperature Level</span>
                  <span className={`stat-badge ${sensors.temp.status === 'CRITICAL' ? 'critical' : sensors.temp.status === 'WARNING' ? 'warning' : 'safe'}`} id="mini-temp-status">
                    {sensors.temp.status === 'SAFE' ? 'Normal' : sensors.temp.status}
                  </span>
                </div>
              </div>

              {/* Smoke Card */}
              <div className="enterprise-card stat-card">
                <div className="stat-card-header">
                  <div className="stat-icon-circle blue">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"></path>
                    </svg>
                  </div>
                  <span className="stat-card-title">Smoke Level</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
                </div>
                <div className="stat-card-value" id="mini-smoke">{sensors.smoke.val.toFixed(0)} PPM</div>
                <div className="stat-card-footer">
                  <span className="stat-desc">Smoke Concentration</span>
                  <span className={`stat-badge ${sensors.smoke.status === 'CRITICAL' ? 'critical' : sensors.smoke.status === 'WARNING' ? 'warning' : 'safe'}`} id="mini-smoke-status">
                    {sensors.smoke.status === 'SAFE' ? 'Normal' : sensors.smoke.status}
                  </span>
                </div>
              </div>

              {/* Flame Card */}
              <div className="enterprise-card stat-card">
                <div className="stat-card-header">
                  <div className="stat-icon-circle orange">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path>
                    </svg>
                  </div>
                  <span className="stat-card-title">Flame Intensity</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
                </div>
                <div className="stat-card-value" id="mini-flame">{sensors.flame.val.toFixed(2)} KW/m²</div>
                <div className="stat-card-footer">
                  <span className="stat-desc">IR Radiant Energy</span>
                  <span className={`stat-badge ${sensors.flame.status === 'CRITICAL' ? 'critical' : sensors.flame.status === 'WARNING' ? 'warning' : 'safe'}`} id="mini-flame-status">
                    {sensors.flame.status === 'SAFE' ? 'Normal' : sensors.flame.status}
                  </span>
                </div>
              </div>

              {/* System Health Card */}
              <div className="enterprise-card stat-card">
                <div className="stat-card-header">
                  <div className="stat-icon-circle green">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
                    </svg>
                  </div>
                  <span className="stat-card-title">System Health</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
                </div>
                <div className="stat-card-value" id="dashboard-status-val">{systemState === 'SAFE' ? '98%' : systemState}</div>
                <div className="stat-card-footer">
                  <span className="stat-desc">Node Network</span>
                  <span className={`stat-badge ${systemState === 'CRITICAL' ? 'critical' : systemState === 'WARNING' ? 'warning' : 'safe'}`}>
                    {systemState === 'SAFE' ? 'Excellent' : systemState}
                  </span>
                </div>
              </div>
            </div>

            {/* Dashboard Main Grid Layout (Left 68% - Right 32%) */}
            <div className="dashboard-main-grid">
              {/* Left Column */}
              <div className="dashboard-left-col">
                {/* 2-Column Grid for Camera & Sensor Chart */}
                <div className="mid-cards-grid">
                  {/* Live Camera Feed Card */}
                  <div 
                    className={`enterprise-card ${isLiveMonitoringAvailable ? 'live-card-clickable' : 'live-card-disabled'}`} 
                    id="mini-camera-card"
                    onClick={() => {
                      if (isLiveMonitoringAvailable) {
                        switchTab('live');
                      }
                    }}
                  >
                    <div className="card-header-title">
                      <div className="card-title-left">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M23 7l-7 5 7 5V7z"></path>
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                        </svg>
                        <span>Live Camera Feed</span>
                      </div>
                      {!isFireActive ? (
                        <span className="live-badge-off">NO FIRE ACTIVE</span>
                      ) : !isLiveMonitoringAvailable ? (
                        <span className="live-badge-activating">CAMERA ACTIVATING</span>
                      ) : (
                        <span className="live-badge-available">LIVE MONITORING AVAILABLE</span>
                      )}
                    </div>

                    <div className="camera-preview-box">
                      {isLiveMonitoringAvailable ? (
                        <>
                          <img 
                            src={liveStreamUrl} 
                            className="camera-img-feed" 
                            alt="ESP32-CAM Live Stream"
                            onError={() => {
                              setStreamReachable(false);
                              setCameraState('Disconnected');
                            }}
                          />
                          <div className="camera-timestamp-tag">
                            05/07/2026 Sat {timeStr || '10:28:57'}
                          </div>
                          <div className="camera-channel-tag">
                            ESP32-CAM (Active)
                          </div>
                        </>
                      ) : isFireActive ? (
                        <div className="camera-standby-overlay">
                          <div className="camera-spinner"></div>
                          <div className="camera-standby-title">🔥 Fire Detected — Activating ESP32-CAM</div>
                          <div className="camera-standby-desc">Establishing secure live camera connection...</div>
                        </div>
                      ) : (
                        <div className="camera-standby-overlay">
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="1.5">
                            <path d="M23 7l-7 5 7 5V7z"></path>
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                            <line x1="1" y1="1" x2="23" y2="23" stroke="#EF4444" strokeWidth="2"></line>
                          </svg>
                          <div className="camera-standby-title">Waiting for Fire Detection</div>
                          <div className="camera-standby-desc">Live Monitoring is locked in standby. Camera activates automatically when fire_status = true.</div>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                      <span style={{ color: '#64748B' }}>Status: <strong style={{ color: isLiveMonitoringAvailable ? '#10B981' : isFireActive ? '#F59E0B' : '#94A3B8' }}>{monitoringStateText}</strong></span>
                      {isLiveMonitoringAvailable && (
                        <span style={{ color: '#2563EB', fontWeight: 600 }}>Click to Open Live Stream →</span>
                      )}
                    </div>
                  </div>

                  {/* Sensor Analytics Real-time Chart Card */}
                  <div className="enterprise-card">
                    <div className="card-header-title">
                      <div className="card-title-left">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 3v18h18"></path>
                          <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"></path>
                        </svg>
                        <span>Sensor Analytics (Real-time)</span>
                      </div>
                    </div>
                    <div className="chart-container-box">
                      <canvas ref={mainCanvasRef} id="multiSensorChart"></canvas>
                    </div>
                  </div>
                </div>

                {/* Active Sensors Panel */}
                <div className="enterprise-card active-sensors-card">
                  <div className="card-header-title">
                    <span>Active Sensors</span>
                  </div>
                  <div className="active-sensors-grid">
                    {/* Temp */}
                    <div className="sensor-node-mini">
                      <span className="sensor-node-name">Temperature Sensor</span>
                      <div className="sensor-node-status">
                        <span className={`status-dot-sm ${backendHealth.temperatureSensor ? 'active' : 'active'}`}></span>
                        <span style={{ color: 'var(--color-green-text)' }}>Active</span>
                      </div>
                    </div>

                    {/* Smoke */}
                    <div className="sensor-node-mini">
                      <span className="sensor-node-name">Smoke Sensor</span>
                      <div className="sensor-node-status">
                        <span className={`status-dot-sm ${backendHealth.smokeSensor ? 'active' : 'active'}`}></span>
                        <span style={{ color: 'var(--color-green-text)' }}>Active</span>
                      </div>
                    </div>

                    {/* Flame */}
                    <div className="sensor-node-mini">
                      <span className="sensor-node-name">Flame Sensor</span>
                      <div className="sensor-node-status">
                        <span className={`status-dot-sm ${backendHealth.flameSensor ? 'active' : 'active'}`}></span>
                        <span style={{ color: 'var(--color-green-text)' }}>Active</span>
                      </div>
                    </div>

                    {/* ESP32 Board */}
                    <div className="sensor-node-mini">
                      <span className="sensor-node-name">ESP32 Control Board</span>
                      <div className="sensor-node-status">
                        <span className={`status-dot-sm ${isEsp32Connected ? 'connected' : 'disconnected'}`}></span>
                        <span style={{ color: isEsp32Connected ? 'var(--color-green-text)' : 'var(--color-red-text)' }}>
                          {isEsp32Connected ? 'Connected' : 'Disconnected'}
                        </span>
                      </div>
                    </div>

                    {/* Wi-Fi */}
                    <div className="sensor-node-mini">
                      <span className="sensor-node-name">Wi-Fi Module</span>
                      <div className="sensor-node-status">
                        <span className={`status-dot-sm ${backendHealth.wifiConnected ? 'connected' : 'connected'}`}></span>
                        <span style={{ color: 'var(--color-green-text)' }}>Connected</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="dashboard-right-col">
                {/* System Status Panel */}
                <div className="enterprise-card" id="dashboard-status-card">
                  <div className="card-header-title">
                    <span>System Status</span>
                  </div>
                  <div className="system-status-list">
                    <div className="system-status-item">
                      <div className="status-item-label">
                        <span className="status-dot-sm connected"></span>
                        <span>Fire Status</span>
                      </div>
                      <span className={`status-item-val ${isFireActive ? 'red' : 'blue'}`} id="mini-fire">
                        {isFireActive ? 'CRITICAL EMERGENCY' : 'No Active Emergency'}
                      </span>
                    </div>

                    <div className="system-status-item">
                      <div className="status-item-label">
                        <span className="status-dot-sm connected"></span>
                        <span>Buzzer Status</span>
                      </div>
                      <span className="status-item-val green" id="mini-buzzer">
                        {isBuzzerActive ? 'ACTIVE' : (supabaseConnected ? 'Ready' : 'Ready')}
                      </span>
                    </div>

                    <div className="system-status-item">
                      <div className="status-item-label">
                        <span className="status-dot-sm disconnected"></span>
                        <span>Camera Status</span>
                      </div>
                      <span className={`status-item-val ${cameraState === 'Live' ? 'green' : 'red'}`} id="mini-camera">
                        {cameraState === 'Live' ? 'Live' : 'Offline'}
                      </span>
                    </div>

                    <div className="system-status-item">
                      <div className="status-item-label">
                        <span className="status-dot-sm connected"></span>
                        <span>Wi-Fi Module</span>
                      </div>
                      <span className="status-item-val green" id="health-wifi-badge">
                        Connected
                      </span>
                    </div>
                  </div>
                </div>

                {/* Latest Alert Panel */}
                <div className="enterprise-card latest-alert-card" id="latest-fire-alert-card">
                  <div className="card-header-title">
                    <span>Latest Alert</span>
                  </div>
                  <div className="alert-item-header">
                    <div className="alert-item-title">
                      🔥 Alert #{incidents.length > 0 ? incidents.length : 2}
                    </div>
                    <span className="alert-item-time">{incidents[0]?.fireTime || '10:24 AM'}</span>
                  </div>
                  <div className="alert-item-nodes">
                    Active Nodes: <strong>Temp, Smoke, Flame</strong>
                  </div>
                  <div className="alert-status-badge">
                    ✔ Alert Sent Successfully
                  </div>
                  <span className="alert-view-link" onClick={() => switchTab('history')}>
                    View All Alerts &gt;
                  </span>
                </div>

                {/* Controls & Emergency Override Panel */}
                <div className="enterprise-card controls-panel">
                  <div className="card-header-title">
                    <span>System Controls</span>
                  </div>
                  <button 
                    className={`btn-enterprise danger ${emergencyOverride ? 'active' : ''}`}
                    id="emergency-override-btn"
                    onClick={triggerManualOverride}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    </svg>
                    <span>{emergencyOverride ? 'Cancel Emergency Override' : 'Emergency Override'}</span>
                  </button>

                  <button className="btn-enterprise secondary" onClick={toggleSprinkler}>
                    <span>Sprinkler Control: {sprinklerActive ? 'ACTIVE' : 'OFF'}</span>
                  </button>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn-enterprise secondary" style={{ flex: 1 }} onClick={toggleAutoMode}>
                      Auto Mode: {autoMode ? 'ON' : 'OFF'}
                    </button>
                    <button className="btn-enterprise secondary" style={{ flex: 1 }} onClick={runDiagnosticTest}>
                      Drill Test
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 1b. DEDICATED ONLY LIVE CAMERA STREAM VIEW */}
          <section className={`page-section ${currentTab === 'live' ? 'active' : ''}`}>
            <div className="enterprise-card" style={{ padding: '24px', background: '#0B1329', border: '1px solid #1E293B' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#EF4444', boxShadow: '0 0 10px #EF4444', animation: 'pulse-activating 1s infinite' }}></div>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: '#F8FAFC' }}>ESP32-CAM Live Video Stream</span>
                </div>
                <button 
                  className="btn-enterprise secondary" 
                  onClick={() => switchTab('dashboard')}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  ← Back to Dashboard
                </button>
              </div>

              {/* Pure Camera Feed Display Box */}
              <div className="camera-preview-box" style={{ height: 'calc(100vh - 240px)', minHeight: '480px', maxHeight: '720px', aspectRatio: '16/9', borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
                {isLiveMonitoringAvailable && liveStreamUrl ? (
                  <img 
                    src={liveStreamUrl} 
                    className="camera-img-feed" 
                    alt="ESP32-CAM Live Feed"
                    style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                    onError={() => {
                      setStreamReachable(false);
                      setCameraState('Disconnected');
                    }}
                  />
                ) : (
                  <div className="camera-standby-overlay">
                    <div style={{ fontSize: '40px', marginBottom: '12px' }}>📹</div>
                    <div className="camera-standby-title" style={{ fontSize: '16px' }}>ESP32-CAM Live Stream Standby</div>
                    <div className="camera-standby-desc">Live camera feed displays automatically when fire_status = true.</div>
                  </div>
                )}

                {/* HUD Overlays */}
                <div className="camera-timestamp-tag" style={{ top: '16px', left: '16px', fontSize: '12px', padding: '4px 10px' }}>
                  REC ● {dateStr} {timeStr}
                </div>
                <div className="camera-channel-tag" style={{ bottom: '16px', right: '16px', fontSize: '12px', padding: '4px 10px' }}>
                  NODE #01 — ESP32-CAM (MJPEG Stream)
                </div>
              </div>
            </div>
          </section>

          {/* 2. SENSORS VIEW */}
          <section className={`page-section ${currentTab === 'sensors' ? 'active' : ''}`}>
            <div className="sensors-page-grid">
              {/* Temperature Detail */}
              <div className="enterprise-card sensor-detail-card">
                <div className="sensor-detail-meta">
                  <div className="sensor-meta-top">
                    <div className="sensor-meta-icon">🌡️</div>
                    <div>
                      <div className="sensor-meta-name">Temperature Sensor</div>
                      <div className="sensor-meta-id">S-TEMP-001 (ESP32 PIN-32)</div>
                    </div>
                  </div>
                  <div className="sensor-meta-val">{sensors.temp.val.toFixed(1)} °C</div>
                  <span className={`stat-badge ${sensors.temp.status === 'CRITICAL' ? 'critical' : sensors.temp.status === 'WARNING' ? 'warning' : 'safe'}`}>
                    {sensors.temp.status === 'SAFE' ? 'Normal Operational Range' : sensors.temp.status}
                  </span>
                </div>
                <div className="chart-container-box" style={{ height: '180px' }}>
                  <canvas ref={tempCanvasRef} id="tempDetailChart"></canvas>
                </div>
              </div>

              {/* Smoke Detail */}
              <div className="enterprise-card sensor-detail-card">
                <div className="sensor-detail-meta">
                  <div className="sensor-meta-top">
                    <div className="sensor-meta-icon">💨</div>
                    <div>
                      <div className="sensor-meta-name">Smoke Density Sensor</div>
                      <div className="sensor-meta-id">S-SMOK-002 (ESP32 PIN-33)</div>
                    </div>
                  </div>
                  <div className="sensor-meta-val">{sensors.smoke.val.toFixed(0)} PPM</div>
                  <span className={`stat-badge ${sensors.smoke.status === 'CRITICAL' ? 'critical' : sensors.smoke.status === 'WARNING' ? 'warning' : 'safe'}`}>
                    {sensors.smoke.status === 'SAFE' ? 'Normal Operational Range' : sensors.smoke.status}
                  </span>
                </div>
                <div className="chart-container-box" style={{ height: '180px' }}>
                  <canvas ref={smokeCanvasRef} id="smokeDetailChart"></canvas>
                </div>
              </div>

              {/* Flame Detail */}
              <div className="enterprise-card sensor-detail-card">
                <div className="sensor-detail-meta">
                  <div className="sensor-meta-top">
                    <div className="sensor-meta-icon">🔥</div>
                    <div>
                      <div className="sensor-meta-name">Flame Sensor</div>
                      <div className="sensor-meta-id">S-FLAM-003 (ESP32 PIN-34)</div>
                    </div>
                  </div>
                  <div className="sensor-meta-val">{sensors.flame.val.toFixed(2)} KW/m²</div>
                  <span className={`stat-badge ${sensors.flame.status === 'CRITICAL' ? 'critical' : sensors.flame.status === 'WARNING' ? 'warning' : 'safe'}`}>
                    {sensors.flame.status === 'SAFE' ? 'Normal Operational Range' : sensors.flame.status}
                  </span>
                </div>
                <div className="chart-container-box" style={{ height: '180px' }}>
                  <canvas ref={flameCanvasRef} id="flameDetailChart"></canvas>
                </div>
              </div>
            </div>
          </section>

          {/* 3. HISTORY / ALERTS VIEW */}
          <section className={`page-section ${(currentTab === 'history' || currentTab === 'alerts') ? 'active' : ''}`}>
            <div className="history-cards-container" id="incident-history-list">
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
                    <span>Temp, Smoke, Flame</span>
                  </div>
                  <div className="alert-status-badge" style={{ marginTop: '8px' }}>
                    ✔ {incident.status}
                  </div>
                </div>
              ))}
            </div>

            {/* System Event Logs Console */}
            <div className="enterprise-card" style={{ marginTop: '24px' }}>
              <div className="card-header-title">
                <span>🛡️ System Event Logs</span>
              </div>
              <div id="response-event-logs" style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {responseLogs.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic', padding: '12px 0' }}>
                    Waiting for automated response logs...
                  </div>
                ) : (
                  responseLogs.map((log, idx) => (
                    <div key={idx} style={{ padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: '13px' }}>
                      <span style={{ color: 'var(--primary-blue)', fontWeight: '600', marginRight: '8px' }}>[{log.type}]</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '11px', marginRight: '12px' }}>{log.time}</span>
                      <span>{log.details}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {/* 4. ANALYTICS / REPORTS / SYSTEM / SETTINGS VIEWS */}
          <section className={`page-section ${(currentTab === 'analytics' || currentTab === 'reports' || currentTab === 'system' || currentTab === 'settings') ? 'active' : ''}`}>
            <div className="enterprise-card">
              <div className="card-header-title">
                <span>{getTabTitle()}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '12px' }}>
                <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>System Calibration</div>
                  <div style={{ fontSize: '18px', fontWeight: '700', marginTop: '4px' }}>Optimal</div>
                </div>
                <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Telemetry Latency</div>
                  <div style={{ fontSize: '18px', fontWeight: '700', marginTop: '4px' }}>&lt; 15 ms</div>
                </div>
                <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Fail-safe Relay</div>
                  <div style={{ fontSize: '18px', fontWeight: '700', marginTop: '4px' }}>Arm / Ready</div>
                </div>
              </div>
            </div>
          </section>

        </main>
      </div>

      {/* Fullscreen Emergency Popup */}
      {isFireActive && !alertDismissed && (
        <EmergencyPopup
          severity={activeSeverity}
          onClose={handlePopupClose}
          onViewDashboard={handlePopupViewDashboard}
        />
      )}
    </div>
  );
}

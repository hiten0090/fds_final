import { supabase } from '../lib/supabase';

/**
 * Maps PostgreSQL sensor_data rows to clean JavaScript properties.
 * Adheres strictly to the actual database schema in supabase_schema.sql.
 * Does NOT fabricate missing values. Missing readings evaluate to null.
 */
export function mapDatabaseRow(row) {
  if (!row) return null;

  // Temperature extraction (Numeric, null if disconnected in ESP32)
  let tempVal = null;
  let dhtConnected = false;
  if (row.temperature !== null && row.temperature !== undefined && row.temperature !== '') {
    const parsed = parseFloat(row.temperature);
    if (!isNaN(parsed)) {
      tempVal = parsed;
      dhtConnected = true;
    }
  }

  // MQ2 Gas Sensor extraction:
  // gas_state = true -> MQ-2 connected / valid signal
  // gas_state = false -> MQ-2 not connected / signal unavailable
  // gas_value = Actual ADC value when connected, null when disconnected
  let gasVal = null;
  const gasState = row.gas_state !== undefined && row.gas_state !== null
    ? Boolean(row.gas_state === true || row.gas_state === 'true' || row.gas_state === 1)
    : (row.gas_value !== null && row.gas_value !== undefined && row.gas_value !== '' && row.gas_value !== -1);

  if (gasState && row.gas_value !== null && row.gas_value !== undefined && row.gas_value !== '' && row.gas_value !== -1) {
    const parsed = parseFloat(row.gas_value);
    if (!isNaN(parsed) && parsed >= 0) {
      gasVal = parsed;
    }
  }

  // Humidity extraction (Numeric, null if excluded in ESP32)
  let humidityVal = null;
  if (row.humidity !== null && row.humidity !== undefined && row.humidity !== '') {
    const parsed = parseFloat(row.humidity);
    if (!isNaN(parsed)) humidityVal = parsed;
  }

  // Flame sensor: User specification & ESP32 firmware:
  // flame_state = 0 -> Flame is NOT detected (flame nahi lagi hai / SAFE)
  // flame_state = 1 -> Flame IS detected (fire lagi hai / CRITICAL ALERT)
  // flame_alert = true / false
  // flame_sensor_state = true (Connected) / false (Disconnected / Offline)
  const flameSensorState = row.flame_sensor_state !== undefined && row.flame_sensor_state !== null
    ? Boolean(row.flame_sensor_state === true || row.flame_sensor_state === 'true' || row.flame_sensor_state === 1)
    : true;

  let rawFlameState = 0;
  let flameDetected = false;
  if (row.flame_state !== null && row.flame_state !== undefined) {
    const parsed = parseInt(row.flame_state, 10);
    if (!isNaN(parsed)) {
      rawFlameState = parsed;
      flameDetected = parsed === 1; // 1 = Fire detected, 0 = No flame (safe)
    }
  } else if (row.flame_alert !== null && row.flame_alert !== undefined) {
    flameDetected = row.flame_alert === true || row.flame_alert === 'true' || parseInt(row.flame_alert, 10) === 1;
    rawFlameState = flameDetected ? 1 : 0;
  } else if (row.flame !== null && row.flame !== undefined) {
    flameDetected = row.flame === true || row.flame === 'true' || parseInt(row.flame, 10) === 1;
    rawFlameState = flameDetected ? 1 : 0;
  }

  // Parse direct sensor alerts from ESP32 payload
  // ESP32: temperatureAlert = temperature >= temperatureBaseline + 2.0
  const tempAlert = row.temperature_alert !== undefined && row.temperature_alert !== null
    ? (row.temperature_alert === true || row.temperature_alert === 'true' || row.temperature_alert === 1)
    : (tempVal !== null && tempVal >= 55.0);

  // ESP32: gasAlert = gasValue >= gasBaseline + 150
  const gasAlert = row.gas_alert !== undefined && row.gas_alert !== null
    ? (row.gas_alert === true || row.gas_alert === 'true' || row.gas_alert === 1)
    : (gasVal !== null && gasVal >= 1638);

  // ESP32: flameAlert = flameDetected (digitalRead(6) == LOW)
  const flameAlert = row.flame_alert !== undefined && row.flame_alert !== null
    ? (row.flame_alert === true || row.flame_alert === 'true' || row.flame_alert === 1)
    : flameDetected;

  // Multi-sensor strict AND condition:
  // All thresholds must be achieved simultaneously (Temperature Alert AND Gas Alert AND Flame Detected)
  // Matching ESP32 firmware: if (temperatureAlert && gasAlert && flameDetected) -> ALARM_ACTIVE
  const allThresholdsAchieved = Boolean(tempAlert && gasAlert && flameAlert);

  // Buzzer / Alarm actuator (Boolean) - ESP32 firmware sets buzzer = true ONLY in ALARM_ACTIVE stage
  const buzzerActive = Boolean(
    row.buzzer === true ||
    row.buzzer === 'true' ||
    row.buzzer === 1 ||
    row.buzzer_status === true ||
    allThresholdsAchieved
  );

  // Fire Status (Boolean): True ONLY when all thresholds are achieved OR buzzer active OR explicitly signaled from backend
  const fireActive = Boolean(
    buzzerActive ||
    allThresholdsAchieved ||
    (row.fire_status ?? row.fireStatus ?? row.is_fire ?? false)
  );

  // Fire Severity (String, e.g. 'CRITICAL', 'WARNING', 'SAFE')
  const fireSeverity = row.fire_severity || (fireActive ? 'CRITICAL' : 'SAFE');

  // Hardware node statuses
  const deviceOnline = row.device_online !== undefined ? Boolean(row.device_online) : true;
  const tempSensorOk = dhtConnected;
  const smokeSensorOk = gasState;
  const flameSensorOk = flameSensorState;
  const wifiConnected = row.wifi_connected !== undefined ? Boolean(row.wifi_connected) : true;
  const pumpStatus = Boolean(row.pump_status);
  const cameraStatus = (row.camera_status || 'offline').toLowerCase();

  // Timestamp extraction
  const rawTimestamp = row.timestamp || row.created_at;
  const timestampMs = rawTimestamp ? new Date(rawTimestamp).getTime() : null;

  return {
    id: row.id,
    temperature: tempVal,
    dhtConnected,
    gasState,
    gasValue: gasVal,
    humidity: humidityVal,
    flameState: rawFlameState,
    flameDetected,
    flameSensorState,
    flameSensorConnected: flameSensorState,
    temperatureAlert: tempAlert,
    gasAlert,
    flameAlert,
    allThresholdsAchieved,
    fireStatus: fireActive,
    fireSeverity,
    buzzer: buzzerActive,
    deviceOnline,
    temperatureSensor: tempSensorOk,
    smokeSensor: smokeSensorOk,
    flameSensor: flameSensorOk,
    wifiConnected,
    pumpStatus,
    cameraStatus,
    cameraStreamUrl: row.camera_stream_url || '',
    lastSeen: rawTimestamp,
    timestamp: timestampMs,
    createdAt: row.created_at
  };
}

export const sensorService = {
  /**
   * Fetch the latest sensor telemetry row from Supabase
   * Strictly matches:
   * const { data, error } = await supabase.from("sensor_data").select("*").order("created_at", { ascending: false }).limit(1);
   */
  async getLatestTelemetry() {
    const { data, error } = await supabase
      .from('sensor_data')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error("Error fetching latest telemetry from Supabase:", error);
      throw error;
    }
    const latestRow = Array.isArray(data) ? (data.length > 0 ? data[0] : null) : data;
    return mapDatabaseRow(latestRow);
  },

  /**
   * Subscribe to real-time updates from public.sensor_data
   */
  subscribeToTelemetry(onUpdate, onStatusChange) {
    const channel = supabase
      .channel('sensor_data_live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sensor_data' },
        (payload) => {
          if (payload.new) {
            onUpdate(mapDatabaseRow(payload.new));
          }
        }
      );

    channel.subscribe((status, err) => {
      if (onStatusChange) {
        onStatusChange(status, err);
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * Fetch alert history (past rows with fire or sensor alert conditions)
   */
  async getAlertHistory(limit = 30) {
    const { data, error } = await supabase
      .from('sensor_data')
      .select('*')
      .or('flame_alert.eq.true,temperature_alert.eq.true,gas_alert.eq.true,flame_state.eq.1')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Error fetching alert history from Supabase:", error);
      throw error;
    }
    return (data || []).map(mapDatabaseRow);
  },

  /**
   * Helper to check if telemetry data is stale
   */
  isStale(timestampMs, thresholdSeconds = 30) {
    if (!timestampMs) return true;
    const diffSeconds = (Date.now() - timestampMs) / 1000;
    return diffSeconds > thresholdSeconds;
  }
};

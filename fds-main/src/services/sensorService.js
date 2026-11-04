import { supabase } from '../lib/supabase';

// Maps PostgreSQL snake_case rows to JS camelCase properties
export function mapDatabaseRow(row) {
  if (!row) return null;

  // Safe extraction of telemetry values, supporting both snake_case, camelCase, and fallbacks
  const tempVal = row.temperature !== null && row.temperature !== undefined ? parseFloat(row.temperature) : 24.5;
  const gasVal = row.gas_value !== null && row.gas_value !== undefined ? parseFloat(row.gas_value) : (row.gas !== null && row.gas !== undefined ? parseFloat(row.gas) : 12.1);
  const smokeVal = row.smoke !== null && row.smoke !== undefined ? parseFloat(row.smoke) : gasVal;
  
  // flame check: support boolean (like row.flame = false/true), or number (like row.flame_state)
  let flameActive = false;
  if (row.flame !== null && row.flame !== undefined) {
    flameActive = row.flame === true || row.flame === 'true' || parseInt(row.flame) === 1;
  } else if (row.flame_state !== null && row.flame_state !== undefined) {
    flameActive = parseInt(row.flame_state) === 0; // standard low-active flame sensor
  }

  const fireActive = row.fire_status ?? row.fireStatus ?? (row.status ? (row.status.toLowerCase().includes('fire') || row.status.toLowerCase().includes('alert') || row.status.toLowerCase().includes('active')) : false);
  const buzzerActive = row.buzzer ?? row.buzzer_status ?? row.buzzerStatus ?? (row.status ? (row.status.toLowerCase().includes('alert') || row.status.toLowerCase().includes('active')) : false);
  const camStatus = row.camera_status ?? row.cameraStatus ?? 'offline';
  const camStreamUrl = row.camera_stream_url ?? row.cameraStreamUrl ?? '';
  const lastSeenVal = row.last_seen ?? row.lastSeen ?? row.timestamp ?? row.created_at;

  return {
    temperature: tempVal,
    gasValue: smokeVal,
    flameState: flameActive ? 0 : 1,
    fireStatus: fireActive,
    fireSeverity: row.fire_severity || 'CRITICAL',
    buzzer: buzzerActive,
    humidity: row.humidity !== null && row.humidity !== undefined ? parseFloat(row.humidity) : 50.0,
    deviceOnline: row.device_online ?? true,
    temperatureSensor: row.temperature_sensor ?? true,
    smokeSensor: row.smoke_sensor ?? true,
    flameSensor: row.flame_sensor ?? true,
    wifiConnected: row.wifi_connected ?? true,
    pumpStatus: row.pump_status ?? true,
    cameraStatus: camStatus,
    cameraStreamUrl: camStreamUrl,
    lastSeen: lastSeenVal,
    timestamp: row.timestamp ? new Date(row.timestamp).getTime() : (row.created_at ? new Date(row.created_at).getTime() : Date.now())
  };
}

export const sensorService = {
  // Fetch the latest sensor telemetry
  async getLatestTelemetry() {
    const { data, error } = await supabase
      .from('sensor_data')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Error fetching latest telemetry from Supabase:", error);
      throw error;
    }
    return mapDatabaseRow(data);
  },

  // Subscribe to real-time updates from public.sensor_data
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

    channel.subscribe((status) => {
      if (onStatusChange) {
        onStatusChange(status);
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  },

  // Fetch alert history (past rows with fireStatus = true)
  async getAlertHistory() {
    const { data, error } = await supabase
      .from('sensor_data')
      .select('*')
      .eq('fire_status', true)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      console.error("Error fetching alert history from Supabase:", error);
      throw error;
    }
    return (data || []).map(mapDatabaseRow);
  }
};

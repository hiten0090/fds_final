const { createClient } = require('@supabase/supabase-js');
const config = require('../config/env.config');
const logger = require('../utils/logger');
const wsService = require('./websocket.service');
const cameraService = require('./camera.service');
const smsService = require('./sms.service');

class SupabaseService {
  constructor() {
    this.client = null;
    this.currentFireStatus = false;
    this.realtimeChannel = null;
    this.isInitialized = false;

    // Backend database cache for real hardware sensor_data
    this.sensorDataTable = [];
    this.nextRowId = 1;
  }

  /**
   * Inserts a sensor reading row into the backend sensor_data table
   * Also attempts write to Supabase if connected
   */
  insertSensorDataRow(row = {}) {
    const isGasConnected = row.gas_state !== undefined 
      ? Boolean(row.gas_state) 
      : (row.gas_value !== null && row.gas_value !== undefined && row.gas_value !== -1);
    const isFlameConnected = row.flame_sensor_state !== undefined 
      ? Boolean(row.flame_sensor_state) 
      : true;

    const fullRow = {
      id: this.nextRowId++,
      created_at: row.created_at || new Date().toISOString(),
      temperature: row.temperature !== undefined && row.temperature !== null ? parseFloat(row.temperature) : null,
      gas_state: isGasConnected,
      gas_value: isGasConnected && row.gas_value !== undefined && row.gas_value !== null ? parseInt(row.gas_value, 10) : null,
      flame_sensor_state: isFlameConnected,
      flame_state: row.flame_state !== undefined && row.flame_state !== null ? parseInt(row.flame_state, 10) : (row.flame ? 1 : 0),
      temperature_alert: Boolean(row.temperature_alert ?? false),
      gas_alert: Boolean(row.gas_alert ?? false),
      flame_alert: Boolean(row.flame_alert ?? (row.flame_state === 1)),
      fire_status: Boolean(row.fire_status ?? row.is_fire ?? false),
      fire_severity: row.fire_severity || (row.fire_status || row.is_fire ? 'CRITICAL' : 'SAFE'),
      buzzer: Boolean(row.buzzer ?? false),
      humidity: row.humidity !== undefined && row.humidity !== null ? parseInt(row.humidity, 10) : null,
      device_online: row.device_online !== undefined ? Boolean(row.device_online) : true,
      temperature_sensor: row.temperature !== null && row.temperature !== undefined,
      smoke_sensor: isGasConnected,
      flame_sensor: isFlameConnected,
      wifi_connected: row.wifi_connected !== undefined ? Boolean(row.wifi_connected) : true,
      pump_status: Boolean(row.pump_status ?? false),
      camera_status: row.camera_status || 'offline',
      timestamp: row.timestamp || new Date().toISOString()
    };

    // Keep last 250 rows in backend table
    this.sensorDataTable.push(fullRow);
    if (this.sensorDataTable.length > 250) {
      this.sensorDataTable.shift();
    }

    // Write to Supabase table if client is connected
    if (this.client && this.isInitialized) {
      // Map to exact Supabase schema:
      // temperature, gas_state, gas_value, flame_state, temperature_alert, gas_alert, flame_alert, buzzer, humidity
      // flame_state = 0 -> Flame is NOT detected (SAFE)
      // flame_state = 1 -> Flame IS detected (FIRE ALERT)
      // Multi-sensor strict AND condition: All thresholds must be achieved simultaneously
      const allThresholdsAchieved = (
        fullRow.flame_state === 1 &&
        fullRow.temperature_alert &&
        fullRow.gas_alert
      );

      const isFire = Boolean(
        fullRow.fire_status ||
        fullRow.is_fire ||
        allThresholdsAchieved
      );

      const supabasePayload = {
        temperature: fullRow.temperature,
        gas_state: fullRow.gas_state,
        gas_value: fullRow.gas_value,
        flame_sensor_state: fullRow.flame_sensor_state,
        flame_state: fullRow.flame_state,
        temperature_alert: fullRow.temperature_alert,
        gas_alert: fullRow.gas_alert,
        flame_alert: fullRow.flame_alert,
        buzzer: Boolean(fullRow.buzzer || isFire)
      };

      this.client
        .from('sensor_data')
        .insert([supabasePayload])
        .then(({ data, error }) => {
          if (error) {
            logger.warn('SUPABASE', `Supabase insert failed: ${error.message}`);
          } else {
            logger.info('SUPABASE', `✔ Real hardware reading successfully recorded in Supabase [sensor_data]!`);
          }
        })
        .catch((e) => {
          logger.warn('SUPABASE', `Supabase insert exception: ${e.message}`);
        });
    }

    return fullRow;
  }

  /**
   * Returns current backend sensor_data table rows
   */
  getSensorDataTable(limit = 50) {
    return [...this.sensorDataTable].reverse().slice(0, limit);
  }

  /**
   * Initialize Supabase client and setup Realtime subscription
   */
  async init() {
    if (!config.supabase.url || !config.supabase.key) {
      logger.supabase('Supabase configuration missing (URL or Key). Realtime listener not started.', null, true);
      return false;
    }

    try {
      this.client = createClient(config.supabase.url, config.supabase.key, {
        auth: { persistSession: false }
      });

      logger.supabase('Supabase client initialized successfully');
      this.isInitialized = true;

      // Fetch initial fire status on startup
      await this.syncInitialStatus();

      // Subscribe to Realtime changes on sensor_data table
      this.setupRealtimeSubscription();

      return true;
    } catch (err) {
      logger.supabase(`Failed to initialize Supabase client: ${err.message}`, err, true);
      return false;
    }
  }

  /**
   * Fetch the most recent sensor reading from Supabase, with automatic backend table fallback
   * Matches query:
   * const { data, error } = await supabase.from("sensor_data").select("*").order("created_at", { ascending: false }).limit(1);
   */
  async getLatestSensorData() {
    if (this.client && this.isInitialized) {
      try {
        const { data, error } = await this.client
          .from('sensor_data')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1);

        if (data && !error && data.length > 0) {
          return data[0];
        }
      } catch (err) {
        // Supabase network / pause error fallback
      }
    }

    // Return the latest record from the backend sensor_data table
    if (this.sensorDataTable.length > 0) {
      return this.sensorDataTable[this.sensorDataTable.length - 1];
    }

    return null;
  }

  /**
   * Sync initial status on backend server start
   */
  async syncInitialStatus() {
    try {
      const latestData = await this.getLatestSensorData();
      if (latestData) {
        this.currentFireStatus = Boolean(latestData.is_fire);
        logger.supabase(`Initial fire status loaded from Supabase: is_fire = ${this.currentFireStatus}`);

        if (this.currentFireStatus) {
          logger.supabase('Active fire status detected on startup! Auto-starting camera stream relay...');
          wsService.notifyFireStarted(latestData);
          cameraService.startStream();
        }
      }
    } catch (err) {
      logger.supabase(`Failed to sync initial fire status: ${err.message}`, err, true);
    }
  }

  /**
   * Setup Supabase Realtime channel subscription
   */
  setupRealtimeSubscription() {
    if (!this.client) return;

    logger.supabase('Subscribing to Supabase Realtime changes on table [sensor_data]...');

    this.realtimeChannel = this.client
      .channel('sensor_data_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sensor_data' },
        (payload) => {
          logger.supabase('Realtime event received from Supabase:', payload.eventType);
          this.handleSensorDataChange(payload.new);
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          logger.supabase('Successfully subscribed to Supabase Realtime [sensor_data]');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          logger.supabase(`Supabase Realtime subscription status: ${status}`, err, true);
        }
      });
  }

  /**
   * Process sensor_data update/insert payload
   */
  handleSensorDataChange(sensorData) {
    if (!sensorData) return;

    // Automatically record row into backend sensor_data table
    const storedRow = this.insertSensorDataRow(sensorData);

    // ESP32 ALARM_ACTIVE condition: temperatureAlert && gasAlert && flameDetected
    const allThresholdsAchieved = Boolean(
      sensorData.buzzer === true ||
      (
        sensorData.temperature_alert === true &&
        sensorData.gas_alert === true &&
        (sensorData.flame_alert === true || sensorData.flame_state === 1)
      )
    );

    const newFireStatus = Boolean(
      sensorData.buzzer ||
      allThresholdsAchieved ||
      sensorData.camera_required ||
      sensorData.is_fire ||
      sensorData.fire_status ||
      sensorData.fireStatus
    );
    logger.supabase(`Sensor update received. is_fire: ${newFireStatus} (Previous: ${this.currentFireStatus})`);

    // State transition logic
    if (newFireStatus && !this.currentFireStatus) {
      // Fire Started: false -> true
      this.currentFireStatus = true;
      logger.supabase('ALERT: Fire Status changed to TRUE!');

      // Notify clients over WebSocket
      wsService.notifyFireStarted(sensorData);

      // Start camera stream relay automatically
      cameraService.startStream();

      // Dispatch SMS Emergency Alert (Mock or Live)
      try {
        smsService.sendFireEmergencyAlert(sensorData);
      } catch (smsErr) {
        logger.error('SUPABASE', 'Failed to dispatch emergency SMS:', smsErr);
      }
    } else if (!newFireStatus && this.currentFireStatus) {
      // Fire Stopped: true -> false
      this.currentFireStatus = false;
      logger.supabase('INFO: Fire Status changed to FALSE.');

      // Notify clients over WebSocket
      wsService.notifyFireStopped(sensorData);

      // Stop camera stream relay automatically
      cameraService.stopStream('camera_required became false');
    } else if (newFireStatus) {
      // Continuous fire update broadcast
      wsService.notifyFireStarted(sensorData);
    }
  }

  getFireStatus() {
    return {
      fire_status: this.currentFireStatus,
      supabaseConnected: this.isInitialized
    };
  }
}

module.exports = new SupabaseService();

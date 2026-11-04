const { createClient } = require('@supabase/supabase-js');
const config = require('../config/env.config');
const logger = require('../utils/logger');
const wsService = require('./websocket.service');
const cameraService = require('./camera.service');

class SupabaseService {
  constructor() {
    this.client = null;
    this.currentFireStatus = false;
    this.realtimeChannel = null;
    this.isInitialized = false;
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
   * Fetch the most recent sensor reading from Supabase
   */
  async getLatestSensorData() {
    if (!this.client) {
      throw new Error('Supabase client is not initialized');
    }

    const { data, error } = await this.client
      .from('sensor_data')
      .select('*')
      .order('id', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // If table empty or error
      if (error.code === 'PGRST116') {
        return null;
      }
      logger.supabase(`Error querying latest sensor data: ${error.message}`, error, true);
      throw error;
    }

    return data;
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

    const newFireStatus = Boolean(sensorData.camera_required);
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

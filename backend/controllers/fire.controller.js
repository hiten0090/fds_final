const supabaseService = require('../services/supabase.service');
const wsService = require('../services/websocket.service');
const logger = require('../utils/logger');

/**
 * GET /fire/status
 * Get current fire status state and latest sensor measurements from Supabase
 */
async function getFireStatus(req, res, next) {
  try {
    const statusState = supabaseService.getFireStatus();
    let latestReading = null;

    try {
      latestReading = await supabaseService.getLatestSensorData();
    } catch (err) {
      // Supabase query error fallback
    }

    res.status(200).json({
      success: true,
      data: {
        fire_status: statusState.fire_status,
        supabaseConnected: statusState.supabaseConnected,
        latestSensorData: latestReading,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /fire/table
 * Return sensor_data records from the backend database table
 */
async function getSensorDataTable(req, res, next) {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const rows = supabaseService.getSensorDataTable(limit);
    res.status(200).json({
      success: true,
      tableName: 'sensor_data',
      count: rows.length,
      data: rows
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /fire/sensor-data
 * Ingest live telemetry directly from ESP32 hardware
 */
async function receiveHardwareSensorData(req, res, next) {
  try {
    const payload = req.body || {};
    logger.info(
      'HARDWARE',
      `ESP32 reading: Temp=${payload.temperature}°C, Gas=${payload.gas_value}, Flame=${payload.flame_state}`
    );

    // Insert into backend table & write to Supabase
    const savedRow = supabaseService.insertSensorDataRow(payload);

    // Process fire alert state changes
    supabaseService.handleSensorDataChange(payload);

    // Broadcast live telemetry via WebSocket to all connected dashboard clients
    wsService.broadcast({
      type: 'TELEMETRY',
      data: savedRow
    });

    res.status(200).json({
      success: true,
      message: 'ESP32 telemetry ingested successfully',
      id: savedRow.id
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getFireStatus,
  getSensorDataTable,
  receiveHardwareSensorData
};

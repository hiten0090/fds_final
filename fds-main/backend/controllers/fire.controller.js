const supabaseService = require('../services/supabase.service');

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

module.exports = {
  getFireStatus
};

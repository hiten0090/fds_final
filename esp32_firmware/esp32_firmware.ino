#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <ArduinoJson.h>

// =============================================================================
//  PROJECT: FireGuard Pro - IoT Fire Safety System
//  BOARD:   ESP32-S3 (N16R8)
//  DATABASE: Supabase Cloud Database (Table: sensor_data)
// =============================================================================

// =============================================================================
// 1. WIFI NETWORK CONFIGURATION
// =============================================================================
const char* WIFI_SSID     = "HITEN";
const char* WIFI_PASSWORD = "123456789";

// =============================================================================
// 2. SUPABASE REST API CONFIGURATION
// =============================================================================
const char* SUPABASE_URL = "https://zylrxdvbrzgjejfsqryi.supabase.co/rest/v1/sensor_data";

const char* SUPABASE_ANON_KEY = 
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
  "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5bHJ4ZHZicnpnamVqZnNxcnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MTUyMzMsImV4cCI6MjEwMDM5MTIzM30."
  "nxT6DWWQDPBUIU59QY27rrLvveD1-ZoACjLMcx0tWe4";

// =============================================================================
// 3. HARDWARE PIN DEFINITIONS (ESP32-S3)
// =============================================================================
#define DHT_PIN      4     // DHT22 Digital Data Pin (GPIO 4)
#define MQ2_PIN      5     // MQ-2 Gas/Smoke Sensor Analog Pin AO (GPIO 5)
#define FLAME_PIN    6     // Optical Flame Sensor Digital Pin DO (GPIO 6 - Active LOW)
#define BUZZER_PIN   7     // Emergency Siren Buzzer Relay Pin (GPIO 7)

#define DHT_TYPE     DHT22
DHT dht(DHT_PIN, DHT_TYPE);

// Set BUZZER_ACTIVE to HIGH for typical active-high buzzers / relays
// Set to LOW if using an active-low relay module
#define BUZZER_ACTIVE HIGH

// =============================================================================
// 4. TIMING & SAFETY THRESHOLDS
// =============================================================================
const unsigned long PACKET_INTERVAL      = 1000;   // Upload telemetry every 1.0 second
const unsigned long DHT_READ_INTERVAL    = 2000;   // DHT22 hardware read rate limit (2 sec)
const unsigned long WIFI_CHECK_INTERVAL  = 8000;   // Reconnect attempt interval
const unsigned long CALIBRATION_DURATION = 15000;  // 15 seconds warm-up / baseline acquisition

// Dynamic safety thresholds above steady-state baseline
const float TEMP_SPIKE_THRESHOLD = 2.0;    // Baseline + 2.0 °C indicates rapid heat rise
const int   GAS_SPIKE_THRESHOLD  = 150;    // Baseline + 150 ADC indicates smoke accumulation
const int   MQ2_MIN_VALID_SIGNAL = 35;     // Disconnection check threshold for MQ-2

// =============================================================================
// 5. GLOBAL TELEMETRY VARIABLES
// =============================================================================
float temperature = NAN;
float humidity    = NAN;
float tempBaseline = 25.0;

int   gasValue    = -1;
int   gasBaseline = 350;

bool dhtConnected = false;
bool gasConnected = false;

// Flame Sensor is ALWAYS reported connected (per system spec)
const bool flameConnected = true;

// Detection Flags
bool flameDetected    = false; // true = Flame in line of sight (GPIO 6 is LOW)
bool temperatureAlert = false; // true = Heat threshold exceeded
bool gasAlert         = false; // true = Smoke/gas threshold exceeded
bool flameAlert       = false; // true = Flame detected
bool buzzerState      = false; // true = Full Multi-Sensor Fire Emergency triggered

bool baselineReady    = false;

// Timers & Accumulators
unsigned long lastPacketTime = 0;
unsigned long lastDHTTime    = 0;
unsigned long lastWiFiCheck  = 0;
unsigned long bootTime       = 0;

float calibTempSum = 0;
int   calibTempCount = 0;
long  calibGasSum = 0;
int   calibGasCount = 0;

// =============================================================================
// 6. NON-BLOCKING WIFI MANAGER
// =============================================================================
void manageWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWiFiCheck < WIFI_CHECK_INTERVAL) return;
  lastWiFiCheck = now;

  Serial.println(F("[WIFI] Connecting to network..."));
  WiFi.disconnect();
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// =============================================================================
// 7. SENSOR SAMPLING
// =============================================================================

// Read DHT22 Temperature & Humidity
void sampleDHT() {
  unsigned long now = millis();
  if (now - lastDHTTime < DHT_READ_INTERVAL) return;
  lastDHTTime = now;

  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if (!isnan(t) && t >= -40.0 && t <= 85.0) {
    temperature = t;
    humidity = isnan(h) ? 50.0 : h;
    dhtConnected = true;
  } else {
    temperature = NAN;
    humidity = NAN;
    dhtConnected = false;
  }
}

// Read MQ-2 Smoke/Combustible Gas Sensor (Oversampled 5x for ADC noise reduction)
void sampleMQ2() {
  long sum = 0;
  for (int i = 0; i < 5; i++) {
    sum += analogRead(MQ2_PIN);
    delayMicroseconds(300);
  }
  int avg = sum / 5;

  if (avg > MQ2_MIN_VALID_SIGNAL && avg < 4090) {
    gasValue = avg;
    gasConnected = true;
  } else {
    gasValue = -1;
    gasConnected = false;
  }
}

// Read Optical Flame Sensor
// Flame sensor module digital pin (DO) pulls LOW when fire/IR is detected.
// High when normal/safe.
void sampleFlameSensor() {
  int pinState = digitalRead(FLAME_PIN);
  flameDetected = (pinState == LOW);
}

// Baseline Calibration Handler
void processBaseline() {
  unsigned long now = millis();
  if (!baselineReady) {
    if (now - bootTime < CALIBRATION_DURATION) {
      if (dhtConnected && !isnan(temperature)) {
        calibTempSum += temperature;
        calibTempCount++;
      }
      if (gasConnected && gasValue > 0) {
        calibGasSum += gasValue;
        calibGasCount++;
      }
    } else {
      if (calibTempCount > 0) tempBaseline = calibTempSum / calibTempCount;
      if (calibGasCount > 0)  gasBaseline  = calibGasSum / calibGasCount;
      baselineReady = true;

      Serial.println(F("\n>>> SENSOR CALIBRATION COMPLETE <<<"));
      Serial.printf("    Temperature Baseline: %.1f °C (Alert Limit: >= %.1f °C)\n", 
                    tempBaseline, tempBaseline + TEMP_SPIKE_THRESHOLD);
      Serial.printf("    Smoke/Gas Baseline  : %d ADC  (Alert Limit: >= %d ADC)\n\n", 
                    gasBaseline, gasBaseline + GAS_SPIKE_THRESHOLD);
    }
  }
}

// =============================================================================
// 8. MULTI-SENSOR FIRE DETECTION & ALARM CONTROLLER
// =============================================================================
void evaluateFireSafety() {
  // 1. Temperature Alert Assessment
  if (dhtConnected && !isnan(temperature)) {
    float threshold = baselineReady ? (tempBaseline + TEMP_SPIKE_THRESHOLD) : 55.0;
    temperatureAlert = (temperature >= threshold);
  } else {
    temperatureAlert = false;
  }

  // 2. Gas / Smoke Alert Assessment
  if (gasConnected && gasValue > 0) {
    int threshold = baselineReady ? (gasBaseline + GAS_SPIKE_THRESHOLD) : 1600;
    gasAlert = (gasValue >= threshold);
  } else {
    gasAlert = false;
  }

  // 3. Flame Alert Assessment (Instant Optical IR response)
  flameAlert = flameDetected;

  // 4. Multi-Condition Alarm Verification:
  // All three hazard conditions present simultaneously:
  // (Temperature Elevated AND Gas/Smoke Elevated AND Flame Optical Detected)
  if (temperatureAlert && gasAlert && flameAlert) {
    buzzerState = true;
  } else {
    buzzerState = false;
  }

  // Drive Hardware Buzzer Relay
  if (buzzerState) {
    digitalWrite(BUZZER_PIN, BUZZER_ACTIVE);
  } else {
    digitalWrite(BUZZER_PIN, (BUZZER_ACTIVE == HIGH) ? LOW : HIGH);
  }
}

// =============================================================================
// 9. SUPABASE JSON PACKET BUILDER
// Strictly aligns with Supabase table: 'sensor_data' schema
// =============================================================================
String buildSupabaseJSON() {
  #if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument doc;
  #else
    StaticJsonDocument<512> doc;
  #endif

  // Column 1: temperature (numeric / null)
  if (dhtConnected && !isnan(temperature)) {
    doc["temperature"] = serialized(String(temperature, 1));
  } else {
    doc["temperature"] = nullptr;
  }

  // Column 2: humidity (numeric / null)
  if (dhtConnected && !isnan(humidity)) {
    doc["humidity"] = serialized(String(humidity, 1));
  } else {
    doc["humidity"] = nullptr;
  }

  // Column 3: gas_value (int4 / null)
  if (gasConnected && gasValue >= 0) {
    doc["gas_value"] = gasValue;
  } else {
    doc["gas_value"] = nullptr;
  }

  // Column 4: flame_state (int4: 1 = FLAME DETECTED / CRITICAL, 0 = SAFE / CLEAR)
  doc["flame_state"] = flameDetected ? 1 : 0;

  // Column 5: temperature_alert (bool)
  doc["temperature_alert"] = temperatureAlert;

  // Column 6: gas_alert (bool)
  doc["gas_alert"] = gasAlert;

  // Column 7: flame_alert (bool)
  doc["flame_alert"] = flameAlert;

  // Column 8: buzzer (bool)
  doc["buzzer"] = buzzerState;

  // Column 9: gas_state (bool)
  doc["gas_state"] = gasConnected;

  String jsonString;
  serializeJson(doc, jsonString);
  return jsonString;
}

// =============================================================================
// 10. SUPABASE CLOUD HTTP POST TRANSMITTER
// =============================================================================
void postToSupabase(const String& payload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[SUPABASE] Offline: WiFi not connected."));
    return;
  }

  WiFiClientSecure secureClient;
  secureClient.setInsecure(); // Essential for fast ESP32 HTTPS handshake

  HTTPClient http;
  http.setTimeout(2500);

  if (!http.begin(secureClient, SUPABASE_URL)) {
    Serial.println(F("[SUPABASE] Connection initialization failed."));
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Prefer", "return=minimal");

  int statusCode = http.POST(payload);

  if (statusCode >= 200 && statusCode < 300) {
    Serial.printf("[SUPABASE] Uplink OK (HTTP %d)\n", statusCode);
  } else {
    Serial.printf("[SUPABASE] Uplink ERROR (HTTP %d): %s\n", statusCode, http.errorToString(statusCode).c_str());
  }

  http.end();
}

// =============================================================================
// 11. ARDUINO SETUP
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(1200);

  Serial.println(F("\n======================================================="));
  Serial.println(F("    FIREGUARD PRO: ESP32-S3 EMBEDDED TELEMETRY NODE    "));
  Serial.println(F("======================================================="));

  // Configure Hardware Pins
  pinMode(MQ2_PIN, INPUT);
  pinMode(FLAME_PIN, INPUT_PULLUP); // Active-Low Flame DO Pin
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, (BUZZER_ACTIVE == HIGH) ? LOW : HIGH); // Siren initial OFF

  analogReadResolution(12); // ESP32 12-bit ADC (0 - 4095)
  dht.begin();

  bootTime = millis();
  manageWiFi();
  lastPacketTime = millis() - PACKET_INTERVAL;
}

// =============================================================================
// 12. ARDUINO MAIN LOOP
// =============================================================================
void loop() {
  manageWiFi();

  sampleDHT();
  sampleMQ2();
  sampleFlameSensor();

  processBaseline();
  evaluateFireSafety();

  unsigned long currentMillis = millis();
  if (currentMillis - lastPacketTime >= PACKET_INTERVAL) {
    lastPacketTime = currentMillis;

    String jsonPayload = buildSupabaseJSON();

    // Serial Monitor Real-Time Diagnostics
    Serial.println(F("-------------------------------------------------------"));
    Serial.printf("Flame Sensor  : %s (flame_state: %d)\n", 
                  flameDetected ? "🔥 CRITICAL (FLAME DETECTED!)" : "🛡️ CLEAR / SAFE", 
                  flameDetected ? 1 : 0);
    Serial.printf("MQ-2 Smoke/Gas: %d ADC (Alert: %s, Baseline: %d)\n", 
                  gasValue, gasAlert ? "ALERT" : "NORMAL", gasBaseline);
    Serial.printf("DHT22 Temp    : %.1f °C | Humidity: %.1f %% (Alert: %s)\n", 
                  temperature, humidity, temperatureAlert ? "ALERT" : "NORMAL");
    Serial.printf("Emergency Siren: %s\n", buzzerState ? "🚨 ACTIVATED (BUZZER ON)" : "OFF");
    Serial.printf("Payload: %s\n", jsonPayload.c_str());

    // Uplink to Supabase
    postToSupabase(jsonPayload);
  }

  delay(5); // Yield to FreeRTOS background scheduler & watchdog
}


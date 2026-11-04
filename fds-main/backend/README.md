# Production-Ready Node.js Backend for Smart Fire Detection Project

This is the production-ready Node.js backend for the **Smart Fire Detection System**. It integrates with an existing Supabase database, listens for real-time fire detection events from ESP32 hardware, relays live MJPEG video streams from the ESP32-CAM to frontend clients without exposing local IPs, and provides real-time WebSocket notifications and REST APIs.

---

## 📁 Directory & File Structure

```
backend/
├── package.json               # Backend dependencies and run scripts
├── .env                       # Local environment secrets and configuration
├── .env.example               # Template file for environment setup
├── server.js                  # Application entry point (Express & WebSocket initialization)
├── README.md                  # Comprehensive backend documentation
├── config/
│   └── env.config.js          # Environment variable validation & centralized configuration
├── utils/
│   └── logger.js              # Production logger for Camera, Supabase, Stream & API events
├── middleware/
│   ├── logger.middleware.js   # HTTP request logging middleware
│   └── error.middleware.js    # Centralized error handler and 404 middleware
├── camera/
│   └── streamRelay.js         # MJPEG stream relay engine & client multiplexer
├── websocket/
│   └── wsServer.js            # Native WebSocket server with client heartbeats
├── services/
│   ├── supabase.service.js    # Supabase Realtime channel listener for fire_status
│   ├── camera.service.js      # High-level camera stream management & connectivity check
│   └── websocket.service.js   # Event broadcasting service for status updates
├── controllers/
│   ├── health.controller.js   # Health check logic
│   ├── camera.controller.js   # Camera status, start, stop, and stream handlers
│   └── fire.controller.js     # Fire status query handler
└── routes/
    ├── index.js               # Main API route router
    ├── health.routes.js       # Routes for /health
    ├── camera.routes.js       # Routes for /camera/*
    └── fire.routes.js         # Routes for /fire/*
```

---

## 📄 Explanation of Every File

| File | Description |
| :--- | :--- |
| **`server.js`** | Primary server entry point. Configures Express app, CORS, body parsers, routes, error handling, creates HTTP server, attaches WebSocket server, and initializes Supabase Realtime listener. |
| **`config/env.config.js`** | Loads and validates `.env` variables (`PORT`, `SUPABASE_URL`, `SUPABASE_KEY`, `ESP32_CAM_URL`, etc.). |
| **`utils/logger.js`** | Structured logger with severity levels (`INFO`, `WARN`, `ERROR`, `DEBUG`) and category tags (`[CAMERA]`, `[SUPABASE]`, `[STREAM]`, `[API]`). |
| **`middleware/logger.middleware.js`** | Logs incoming HTTP requests, response status codes, and execution duration. |
| **`middleware/error.middleware.js`** | Catches unhandled errors, formats clean JSON responses, and maps network errors (`ECONNREFUSED`, `ETIMEDOUT`). |
| **`camera/streamRelay.js`** | Connects to ESP32-CAM's MJPEG endpoint via HTTP, parses multipart boundaries, and multiplexes video frames to active frontend clients without creating duplicate connections to ESP32-CAM. Implements auto-reconnect backoff. |
| **`websocket/wsServer.js`** | Manages WebSocket connections on path `/ws`, tracks client connections, and sends heartbeat ping/pongs. |
| **`services/supabase.service.js`** | Subscribes to Supabase Realtime updates on `public.sensor_data`. When `fire_status` becomes `true`, triggers fire alert WS events and starts stream. When `false`, stops stream relay. |
| **`services/camera.service.js`** | High-level interface to start/stop stream, stream piping, and connectivity ping checks. |
| **`services/websocket.service.js`** | Emits standardized WebSocket event messages (`Fire Started`, `Fire Stopped`, `Camera Connected`, `Camera Disconnected`, `Stream Started`, `Stream Stopped`). |
| **`controllers/health.controller.js`** | Implements system health check, uptime, memory, and service connectivity statuses. |
| **`controllers/camera.controller.js`** | Express handlers for `/camera/status`, `/camera/start`, `/camera/stop`, and `/camera/stream`. |
| **`controllers/fire.controller.js`** | Express handler for fetching current fire status and latest Supabase record. |
| **`routes/*.routes.js`** | Defines clean REST endpoints. |

---

## 📡 REST API Documentation

### 1. Health Check
* **Endpoint**: `GET /health` or `GET /api/health`
* **Response**:
```json
{
  "success": true,
  "service": "smart-fire-detection-backend",
  "status": "UP",
  "timestamp": "2026-07-28T08:18:52.000Z",
  "uptime": "42 seconds",
  "environment": "development",
  "system": {
    "memory": { "rssMB": 35, "heapUsedMB": 18 }
  },
  "services": {
    "supabase": "CONNECTED",
    "cameraRelay": "IDLE",
    "websocket": "ACTIVE",
    "connectedWebsocketClients": 1
  }
}
```

### 2. Camera Status
* **Endpoint**: `GET /camera/status` or `GET /api/camera/status`
* **Response**:
```json
{
  "success": true,
  "data": {
    "relayStatus": {
      "isConnected": false,
      "isStreaming": false,
      "activeClients": 0,
      "targetUrl": "http://192.168.1.100:81/stream",
      "boundary": "frame"
    },
    "cameraPing": {
      "online": true,
      "statusCode": 200,
      "url": "http://192.168.1.100:81/stream"
    }
  }
}
```

### 3. Start Camera Stream Relay
* **Endpoint**: `POST /camera/start` or `GET /api/camera/start`
* **Body** *(Optional)*:
```json
{
  "url": "http://192.168.1.100:81/stream"
}
```

### 4. Stop Camera Stream Relay
* **Endpoint**: `POST /camera/stop` or `GET /api/camera/stop`
* **Body** *(Optional)*:
```json
{
  "reason": "User clicked stop"
}
```

### 5. Live MJPEG Camera Stream
* **Endpoint**: `GET /camera/stream` or `GET /api/camera/stream`
* **Headers**: `Content-Type: multipart/x-mixed-replace; boundary=frame`
* **Usage**: Point any HTML `<img>` element directly to this URL:
```html
<img src="http://localhost:5000/camera/stream" alt="Live ESP32-CAM Stream" />
```

### 6. Fire Status
* **Endpoint**: `GET /fire/status` or `GET /api/fire/status`
* **Response**:
```json
{
  "success": true,
  "data": {
    "fire_status": true,
    "supabaseConnected": true,
    "latestSensorData": {
      "id": 12,
      "fire_status": true,
      "temperature": 45.2,
      "gas_value": 350,
      "flame_state": 1,
      "fire_severity": "CRITICAL"
    }
  }
}
```

---

## 🔌 How Connections Work

### 1. How Supabase Connects
* The backend connects to Supabase using `@supabase/supabase-js` with `SUPABASE_URL` and `SUPABASE_KEY`.
* It opens a PostgreSQL Realtime subscription to `public.sensor_data`.
* When ESP32 updates `sensor_data` with `fire_status = true`, Supabase pushes a realtime event to Node.js within milliseconds.

### 2. How ESP32 Hardware & ESP32-CAM Connect
* **ESP32 (Sensors)**: Reads MQ2 gas, DHT11 temp/humidity, Flame sensor. When fire is detected, ESP32 makes an HTTP POST / Supabase INSERT setting `fire_status = true`.
* **ESP32-CAM**: Runs a standard MJPEG web server on local IP (e.g. `http://192.168.1.100:81/stream`).
* **Backend Stream Relay**: When `fire_status = true` is received from Supabase, Node.js connects to ESP32-CAM's IP address, fetches the stream, and proxies/multiplexes the frames. The ESP32-CAM local IP is never exposed to public frontend clients.

### 3. How Frontend React Web Application Connects

#### A. WebSocket Connection (Notifications & State Changes)
Connect to `ws://localhost:5000/ws` (or `wss://your-backend.domain.com/ws` in production):

```javascript
const socket = new WebSocket('ws://localhost:5000/ws');

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'FIRE_STATUS':
      if (data.fire_status) {
        // 1. Show Emergency Popup
        // 2. Play Alarm Sound
        // 3. Show Live Camera Section
      } else {
        // Hide Emergency Popup & Camera Section
      }
      break;

    case 'CAMERA_STATUS':
      console.log('Camera state:', data.connected ? 'Online' : 'Offline');
      break;

    case 'STREAM_STATUS':
      console.log('Stream state:', data.streaming ? 'Streaming' : 'Stopped');
      break;
  }
};
```

#### B. Displaying Live Video Stream
Use standard HTML `<img>` tag pointing to Node.js backend `/camera/stream`:

```jsx
{isFireActive && (
  <div className="camera-container">
    <h3>Live Fire Alert Stream</h3>
    <img 
      src="http://localhost:5000/camera/stream" 
      alt="ESP32-CAM Live Stream" 
      style={{ width: '100%', maxHeight: '480px', borderRadius: '8px' }} 
    />
  </div>
)}
```

---

## 💻 How to Run Locally

### Prerequisites
* Node.js v18.x or higher
* npm v9.x or higher

### Steps

1. Navigate to the `backend` directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables in `.env`:
```env
PORT=5000
NODE_ENV=development
CORS_ORIGIN=*
SUPABASE_URL=https://zylrxdvbrzgjejfsqryi.supabase.co
SUPABASE_KEY=your_supabase_anon_or_service_role_key
ESP32_CAM_URL=http://192.168.137.20:81/stream
```

4. Run backend server:
* Development mode (with live reload):
```bash
npm run dev
```
* Production mode:
```bash
npm start
```

---

## 🚀 How to Deploy

### Option 1: Deploy on Render / Railway / Heroku
1. Push your repository to GitHub.
2. Create a new **Web Service** on Render or Railway.
3. Set **Root Directory** to `backend`.
4. Set **Build Command** to `npm install`.
5. Set **Start Command** to `npm start`.
6. Add Environment Variables (`SUPABASE_URL`, `SUPABASE_KEY`, `ESP32_CAM_URL`, `CORS_ORIGIN`).

### Option 2: Deploy on VPS (Ubuntu / Nginx / PM2)
1. SSH into VPS and clone repository.
2. Install Node.js and PM2:
```bash
npm install -g pm2
```
3. Navigate to `backend` and start application:
```bash
cd backend
npm install
pm2 start server.js --name "smart-fire-backend"
pm2 save
```
4. Configure Nginx Reverse Proxy with WebSocket upgrade header support:
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

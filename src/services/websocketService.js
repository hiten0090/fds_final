/**
 * WebSocket Client Service for Smart Fire Detection System.
 * Connects to the existing Node.js backend WebSocket server at /ws.
 * Handles reconnection with exponential backoff, validates message schemas,
 * and distributes events to registered listeners without memory leaks.
 */

class WebSocketService {
  constructor() {
    this.socket = null;
    this.status = 'DISCONNECTED'; // 'DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR'
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.baseDelayMs = 2000;
    this.maxDelayMs = 30000;
    this.reconnectTimeout = null;
    this.pingInterval = null;
    this.statusListeners = new Set();
    this.messageListeners = new Set();
    this.isExplicitlyClosed = false;
  }

  /**
   * Determine WebSocket URL based on frontend environment or default
   */
  getWsUrl() {
    const backendHttpUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
    try {
      const parsed = new URL(backendHttpUrl);
      const protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${parsed.host}/ws`;
    } catch (e) {
      // Fallback
      return 'ws://localhost:5000/ws';
    }
  }

  /**
   * Connect to backend WebSocket server
   */
  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isExplicitlyClosed = false;
    this._updateStatus('CONNECTING');

    const wsUrl = this.getWsUrl();

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.reconnectAttempts = 0;
        this._updateStatus('CONNECTED');
        this._startHeartbeat();
      };

      this.socket.onmessage = (event) => {
        this._handleMessage(event);
      };

      this.socket.onclose = (event) => {
        this._stopHeartbeat();
        this.socket = null;

        if (!this.isExplicitlyClosed) {
          this._updateStatus('DISCONNECTED');
          this._scheduleReconnect();
        } else {
          this._updateStatus('DISCONNECTED');
        }
      };

      this.socket.onerror = (err) => {
        console.warn('[WebSocketService] Connection error:', err);
        this._updateStatus('ERROR');
      };
    } catch (err) {
      console.warn('[WebSocketService] Failed to create WebSocket connection:', err);
      this._updateStatus('ERROR');
      this._scheduleReconnect();
    }
  }

  /**
   * Safely parse and validate incoming messages from backend
   */
  _handleMessage(event) {
    if (!event || !event.data) return;

    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (e) {
      console.warn('[WebSocketService] Non-JSON message received:', event.data);
      return;
    }

    if (!payload || typeof payload !== 'object' || !payload.type) {
      return;
    }

    // Ignore PONG heartbeat responses from bubbling
    if (payload.type === 'PONG') {
      return;
    }

    // Distribute validated message to all listeners
    this.messageListeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.error('[WebSocketService] Listener error handling message:', err);
      }
    });
  }

  /**
   * Client-side heartbeat ping to verify backend liveness
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.send(JSON.stringify({ type: 'PING' }));
        } catch (e) {
          // Handled on next cycle
        }
      }
    }, 25000);
  }

  _stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Exponential backoff reconnection scheduler with jitter
   */
  _scheduleReconnect() {
    if (this.isExplicitlyClosed) return;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[WebSocketService] Maximum reconnect attempts reached. Waiting for manual retry.');
      return;
    }

    const delay = Math.min(
      this.baseDelayMs * Math.pow(1.5, this.reconnectAttempts) + Math.random() * 500,
      this.maxDelayMs
    );

    this.reconnectAttempts++;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  /**
   * Manual reconnect trigger (resets attempt counter)
   */
  retryConnection() {
    this.reconnectAttempts = 0;
    this.connect();
  }

  /**
   * Disconnect and clean up
   */
  disconnect() {
    this.isExplicitlyClosed = true;
    this._stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this._updateStatus('DISCONNECTED');
  }

  _updateStatus(newStatus) {
    this.status = newStatus;
    this.statusListeners.forEach((listener) => {
      try {
        listener(newStatus);
      } catch (err) {
        console.error('[WebSocketService] Status listener error:', err);
      }
    });
  }

  /**
   * Subscribe to connection status changes ('CONNECTED', 'CONNECTING', 'DISCONNECTED', 'ERROR')
   */
  onStatusChange(callback) {
    this.statusListeners.add(callback);
    callback(this.status);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  /**
   * Subscribe to incoming backend WebSocket event messages
   */
  onMessage(callback) {
    this.messageListeners.add(callback);
    return () => {
      this.messageListeners.delete(callback);
    };
  }
}

export const websocketService = new WebSocketService();


/**
 * Webcam Service
 * Manages browser mediaDevices (laptop webcam) activation, streaming, and snapshot capture
 * Designed for automatic activation on confirmed fire alerts and manual monitoring
 */

class WebcamService {
  constructor() {
    this.stream = null;
    this.isActive = false;
    this.lastError = null;
    this.lastSnapshot = null;
    this.listeners = new Set();
    this.autoStartOnAlert = true;
  }

  /**
   * Request webcam stream from user's device
   */
  async startWebcam(constraints = {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: 'user'
    },
    audio: false
  }) {
    if (this.stream && this.isActive) {
      return this.stream;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.lastError = 'Browser does not support camera API (getUserMedia). Try Chrome, Edge, or Firefox.';
      this.isActive = false;
      this.notify();
      throw new Error(this.lastError);
    }

    try {
      this.lastError = null;
      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.stream = mediaStream;
      this.isActive = true;

      // Handle stream end (user revokes permission or unplugs camera)
      mediaStream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          this.stopWebcam();
        };
      });

      this.notify();
      return mediaStream;
    } catch (err) {
      let friendlyMsg = 'Unable to access laptop webcam.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        friendlyMsg = 'Camera permission denied. Please allow camera access in your browser address bar.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        friendlyMsg = 'No webcam detected on your laptop or device.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        friendlyMsg = 'Webcam is currently in use by another application (e.g. Zoom, Teams).';
      }
      this.lastError = friendlyMsg;
      this.isActive = false;
      this.notify();
      console.warn('[WebcamService] Failed to start webcam:', err);
      throw new Error(friendlyMsg);
    }
  }

  /**
   * Stop all active webcam tracks and release hardware
   */
  stopWebcam() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          // ignore cleanup error
        }
      });
      this.stream = null;
    }
    this.isActive = false;
    this.notify();
  }

  /**
   * Capture an emergency still image frame from a live <video> element
   */
  captureSnapshot(videoElement) {
    if (!videoElement || videoElement.readyState < 2) {
      return null;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoElement.videoWidth || 640;
      canvas.height = videoElement.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

      // Watermark with timestamp and FireGuard branding
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, canvas.height - 28, canvas.width, 28);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(
        `FIREGUARD INCIDENT SNAPSHOT • ${new Date().toISOString()}`,
        12,
        canvas.height - 10
      );

      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      this.lastSnapshot = dataUrl;
      this.notify();
      return dataUrl;
    } catch (err) {
      console.warn('[WebcamService] Snapshot error:', err);
      return null;
    }
  }

  /**
   * Subscribe to webcam state updates
   */
  subscribe(listener) {
    this.listeners.add(listener);
    // Emit initial state
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  getState() {
    return {
      stream: this.stream,
      isActive: this.isActive,
      error: this.lastError,
      snapshot: this.lastSnapshot,
      autoStartOnAlert: this.autoStartOnAlert
    };
  }

  notify() {
    const state = this.getState();
    this.listeners.forEach((fn) => fn(state));
  }
}

export const webcamService = new WebcamService();

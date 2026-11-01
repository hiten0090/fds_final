// src/services/AudioService.js - Web Audio API Industrial Siren Generator
// Includes user-gesture unlock support to adhere to modern browser autoplay policies.

class AudioService {
  constructor() {
    this.audioCtx = null;
    this.oscillator1 = null;
    this.oscillator2 = null;
    this.gainNode = null;
    this.isPlaying = false;
    this.sweepInterval = null;
    this.isUnlocked = false;
    this.stateListeners = new Set();

    // Auto-setup global interaction listeners to unlock AudioContext on first user interaction
    this._setupGlobalUnlockListeners();
  }

  _setupGlobalUnlockListeners() {
    if (typeof window === 'undefined') return;

    const unlockHandler = () => {
      this.unlockAudio();
    };

    window.addEventListener('click', unlockHandler, { passive: true });
    window.addEventListener('keydown', unlockHandler, { passive: true });
    window.addEventListener('touchstart', unlockHandler, { passive: true });
  }

  /**
   * Explicitly unlock / resume AudioContext upon user gesture
   */
  async unlockAudio() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;

      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass();
      }

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      if (this.audioCtx.state === 'running') {
        this.isUnlocked = true;
        this._notifyStateListeners();
        return true;
      }
    } catch (err) {
      console.warn('[AudioService] Could not unlock AudioContext:', err);
    }
    return false;
  }

  onStateChange(callback) {
    this.stateListeners.add(callback);
    callback(this.getAudioState());
    return () => {
      this.stateListeners.delete(callback);
    };
  }

  _notifyStateListeners() {
    const state = this.getAudioState();
    this.stateListeners.forEach((fn) => {
      try { fn(state); } catch (e) { /* ignore */ }
    });
  }

  getAudioState() {
    return {
      isPlaying: this.isPlaying,
      isUnlocked: this.isUnlocked || (this.audioCtx && this.audioCtx.state === 'running'),
      isSupported: Boolean(typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
    };
  }

  startSiren() {
    if (this.isPlaying) return;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        console.warn("[AudioService] Web Audio API is not supported in this browser.");
        return;
      }

      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass();
      }

      // If suspended by browser autoplay policy, attempt resume
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {
          console.warn("[AudioService] AudioContext is suspended. User interaction required to play alarm sound.");
        });
      }

      // Create nodes
      this.oscillator1 = this.audioCtx.createOscillator();
      this.oscillator2 = this.audioCtx.createOscillator();
      this.gainNode = this.audioCtx.createGain();

      // Industrial buzzer harmonic mix
      this.oscillator1.type = 'sawtooth';
      this.oscillator2.type = 'sine';

      this.oscillator1.frequency.setValueAtTime(600, this.audioCtx.currentTime);
      this.oscillator2.frequency.setValueAtTime(605, this.audioCtx.currentTime);

      // Safe, audible gain level
      this.gainNode.gain.setValueAtTime(0.18, this.audioCtx.currentTime);

      this.oscillator1.connect(this.gainNode);
      this.oscillator2.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);

      this.oscillator1.start();
      this.oscillator2.start();

      this.isPlaying = true;
      this._notifyStateListeners();

      // Pitch sweep modulation loop
      let goingUp = true;
      let currentFreq = 600;
      const minFreq = 500;
      const maxFreq = 950;
      const step = 35;

      this.sweepInterval = setInterval(() => {
        if (!this.audioCtx || this.audioCtx.state === 'suspended') return;

        if (goingUp) {
          currentFreq += step;
          if (currentFreq >= maxFreq) goingUp = false;
        } else {
          currentFreq -= step;
          if (currentFreq <= minFreq) goingUp = true;
        }

        const now = this.audioCtx.currentTime;
        try {
          this.oscillator1.frequency.exponentialRampToValueAtTime(currentFreq, now + 0.05);
          this.oscillator2.frequency.exponentialRampToValueAtTime(currentFreq + 5, now + 0.05);
        } catch (e) {
          // Ignore frequency ramp errors during fast unmount
        }
      }, 50);

    } catch (error) {
      console.error("[AudioService] Failed to start industrial siren audio:", error);
    }
  }

  stopSiren() {
    if (!this.isPlaying) return;

    try {
      if (this.sweepInterval) {
        clearInterval(this.sweepInterval);
        this.sweepInterval = null;
      }
      if (this.oscillator1) {
        try { this.oscillator1.stop(); } catch (e) { /* ignore */ }
        this.oscillator1.disconnect();
        this.oscillator1 = null;
      }
      if (this.oscillator2) {
        try { this.oscillator2.stop(); } catch (e) { /* ignore */ }
        this.oscillator2.disconnect();
        this.oscillator2 = null;
      }
      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = null;
      }
    } catch (error) {
      console.error("[AudioService] Error stopping siren audio:", error);
    }
    this.isPlaying = false;
    this._notifyStateListeners();
  }
}

export const audioService = new AudioService();

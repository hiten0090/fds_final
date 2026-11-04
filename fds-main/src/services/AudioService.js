// src/services/AudioService.js - Web Audio API Siren Generator

class AudioService {
  constructor() {
    this.audioCtx = null;
    this.oscillator1 = null;
    this.oscillator2 = null;
    this.gainNode = null;
    this.isPlaying = false;
    this.sweepInterval = null;
  }

  startSiren() {
    if (this.isPlaying) return;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        console.warn("Web Audio API is not supported in this browser.");
        return;
      }

      this.audioCtx = new AudioContextClass();

      // Create nodes
      this.oscillator1 = this.audioCtx.createOscillator();
      this.oscillator2 = this.audioCtx.createOscillator();
      this.gainNode = this.audioCtx.createGain();

      // Set up sawtooth and sine wave for a rich, buzzy industrial alarm tone
      this.oscillator1.type = 'sawtooth';
      this.oscillator2.type = 'sine';

      // Initial frequencies
      this.oscillator1.frequency.setValueAtTime(600, this.audioCtx.currentTime);
      this.oscillator2.frequency.setValueAtTime(605, this.audioCtx.currentTime);

      // Lower gain slightly to be safe yet audible
      this.gainNode.gain.setValueAtTime(0.15, this.audioCtx.currentTime);

      // Connect everything
      this.oscillator1.connect(this.gainNode);
      this.oscillator2.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);

      // Start oscillators
      this.oscillator1.start();
      this.oscillator2.start();

      this.isPlaying = true;

      // Pitch sweep loop: alternate frequency between 500Hz and 950Hz
      let goingUp = true;
      let currentFreq = 600;
      const minFreq = 500;
      const maxFreq = 950;
      const step = 35; // Size of sweep step

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
        // Sweep frequency smoothly
        this.oscillator1.frequency.exponentialRampToValueAtTime(currentFreq, now + 0.05);
        this.oscillator2.frequency.exponentialRampToValueAtTime(currentFreq + 5, now + 0.05);
      }, 50);

    } catch (error) {
      console.error("Failed to start industrial siren audio:", error);
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
        this.oscillator1.stop();
        this.oscillator1.disconnect();
        this.oscillator1 = null;
      }
      if (this.oscillator2) {
        this.oscillator2.stop();
        this.oscillator2.disconnect();
        this.oscillator2 = null;
      }
      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = null;
      }
      if (this.audioCtx) {
        this.audioCtx.close();
        this.audioCtx = null;
      }
    } catch (error) {
      console.error("Error stopping industrial siren audio:", error);
    }
    this.isPlaying = false;
  }
}

export const audioService = new AudioService();

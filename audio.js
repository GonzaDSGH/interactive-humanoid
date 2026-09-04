/**
 * Microphone input + frequency analysis (p5.sound: AudioIn + FFT).
 *
 * The artwork's mandatory hardware input. Amplitude and three frequency
 * bands (bass/mid/treble) are extracted every frame and smoothed
 * (exponential lerp) so voice/sound shapes the piece as elegant, gradual
 * energy rather than aggressive flashing. If the microphone is denied or
 * unavailable, `ready` stays false and every level stays at 0 — the
 * autonomous noise-driven motion in particleSystem.js keeps the being
 * alive regardless, exactly as required.
 */
class AudioAnalyzer {
  constructor() {
    this.mic = null;
    this.fft = null;
    this.ready = false;
    this.amplitude = 0;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this._raw = { amplitude: 0, bass: 0, mid: 0, treble: 0 };
  }

  /** Must be called from a user gesture (the activation button click). */
  start() {
    return new Promise((resolve) => {
      userStartAudio()
        .then(() => {
          this.mic = new p5.AudioIn();
          this.mic.start(
            () => {
              this.fft = new p5.FFT(CONFIG.AUDIO.smoothing, 1024);
              this.fft.setInput(this.mic);
              this.ready = true;
              resolve(true);
            },
            (err) => {
              console.warn('Microphone permission denied — continuing without audio input.', err);
              this.ready = false;
              resolve(false);
            }
          );
        })
        .catch((err) => {
          console.warn('Audio context could not start — continuing without audio input.', err);
          this.ready = false;
          resolve(false);
        });
    });
  }

  update() {
    if (this.ready && this.mic && this.fft) {
      this.fft.analyze();
      this._raw.amplitude = this.mic.getLevel();
      this._raw.bass = this.fft.getEnergy('bass') / 255;
      this._raw.mid = this.fft.getEnergy('mid') / 255;
      this._raw.treble = this.fft.getEnergy('treble') / 255;
    } else {
      this._raw.amplitude = 0;
      this._raw.bass = 0;
      this._raw.mid = 0;
      this._raw.treble = 0;
    }

    // Exponential smoothing — deliberately gentle so speech/sound reads as
    // a wave of energy through the piece, never a flash or a jump-scare.
    const k = 1 - CONFIG.AUDIO.smoothing;
    this.amplitude += (this._raw.amplitude - this.amplitude) * k;
    this.bass += (this._raw.bass - this.bass) * k;
    this.mid += (this._raw.mid - this.mid) * k;
    this.treble += (this._raw.treble - this.treble) * k;
  }
}

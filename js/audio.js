// Microphone-driven "aliveness" energy, with a simulated idle breathing
// fallback so the piece still feels alive before the user grants mic
// permission (or if they never do). The consumer only ever reads a single
// smoothed 0..1 energy value - this module hides mic vs. idle entirely.

export class MicEnergy {
  constructor() {
    this.mic = null;
    this.amp = null;
    this.enabled = false;
    this.smoothed = 0;
    this.idlePhase = Math.random() * 10;
  }

  start() {
    if (this.enabled) return;
    const P5 = window.p5;
    if (!P5 || !P5.AudioIn) return;
    try {
      this.mic = new P5.AudioIn();
      this.mic.start(
        () => {},
        (err) => console.warn('Mic unavailable, staying in idle mode:', err)
      );
      this.amp = new P5.Amplitude();
      this.amp.setInput(this.mic);
      this.enabled = true;
    } catch (e) {
      console.warn('Mic unavailable, staying in idle mode:', e);
    }
  }

  update(dt) {
    this.idlePhase += dt;
    let raw;
    if (this.enabled && this.amp) {
      raw = Math.min(1, this.amp.getLevel() * 4.5);
    } else {
      raw = (0.5 + 0.5 * Math.sin(this.idlePhase * 0.6)) * 0.35;
    }
    const rate = raw > this.smoothed ? 0.35 : 0.08;
    this.smoothed += (raw - this.smoothed) * Math.min(1, rate * dt * 60);
    return this.smoothed;
  }
}

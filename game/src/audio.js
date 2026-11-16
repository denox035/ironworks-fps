// Procedural audio only: every sound is synthesised with WebAudio at
// runtime. No audio files anywhere. The context is created on the first user
// gesture (browsers require it); in shot mode there is no gesture, so every
// call is a safe no-op until the context exists. M toggles mute.
export function makeAudio() {
  const a = {
    ctx: null, master: null, muted: false, noiseBuf: null,
    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return true;
      }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 1;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        return true;
      } catch {
        return false;
      }
    },
    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
      return this.muted;
    },
    // Short filtered noise burst: the body of a gunshot.
    burst(dur, freq, gain, type = 'lowpass') {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t, Math.random() * 0.5, dur);
      src.stop(t + dur);
    },
    // A sine thump with a falling pitch: the low end of a shot / explosion.
    thump(freq, dur, gain) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.25), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur);
    },
    // A short pure tone: beeps, ticks, chimes.
    tone(freq, dur, gain, type = 'sine', when = 0) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur);
    },
    shot(id, distant = false) {
      if (!this.ctx) return;
      const g = distant ? 0.10 : 0.5;
      if (id === 'halberd') { this.burst(0.35, 900, g); this.thump(90, 0.3, g * 0.9); }
      else if (id === 'kestrel') { this.burst(0.12, 2200, g * 0.8); this.thump(160, 0.1, g * 0.5); }
      else if (id === 'p9') { this.burst(0.1, 2800, g * 0.7); this.thump(200, 0.08, g * 0.4); }
      else { this.burst(0.16, 1600, g); this.thump(120, 0.14, g * 0.7); }
    },
    dry() { this.tone(1400, 0.03, 0.12, 'square'); },
    reload() {
      this.tone(900, 0.04, 0.15, 'square');
      this.tone(600, 0.04, 0.15, 'square', 0.18);
      this.tone(1100, 0.05, 0.18, 'square', 0.38);
    },
    hit() { this.tone(2400, 0.05, 0.2, 'sine'); },
    kill() { this.tone(660, 0.09, 0.22, 'sine'); this.tone(990, 0.14, 0.22, 'sine', 0.09); },
    hurt() { this.thump(70, 0.18, 0.4); },
    step() { this.burst(0.05, 500, 0.06); },
    beep() { this.tone(1200, 0.09, 0.25, 'square'); },
    explosion() {
      this.burst(1.1, 400, 0.9);
      this.thump(55, 1.0, 0.9);
    },
    horn() {
      this.tone(220, 0.5, 0.25, 'sawtooth');
      this.tone(330, 0.5, 0.2, 'sawtooth');
    },
    buy() { this.tone(880, 0.07, 0.2, 'sine'); this.tone(1320, 0.12, 0.2, 'sine', 0.07); },
    denied() { this.tone(220, 0.12, 0.2, 'square'); },
  };
  return a;
}

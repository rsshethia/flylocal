// Synthesized two-stroke putter: no audio assets, tiny CPU, venue-safe.
// Created on the Start tap (autoplay policy), gain follows climb.

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private chop: OscillatorNode | null = null;
  private chopGain: GainNode | null = null;
  private out: GainNode | null = null;
  private baseFreq = 68;
  muted: boolean;

  constructor() {
    try {
      this.muted = localStorage.getItem('flylocal.muted') === '1';
    } catch {
      this.muted = false;
    }
  }

  get running(): boolean {
    return this.ctx !== null;
  }

  start(): void {
    if (this.ctx) {
      void this.ctx.resume().catch(() => {});
      return;
    }
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    // Low saw + sub square through a dark lowpass = putter body.
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = this.baseFreq;
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = this.baseFreq / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.4;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 2;

    // 11 Hz chop on amplitude = propeller blades.
    const chop = ctx.createOscillator();
    chop.type = 'sine';
    chop.frequency.value = 11;
    const chopGain = ctx.createGain();
    chopGain.gain.value = 0.35;
    const depth = ctx.createGain();
    depth.gain.value = 0.65;
    chop.connect(chopGain);
    chopGain.connect(depth.gain);

    const out = ctx.createGain();
    out.gain.value = 0;
    osc.connect(lp);
    sub.connect(subGain);
    subGain.connect(lp);
    lp.connect(depth);
    depth.connect(out);
    out.connect(ctx.destination);
    osc.start();
    sub.start();
    chop.start();
    out.gain.linearRampToValueAtTime(this.muted ? 0 : 0.06, ctx.currentTime + 1.2);

    this.osc = osc;
    this.chop = chop;
    this.chopGain = chopGain;
    this.out = out;
    // sub is intentionally untracked; it dies with stop().
    void sub;
  }

  /** Call ~10 Hz from the game loop. */
  setFlight(climb: number): void {
    if (!this.ctx || !this.osc || !this.out) return;
    const t = this.ctx.currentTime;
    this.osc.frequency.setTargetAtTime(this.baseFreq + climb * 9, t, 0.2);
    this.chop?.frequency.setTargetAtTime(11 + climb * 1.5, t, 0.2);
    this.out.gain.setTargetAtTime(this.muted ? 0 : 0.055 + Math.abs(climb) * 0.02, t, 0.25);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem('flylocal.muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(m ? 0 : 0.06, this.ctx.currentTime, 0.15);
  }

  stop(): void {
    if (!this.ctx || !this.out) return;
    const ctx = this.ctx;
    this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    const osc = this.osc;
    const chop = this.chop;
    window.setTimeout(() => {
      try {
        osc?.stop();
        chop?.stop();
      } catch {
        /* ignore */
      }
      void ctx.close().catch(() => {});
    }, 600);
    this.ctx = null;
    this.osc = null;
    this.chop = null;
    this.out = null;
  }
}

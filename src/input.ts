// Input layer: calibration, dead zone, smoothing, button edges, keyboard fallback.
// Outputs normalised Controls. Firmware sends raw values only.

import type { MicrobitSample } from './serial';

export interface Controls {
  roll: number; // -1..1
  pitch: number; // -1..1
  throttle: number; // 0..1 (classic mapping; arcade uses climb instead)
  climb: number; // -1..1 (arcade: B=+1 up, A=-1 down)
  a: boolean;
  b: boolean;
  aAndB: boolean;
  logo: boolean;
  stale: boolean; // true when no fresh serial data (controls forced neutral)
  source: 'microbit' | 'keyboard' | 'mixed' | 'none';
}

export interface InputSettings {
  fullDeflectMg: number; // default 658 (≈40° tilt: 1024*sin40°)
  deadzone: number; // 0..0.5, default 0.08
  smoothingTauMs: number; // EMA time constant, default 75ms (≈0.2 @60Hz)
  invertRoll: boolean;
  invertPitch: boolean;
  throttleRate: number; // per second, default 0.5
}

export const DEFAULT_SETTINGS: InputSettings = {
  fullDeflectMg: 658,
  deadzone: 0.08,
  smoothingTauMs: 75,
  invertRoll: false,
  invertPitch: false,
  throttleRate: 0.5,
};

const SETTINGS_KEY = 'flylocal.inputSettings.v1';

export function loadSettings(): InputSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<InputSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: InputSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export class InputProcessor {
  settings: InputSettings;
  // calibration (neutral)
  private calSamples: Array<{ ax: number; ay: number }> = [];
  private calibrating = false;
  private calDone = false;
  private neutral = { ax: 0, ay: 0 };
  private calTimer: number | null = null;

  // smoothed state
  private roll = 0;
  private pitch = 0;
  private throttle = 0.5;
  private lastUpdate = performance.now();

  // buttons
  private aDown = false;
  private bDown = false;
  private logoDown = false;
  private bothHoldStart: number | null = null;
  private bothFired = false;
  onBothHold1s: (() => void) | null = null;
  onAPress: (() => void) | null = null;
  private prevA = false;

  // keyboard
  private keys = new Set<string>();

  // last raw for display
  lastRaw: MicrobitSample | null = null;
  usingKeyboard = false;

  constructor(settings?: InputSettings) {
    this.settings = settings ?? loadSettings();
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  get isCalibrating(): boolean {
    return this.calibrating;
  }
  get isCalibrated(): boolean {
    return this.calDone;
  }
  get neutralPoint(): { ax: number; ay: number } {
    return { ...this.neutral };
  }

  /** Capture neutral over ~1s (averages whatever the holder's posture is). */
  calibrateOneSecond(): void {
    this.calSamples = [];
    this.calibrating = true;
    this.calDone = false;
    if (this.calTimer !== null) window.clearTimeout(this.calTimer);
    this.calTimer = window.setTimeout(() => {
      if (this.calSamples.length > 0) {
        const ax = this.calSamples.reduce((s, v) => s + v.ax, 0) / this.calSamples.length;
        const ay = this.calSamples.reduce((s, v) => s + v.ay, 0) / this.calSamples.length;
        this.neutral = { ax, ay };
      } else {
        this.neutral = { ax: 0, ay: 0 };
      }
      this.calibrating = false;
      this.calDone = true;
    }, 1000);
  }

  recalibrateNow(): void {
    // Instant reset (menu action); next samples still smooth in.
    this.neutral = { ax: 0, ay: 0 };
    this.calDone = false;
  }

  /** Feed one serial sample; call every frame via update() to advance smoothing. */
  pushSample(s: MicrobitSample): void {
    this.lastRaw = s;
    if (this.calibrating) this.calSamples.push({ ax: s.ax, ay: s.ay });
    this.aDown = s.a === 1;
    this.bDown = s.b === 1;
    this.logoDown = s.logo === 1;

    // Edge: A press (for IDLE start)
    if (this.aDown && !this.prevA) this.onAPress?.();
    this.prevA = this.aDown;

    // Edge: A+B held 1s -> cycle flight model (throttle suppressed while both down)
    const now = performance.now();
    if (this.aDown && this.bDown) {
      if (this.bothHoldStart === null) {
        this.bothHoldStart = now;
        this.bothFired = false;
      } else if (!this.bothFired && now - this.bothHoldStart >= 1000) {
        this.bothFired = true;
        this.onBothHold1s?.();
      }
    } else {
      this.bothHoldStart = null;
      this.bothFired = false;
    }
  }

  markStale(): void {
    // Called when serial reports stale: forces neutral on next update.
    this.lastRaw = null;
  }

  private targetFromTilt(): { roll: number; pitch: number; live: boolean } {
    const s = this.lastRaw;
    if (!s) return { roll: 0, pitch: 0, live: false };
    const { fullDeflectMg, deadzone, invertRoll, invertPitch } = this.settings;
    let roll = (s.ax - this.neutral.ax) / fullDeflectMg;
    let pitch = (s.ay - this.neutral.ay) / fullDeflectMg;
    roll = Math.max(-1, Math.min(1, roll));
    pitch = Math.max(-1, Math.min(1, pitch));
    if (Math.abs(roll) < deadzone) roll = 0;
    if (Math.abs(pitch) < deadzone) pitch = 0;
    if (invertRoll) roll = -roll;
    if (invertPitch) pitch = -pitch;
    return { roll, pitch, live: true };
  }

  private targetFromKeys(): { roll: number; pitch: number; active: boolean } {
    const k = this.keys;
    let r = 0;
    let p = 0;
    if (k.has('arrowleft') || k.has('a')) r -= 1;
    if (k.has('arrowright') || k.has('d')) r += 1;
    if (k.has('arrowup') || k.has('w')) p -= 1;
    if (k.has('arrowdown') || k.has('s')) p += 1;
    return { roll: r, pitch: p, active: r !== 0 || p !== 0 };
  }

  /** Advance one frame; returns normalised controls. */
  update(now = performance.now(), dtOverride?: number): Controls {
    const dt = Math.min(0.1, (dtOverride ?? (now - this.lastUpdate) / 1000) || 0.016);
    this.lastUpdate = now;
    const alpha = 1 - Math.exp(-(dt * 1000) / Math.max(1, this.settings.smoothingTauMs));

    const tilt = this.targetFromTilt();
    const kb = this.targetFromKeys();
    this.usingKeyboard = kb.active;

    let tRoll = tilt.live ? tilt.roll : 0;
    let tPitch = tilt.live ? tilt.pitch : 0;
    let source: Controls['source'] = tilt.live ? 'microbit' : 'none';
    if (kb.active) {
      tRoll = kb.roll;
      tPitch = kb.pitch;
      source = tilt.live ? 'mixed' : 'keyboard';
    }

    this.roll += (tRoll - this.roll) * alpha;
    this.pitch += (tPitch - this.pitch) * alpha;

    // Throttle (classic) + climb (arcade). A+B suppresses throttle changes.
    const bothDown = this.aDown && this.bDown;
    const keyQ = this.keys.has('q');
    const keyE = this.keys.has('e');
    if (!bothDown) {
      if ((this.bDown || keyE) && !(this.aDown || keyQ)) {
        this.throttle = Math.min(1, this.throttle + this.settings.throttleRate * dt);
      } else if ((this.aDown || keyQ) && !(this.bDown || keyE)) {
        this.throttle = Math.max(0, this.throttle - this.settings.throttleRate * dt);
      }
    }
    const climb = (this.bDown || keyE ? 1 : 0) + (this.aDown || keyQ ? -1 : 0);

    const stale = !tilt.live && !kb.active;
    return {
      roll: this.roll,
      pitch: this.pitch,
      throttle: this.throttle,
      climb,
      a: this.aDown || keyQ,
      b: this.bDown || keyE,
      aAndB: bothDown,
      logo: this.logoDown,
      stale,
      source,
    };
  }
}

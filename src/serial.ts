// Serial layer: Web Serial -> parsed F1 samples.
// Protocol: `F1,<seq>,<ax>,<ay>,<a>,<b>[,<logo>]` newline-terminated, ~33Hz.

export interface MicrobitSample {
  seq: number;
  ax: number; // milli-g
  ay: number; // milli-g
  a: 0 | 1;
  b: 0 | 1;
  logo: 0 | 1;
  recvTime: number; // performance.now()
}

export type ConnState = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'lost';

const MICROBIT_VID = 0x0d28;
const BAUD = 115200;
const STALE_MS = 500;
const MAX_BUF = 8192;

export function isSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function parseLine(line: string): MicrobitSample | null {
  const t = line.trim();
  if (!t.startsWith('F1,')) return null;
  const p = t.split(',');
  if (p.length < 6) return null;
  const seq = Number(p[1]);
  const ax = Number(p[2]);
  const ay = Number(p[3]);
  const a = Number(p[4]);
  const b = Number(p[5]);
  const logo = p.length >= 7 ? Number(p[6]) : 0;
  if (![seq, ax, ay, a, b, logo].every(Number.isFinite)) return null;
  if (a !== 0 && a !== 1) return null;
  if (b !== 0 && b !== 1) return null;
  // ax/ay range: allow ±4096 (range setting / shaking can exceed ±1024).
  if (Math.abs(ax) > 4096 || Math.abs(ay) > 4096) return null;
  return { seq, ax, ay, a: a as 0 | 1, b: b as 0 | 1, logo: (logo ? 1 : 0) as 0 | 1, recvTime: performance.now() };
}

export interface SerialCallbacks {
  onSample(s: MicrobitSample): void;
  onState(state: ConnState, msg?: string): void;
  onStats(info: { lines: number; dropped: number; malformed: number; hz: number }): void;
}

export class SerialReader {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private keepReading = false;
  private buf = '';
  private lines = 0;
  private malformed = 0;
  private lastSeq: number | null = null;
  private dropped = 0;
  private lastHzCheck = performance.now();
  private hzCount = 0;
  private lastHz = 0;
  private lastSampleAt = 0;
  private state: ConnState = 'disconnected';
  private staleTimer: number | null = null;

  constructor(private cb: SerialCallbacks) {}

  get connectionState(): ConnState {
    return this.state;
  }

  get lastSampleAgeMs(): number {
    return this.lastSampleAt === 0 ? Infinity : performance.now() - this.lastSampleAt;
  }

  isStale(): boolean {
    return this.lastSampleAt === 0 || performance.now() - this.lastSampleAt > STALE_MS;
  }

  private setState(s: ConnState, msg?: string) {
    this.state = s;
    this.cb.onState(s, msg);
  }

  /** Wire navigator.serial connect/disconnect events. Call once at startup. */
  watchHotplug(): void {
    if (!isSerialSupported() || !navigator.serial) return;
    navigator.serial.addEventListener('connect', () => {
      // Auto-reopen only works for previously-granted ports; try it.
      void this.tryAutoReopen();
    });
    navigator.serial.addEventListener('disconnect', () => {
      void this.closeForUnplug();
    });
  }

  /** Reopen a previously-granted micro:bit without picker prompt. */
  async tryAutoReopen(): Promise<boolean> {
    if (!isSerialSupported() || !navigator.serial || this.port) return false;
    try {
      const ports = await navigator.serial.getPorts();
      const mb = ports.find(() => true); // only micro:bits were ever granted (we filter on request)
      if (!mb) return false;
      await this.openPort(mb);
      return true;
    } catch {
      return false;
    }
  }

  /** Must be called from a user gesture (button click). */
  async connectWithPicker(): Promise<void> {
    if (!isSerialSupported() || !navigator.serial) {
      this.setState('unsupported', 'Web Serial not supported in this browser.');
      return;
    }
    this.setState('connecting');
    try {
      // Filter on VID only: robust across V1/V2 interface-chip revisions and clones.
      this.port = await navigator.serial.requestPort({
        filters: [{ usbVendorId: MICROBIT_VID }],
      });
      await this.openPort(this.port);
    } catch (err) {
      this.port = null;
      this.setState('disconnected', err instanceof Error ? err.message : 'Picker cancelled.');
    }
  }

  private async openPort(port: SerialPort): Promise<void> {
    this.port = port;
    await this.port.open({ baudRate: BAUD }); // baud ignored by DAPLink CDC; pass by convention
    this.keepReading = true;
    this.buf = '';
    this.setState('connected');
    this.startStaleWatch();
    void this.readLoop();
  }

  private startStaleWatch(): void {
    if (this.staleTimer !== null) window.clearInterval(this.staleTimer);
    this.staleTimer = window.setInterval(() => {
      if (this.state === 'connected' && this.isStale() && this.lastSampleAt !== 0) {
        this.setState('lost', 'No valid line for 500 ms — controls neutral.');
      } else if (this.state === 'lost' && !this.isStale()) {
        this.setState('connected');
      }
    }, 200);
  }

  private async readLoop(): Promise<void> {
    const port = this.port;
    if (!port?.readable) {
      this.setState('disconnected', 'Port readable is null.');
      return;
    }
    const decoder = new TextDecoder();
    try {
      this.reader = port.readable.getReader();
      while (this.keepReading && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        this.buf += decoder.decode(value, { stream: true });
        if (this.buf.length > MAX_BUF) {
          // Cap buffer: drop oldest garbage to avoid unbounded growth.
          this.buf = this.buf.slice(this.buf.length - MAX_BUF);
          this.malformed++;
        }
        let idx: number;
        while ((idx = this.buf.indexOf('\n')) >= 0) {
          const raw = this.buf.slice(0, idx);
          this.buf = this.buf.slice(idx + 1);
          const s = parseLine(raw.replace(/\r$/, ''));
          if (!s) {
            if (raw.trim().length > 0) this.malformed++;
            continue;
          }
          this.lines++;
          this.hzCount++;
          if (this.lastSeq !== null && s.seq !== this.lastSeq + 1) {
            // Handle wraparound / reset of board (seq restarts at 1 on reflash).
            const gap = s.seq > this.lastSeq ? s.seq - this.lastSeq - 1 : 0;
            this.dropped += gap;
          }
          this.lastSeq = s.seq;
          this.lastSampleAt = s.recvTime;
          if (this.state === 'lost') this.setState('connected');
          this.cb.onSample(s);
        }
        const now = performance.now();
        if (now - this.lastHzCheck >= 1000) {
          this.lastHz = (this.hzCount * 1000) / (now - this.lastHzCheck);
          this.hzCount = 0;
          this.lastHzCheck = now;
          this.cb.onStats({ lines: this.lines, dropped: this.dropped, malformed: this.malformed, hz: this.lastHz });
        }
      }
    } catch (err) {
      // Fatal (unplug) vs transient: attempt clean close; hotplug handler reopens.
      if (this.keepReading) {
        this.setState('disconnected', err instanceof Error ? err.message : 'Read error.');
      }
    } finally {
      try {
        this.reader?.releaseLock();
      } catch {
        /* ignore */
      }
      this.reader = null;
    }
  }

  private async closeForUnplug(): Promise<void> {
    this.keepReading = false;
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    try {
      await this.port?.close();
    } catch {
      /* ignore */
    }
    this.port = null;
    this.setState('disconnected', 'Board unplugged. Replug to auto-reconnect.');
    // Best-effort auto-reconnect poll for 10 s (getPorts only returns granted ports).
    for (let i = 0; i < 20 && !this.port; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (this.port) break;
      await this.tryAutoReopen();
    }
  }

  async disconnect(): Promise<void> {
    this.keepReading = false;
    if (this.staleTimer !== null) {
      window.clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    try {
      this.reader?.releaseLock();
    } catch {
      /* ignore */
    }
    this.reader = null;
    try {
      await this.port?.close();
    } catch {
      /* ignore */
    }
    this.port = null;
    this.buf = '';
    this.setState('disconnected');
  }
}

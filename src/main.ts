import { SerialReader, isSerialSupported, parseLine, type MicrobitSample } from './serial';
import '@fontsource/geist-sans/latin-400.css';
import '@fontsource/geist-sans/latin-500.css';
import '@fontsource/geist-sans/latin-600.css';
import '@fontsource/geist-mono/latin-400.css';
import '@fontsource/geist-mono/latin-500.css';
import { InputProcessor, loadSettings, saveSettings } from './input';

// Milestone 1: connect, parse, calibrate, show live tilt + buttons.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  connect: $('connectBtn') as HTMLButtonElement,
  disconnect: $('disconnectBtn') as HTMLButtonElement,
  status: $('status'),
  banner: $('banner'),
  rawAx: $('rawAx'),
  rawAy: $('rawAy'),
  seq: $('seq'),
  hz: $('hz'),
  dropped: $('dropped'),
  malformed: $('malformed'),
  rollBar: $('rollBar'),
  pitchBar: $('pitchBar'),
  rollVal: $('rollVal'),
  pitchVal: $('pitchVal'),
  thrBar: $('thrFill'),
  thrVal: $('thrVal'),
  dot: $('tiltDot'),
  btnA: $('btnA'),
  btnB: $('btnB'),
  btnLogo: $('btnLogo'),
  cal: $('calBtn') as HTMLButtonElement,
  calState: $('calState'),
  invRoll: $('invRoll') as HTMLInputElement,
  invPitch: $('invPitch') as HTMLInputElement,
  deadzone: $('deadzone') as HTMLInputElement,
  dzVal: $('dzVal'),
  sens: $('sens') as HTMLInputElement,
  sensVal: $('sensVal'),
  sim: $('simInput') as HTMLInputElement,
  simAx: $('simAx') as HTMLInputElement,
  simAy: $('simAy') as HTMLInputElement,
  log: $('rawLog'),
  bothMsg: $('bothMsg'),
  aPressMsg: $('aPressMsg'),
};

const input = new InputProcessor(loadSettings());
els.invRoll.checked = input.settings.invertRoll;
els.invPitch.checked = input.settings.invertPitch;
els.deadzone.value = String(Math.round(input.settings.deadzone * 100));
els.dzVal.textContent = `${Math.round(input.settings.deadzone * 100)}%`;
els.sens.value = String(input.settings.fullDeflectMg);
els.sensVal.textContent = `${input.settings.fullDeflectMg} mg`;

let lastSample: MicrobitSample | null = null;
let stale = true;

// Simulator for no-hardware testing: sine sweep on ax/ay at ~33Hz.
let simTimer: number | null = null;
let simSeq = 0;
function setSim(on: boolean) {
  if (simTimer !== null) {
    window.clearInterval(simTimer);
    simTimer = null;
  }
  if (!on) return;
  simTimer = window.setInterval(() => {
    simSeq++;
    const t = performance.now() / 1000;
    const ax = els.simAx.checked ? Math.round(600 * Math.sin(t * 1.5)) : 0;
    const ay = els.simAy.checked ? Math.round(600 * Math.cos(t * 1.1)) : 0;
    const line = `F1,${simSeq},${ax},${ay},0,0`;
    const s = parseLine(line);
    if (s) onSample(s);
  }, 30);
}
els.sim.addEventListener('change', () => setSim(els.sim.checked));

const reader = new SerialReader({
  onSample: (s) => onSample(s),
  onState: (st, msg) => {
    els.status.textContent = `state=${st}${msg ? ` — ${msg}` : ''}`;
    els.status.dataset.state = st;
    if (st === 'connected') {
      els.banner.hidden = true;
      els.connect.disabled = true;
      els.disconnect.disabled = false;
    } else if (st === 'lost') {
      els.banner.hidden = false;
      els.banner.textContent = 'Controller lost — controls neutral. Check the cable.';
      input.markStale();
    } else if (st === 'disconnected') {
      els.connect.disabled = false;
      els.disconnect.disabled = true;
      if (msg) {
        els.banner.hidden = false;
        els.banner.textContent = msg;
      }
      input.markStale();
    } else if (st === 'unsupported') {
      els.banner.hidden = false;
      els.banner.textContent = 'Web Serial not supported. Use desktop Chrome/Edge/Opera or Firefox 151+.';
    }
  },
  onStats: (st) => {
    els.hz.textContent = st.hz.toFixed(1);
    els.dropped.textContent = String(st.dropped);
    els.malformed.textContent = String(st.malformed);
  },
});

function onSample(s: MicrobitSample) {
  lastSample = s;
  stale = false;
  input.pushSample(s);
  els.rawAx.textContent = String(s.ax);
  els.rawAy.textContent = String(s.ay);
  els.seq.textContent = String(s.seq);
  pushLog(`F1,${s.seq},${s.ax},${s.ay},${s.a},${s.b}${s.logo ? `,${s.logo}` : ''}`);
}

const logLines: string[] = [];
function pushLog(line: string) {
  logLines.push(line);
  if (logLines.length > 12) logLines.shift();
  els.log.textContent = logLines.join('\n');
  els.log.scrollTop = els.log.scrollHeight;
}

els.connect.addEventListener('click', async () => {
  if (!isSerialSupported()) {
    els.banner.hidden = false;
    els.banner.textContent = 'Web Serial not supported in this browser.';
    return;
  }
  // Least-privilege: the page must be HTTPS or localhost (secure context).
  if (!window.isSecureContext) {
    els.banner.hidden = false;
    els.banner.textContent = 'Page is not a secure context. Serve over HTTPS or from localhost.';
    return;
  }
  await reader.connectWithPicker();
});
els.disconnect.addEventListener('click', () => void reader.disconnect());

els.cal.addEventListener('click', () => {
  els.calState.textContent = 'Calibrating… hold flat (1 s)';
  input.calibrateOneSecond();
  window.setTimeout(() => {
    const n = input.neutralPoint;
    els.calState.textContent = `Neutral: ax=${n.ax.toFixed(0)} ay=${n.ay.toFixed(0)} mg`;
  }, 1100);
});

els.invRoll.addEventListener('change', () => {
  input.settings.invertRoll = els.invRoll.checked;
  saveSettings(input.settings);
});
els.invPitch.addEventListener('change', () => {
  input.settings.invertPitch = els.invPitch.checked;
  saveSettings(input.settings);
});
els.deadzone.addEventListener('input', () => {
  input.settings.deadzone = Math.max(0, Math.min(50, Number(els.deadzone.value))) / 100;
  els.dzVal.textContent = `${els.deadzone.value}%`;
  saveSettings(input.settings);
});
els.sens.addEventListener('input', () => {
  input.settings.fullDeflectMg = Math.max(200, Math.min(1024, Number(els.sens.value)));
  els.sensVal.textContent = `${els.sens.value} mg`;
  saveSettings(input.settings);
});

input.onBothHold1s = () => {
  els.bothMsg.textContent = `A+B 1 s detected at ${new Date().toLocaleTimeString()} (would cycle flight model)`;
};
input.onAPress = () => {
  els.aPressMsg.textContent = `A pressed at ${new Date().toLocaleTimeString()} (would start turn in IDLE)`;
  if (!viewFly.hidden && !flying && !countingDown) void startFlight();
};

reader.watchHotplug();
void reader.tryAutoReopen();

// Tilt test helper: checks that tilting moves roll/pitch the expected way.
let testBaseline: { roll: number; pitch: number } | null = null;
($('tiltTestBtn') as HTMLButtonElement).addEventListener('click', (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  const phase = btn.dataset.phase ?? 'start';
  if (phase === 'start') {
    const c = input.update();
    testBaseline = { roll: c.roll, pitch: c.pitch };
    btn.dataset.phase = 'check';
    btn.textContent = 'Step 2: tilt RIGHT + cable-end DOWN, then click';
    $('tiltTestOut').textContent = 'Now tilt the board right and tip the cable end down, then click the button again.';
  } else {
    const c = input.update();
    const dx = c.roll - (testBaseline?.roll ?? 0);
    const dy = c.pitch - (testBaseline?.pitch ?? 0);
    const okR = dx > 0.15;
    const okP = Math.abs(dy) > 0.15;
    $('tiltTestOut').textContent =
      `Δroll=${dx.toFixed(2)} (expect > +0.15 for right) ${okR ? 'OK' : 'INVERTED? tick invert roll'}; ` +
      `Δpitch=${dy.toFixed(2)} (expect move) ${okP ? 'OK' : 'NO-MOVE? check hold/cable'}`;
    btn.dataset.phase = 'start';
    btn.textContent = 'Run tilt test';
  }
});

// Render loop: advance input (smoothing is dt-based), paint HUD.
function frame() {
  const now = performance.now();
  const c = input.update(now);
  if (stale || reader.isStale()) {
    // No fresh data: show neutral but keep keyboard fallback live.
    if (!input.usingKeyboard) {
      els.banner.hidden = lastSample !== null ? false : true;
      if (lastSample !== null) els.banner.textContent = 'Controller lost — controls neutral.';
    }
  }

  els.rollVal.textContent = c.roll.toFixed(2);
  els.pitchVal.textContent = c.pitch.toFixed(2);
  els.rollBar.style.transform = `scaleX(${Math.abs(c.roll).toFixed(3)})`;
  (els.rollBar as HTMLElement).style.background = c.roll >= 0 ? '#7dd87d' : '#e08a8a';
  (els.rollBar as HTMLElement).style.transformOrigin = c.roll >= 0 ? 'left' : 'right';
  els.pitchBar.style.transform = `scaleX(${Math.abs(c.pitch).toFixed(3)})`;
  (els.pitchBar as HTMLElement).style.transformOrigin = c.pitch >= 0 ? 'left' : 'right';
  els.thrBar.style.width = `${Math.round(c.throttle * 100)}%`;
  els.thrVal.textContent = `${Math.round(c.throttle * 100)}% (climb ${c.climb > 0 ? '+1' : c.climb < 0 ? '-1' : '0'})`;

  // 2D tilt dot: maps roll/pitch to ±60px.
  const dx = Math.max(-1, Math.min(1, c.roll)) * 60;
  const dy = Math.max(-1, Math.min(1, c.pitch)) * 60;
  els.dot.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;

  for (const [el, on] of [
    [els.btnA, c.a],
    [els.btnB, c.b],
    [els.btnLogo, c.logo],
  ] as const) {
    el.classList.toggle('on', on);
  }
  flyTick(now, c);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- Tabs ----
const viewTest = $('viewTest');
const viewFly = $('viewFly');
const tabTest = $('tabTest') as HTMLButtonElement;
const tabFly = $('tabFly') as HTMLButtonElement;
function showTab(which: 'test' | 'fly') {
  const isFly = which === 'fly';
  document.body.classList.toggle('flying', isFly);
  viewTest.hidden = isFly;
  viewFly.hidden = !isFly;
  tabTest.classList.toggle('secondary', isFly);
  tabFly.classList.toggle('secondary', !isFly);
  if (isFly) {
    $('flyGate').hidden = flying;
    world.layout();
    void ensureMap();
  }
}
tabTest.addEventListener('click', () => showTab('test'));
tabFly.addEventListener('click', () => showTab('fly'));
($('flyExit') as HTMLButtonElement).addEventListener('click', () => {
  stopFlight();
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  showTab('test');
});
($('flyExitGate') as HTMLButtonElement).addEventListener('click', () => showTab('test'));
($('flyFull') as HTMLButtonElement).addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen().catch(() => {});
});
window.addEventListener('keydown', (e) => {
  if ((e.key === 'f' || e.key === 'F') && !viewFly.hidden) {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  }
});
($('flyCalBtn') as HTMLButtonElement).addEventListener('click', () => {
  const cal = $('flyCal');
  cal.textContent = 'hold flat…';
  input.calibrateOneSecond();
  window.setTimeout(() => {
    const n = input.neutralPoint;
    cal.textContent = `neutral ${n.ax.toFixed(0)},${n.ay.toFixed(0)}`;
  }, 1100);
});

// ---- M2: arcade flight on Mapbox ----
import { World } from './world';
import { ArcadeModel, BENDIGO, geofenceStatus, type FlightState } from './models';
import { AudioEngine } from './audio';

const world = new World($('mapWrap'), $('map'), { pixelN: 4 });
const arcade = new ArcadeModel();
const flight: FlightState = {
  lng: 144.279, lat: -36.7597, altMSL: 300, headingDeg: 0, speed: 20, bankDeg: 0, pitchDeg: 0,
};
let mapLoading: Promise<void> | null = null;
let flying = false;
let countingDown = false;
let countdownToken = 0;
const audio = new AudioEngine();
const flyMute = $('flyMute') as HTMLButtonElement;
flyMute.setAttribute('aria-pressed', String(!audio.muted));
flyMute.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  flyMute.setAttribute('aria-pressed', String(!audio.muted));
});

const flyStatus = $('flyStatus');
const flyBanner = $('flyBanner');
const hSpd = $('hSpd');
const hAgl = $('hAgl');
const hHdg = $('hHdg');
const hClimb = $('hClimb');
const hLink = $('hLink');
const plane = $('plane');
const propA = plane.querySelector('#propA') as SVGGElement | null;
const propB = plane.querySelector('#propB') as SVGGElement | null;

function groundEnv() {
  return {
    groundElev: (lng: number, lat: number) => world.groundElev(lng, lat),
  };
}

async function ensureMap(): Promise<void> {
  if (world.isReady || mapLoading) {
    if (mapLoading) await mapLoading.catch(() => {});
    return;
  }
  const token = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? '';
  if (!token) {
    flyStatus.textContent = 'missing VITE_MAPBOX_TOKEN in .env';
    flyBanner.hidden = false;
    flyBanner.textContent = 'No internet map: set VITE_MAPBOX_TOKEN in .env and restart dev server.';
    return;
  }
  if (!navigator.onLine) {
    flyBanner.hidden = false;
    flyBanner.textContent = 'No internet — Mapbox needs a live connection.';
  }
  flyStatus.textContent = 'loading map…';
  mapLoading = world
    .init(token)
    .then(() => {
      // Spawn alt from terrain + 80m AGL.
      const g = world.groundElev(flight.lng, flight.lat);
      flight.altMSL = g.elev + 80;
      world.follow(flight.lng, flight.lat);
      flyStatus.textContent = `map ready · terrain ${world.terrainUnknown ? 'pending' : 'ok'}`;
    })
    .catch((err) => {
      flyStatus.textContent = 'map failed';
      flyBanner.hidden = false;
      flyBanner.textContent = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      mapLoading = null;
    });
  world.onError = (msg) => {
    flyBanner.hidden = false;
    flyBanner.textContent = msg;
  };
  await mapLoading;
}

async function startFlight(): Promise<void> {
  showTab('fly');
  await ensureMap();
  if (!world.isReady || flying || countingDown) return;
  const my = ++countdownToken;
  countingDown = true;
  $('flyGate').hidden = true;
  flyBanner.hidden = true;
  audio.start();
  input.calibrateOneSecond(); // READY: neutral while the numbers run
  const cd = $('countdown');
  for (const s of ['3', '2', '1']) {
    if (my !== countdownToken) return;
    cd.textContent = s;
    cd.hidden = false;
    cd.classList.remove('pop');
    void cd.offsetWidth;
    cd.classList.add('pop');
    await new Promise((r) => setTimeout(r, 700));
  }
  if (my !== countdownToken) return;
  cd.hidden = true;
  countingDown = false;
  flying = true;
  arcade.reset(flight);
  const g = world.groundElev(flight.lng, flight.lat);
  flight.altMSL = g.elev + 80;
  flyStatus.textContent = 'flying — tilt to steer, B climb / A descend';
}

function stopFlight(): void {
  countdownToken++; // abort a running countdown
  countingDown = false;
  flying = false;
  $('countdown').hidden = true;
  audio.stop();
}

($('flyStart') as HTMLButtonElement).addEventListener('click', () => void startFlight());
($('flyReset') as HTMLButtonElement).addEventListener('click', () => {
  arcade.reset(flight);
  const g = world.groundElev(flight.lng, flight.lat);
  flight.altMSL = g.elev + 80;
});
($('pixelN') as HTMLInputElement).addEventListener('input', (e) => {
  const n = Number((e.currentTarget as HTMLInputElement).value);
  ($('pixelNVal') as HTMLElement).textContent = String(n);
  world.setPixelN(n);
  // Aircraft stays 28 art pixels: scale screen size with N.
  const px = 28 * n;
  plane.style.width = plane.style.height = `${px}px`;
  plane.style.margin = `${-px / 2}px 0 0 ${-px / 2}px`;
  const svg = plane.querySelector('svg');
  if (svg) {
    svg.setAttribute('width', String(px));
    svg.setAttribute('height', String(px));
  }
});
window.addEventListener('resize', () => world.layout());
window.addEventListener('online', () => {
  if (!world.isReady) void ensureMap();
});

let lastFly = performance.now();
let miniAcc = 1;
let audioAcc = 1;
let propAcc = 1;
let propFrame = false;

const mini = $('mini') as HTMLCanvasElement;
const mctx = mini.getContext('2d')!;
function drawMini(outside: boolean, warn: boolean): void {
  const b = BENDIGO.bounds;
  const W = 96, H = 96, pad = 8;
  const X = (lng: number) => pad + ((lng - b.minLng) / (b.maxLng - b.minLng)) * (W - 2 * pad);
  const Y = (lat: number) => H - pad - ((lat - b.minLat) / (b.maxLat - b.minLat)) * (H - 2 * pad);
  mctx.fillStyle = '#0a0e0a';
  mctx.fillRect(0, 0, W, H);
  mctx.strokeStyle = outside ? '#e05555' : warn ? '#ffd166' : '#9fd08a';
  mctx.lineWidth = 2;
  mctx.strokeRect(X(b.minLng), Y(b.maxLat), X(b.maxLng) - X(b.minLng), Y(b.minLat) - Y(b.maxLat));
  const px = X(flight.lng), py = Y(flight.lat);
  const hdg = (flight.headingDeg * Math.PI) / 180;
  mctx.strokeStyle = '#f4f1ea';
  mctx.lineWidth = 1;
  mctx.beginPath();
  mctx.moveTo(px, py);
  mctx.lineTo(px + Math.sin(hdg) * 8, py - Math.cos(hdg) * 8);
  mctx.stroke();
  mctx.fillStyle = '#ffd166';
  mctx.fillRect(px - 1, py - 1, 3, 3);
}

function flyTick(now: number, c: ReturnType<InputProcessor['update']>) {
  if (viewFly.hidden || !world.isReady) return;
  const dt = Math.min(0.05, (now - lastFly) / 1000 || 0.016);
  lastFly = now;

  if (flying) {
    arcade.update(dt, c, flight, groundEnv());
    world.follow(flight.lng, flight.lat);
    audioAcc += dt;
    if (audioAcc > 0.1) {
      audioAcc = 0;
      audio.setFlight(c.climb);
    }
    // Prop blur flicker at ~8 Hz.
    propAcc += dt;
    if (propAcc > 0.12) {
      propAcc = 0;
      propFrame = !propFrame;
      if (propA && propB) {
        propA.style.display = propFrame ? 'none' : '';
        propB.style.display = propFrame ? '' : 'none';
      }
    }
  } else {
    // Attract: slow drift around the spawn while the gate is up.
    const t = now / 1000;
    world.follow(
      BENDIGO.spawn.lng + 0.0022 * Math.cos(t * 0.05),
      BENDIGO.spawn.lat + 0.0016 * Math.sin(t * 0.037),
    );
  }

  const showPlane = flying || countingDown;
  plane.style.opacity = showPlane ? '1' : '0';
  $('planeShadow').style.opacity = showPlane ? '' : '0';

  miniAcc += dt;
  const geoIdle = geofenceStatus(flight.lat, flight.lng);
  if (miniAcc > 0.2) {
    miniAcc = 0;
    drawMini(geoIdle.outside, geoIdle.warn);
  }
  if (!flying) return;

  const g = world.groundElev(flight.lng, flight.lat);
  const agl = flight.altMSL - g.elev;
  hSpd.textContent = `${flight.speed.toFixed(0)} m/s`;
  hAgl.textContent = `${agl.toFixed(0)} m${g.unknown ? '?' : ''}`;
  hHdg.textContent = `${flight.headingDeg.toFixed(0)}°`;
  hClimb.textContent = c.climb > 0 ? 'up' : c.climb < 0 ? 'down' : 'level';
  hLink.textContent = c.source;
  $('lpLink').textContent = c.source;
  $('lpTilt').textContent = `${c.roll >= 0 ? 'R' : 'L'}${Math.abs(c.roll).toFixed(2)} ${c.pitch >= 0 ? 'D' : 'U'}${Math.abs(c.pitch).toFixed(2)}`;

  const geo = geofenceStatus(flight.lat, flight.lng);
  if (geo.outside) {
    flyBanner.hidden = false;
    flyBanner.className = 'flytoast';
    flyBanner.textContent = 'Outside play area — steering back…';
  } else if (geo.warn) {
    flyBanner.hidden = false;
    flyBanner.className = 'flytoast warn';
    flyBanner.textContent = 'Turn back — near edge of play area.';
  } else {
    flyBanner.hidden = true;
  }

  // Aircraft sprite: rotate to screen heading, bank skew, pitch scale.
  const screenHdg = flight.headingDeg - 45;
  const bank = Math.max(-30, Math.min(30, flight.bankDeg));
  plane.style.transform = `rotate(${screenHdg.toFixed(1)}deg)`;
  plane.style.scale = `${(1 + bank / 300).toFixed(3)} ${(1 - Math.abs(bank) / 600).toFixed(3)}`;

  // Ground shadow: sinks away, shrinks and fades as you climb — the altitude cue.
  const sh = $('planeShadow');
  const n = world.pixelN;
  const hFrac = Math.max(0, Math.min(1, agl / 150));
  const shW = 14 * n * (1 - hFrac * 0.45);
  const shH = 4 * n * (1 - hFrac * 0.35);
  sh.style.width = `${shW.toFixed(1)}px`;
  sh.style.height = `${shH.toFixed(1)}px`;
  sh.style.margin = `${(-shH / 2).toFixed(1)}px 0 0 ${(-shW / 2).toFixed(1)}px`;
  sh.style.transform = `translateY(${(hFrac * 10 * n).toFixed(1)}px)`;
  sh.style.opacity = (0.42 - hFrac * 0.26).toFixed(2);
}

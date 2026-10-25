# flylocal — a micro:bit flight simulator

Fly a plane over Bendigo, Victoria by **tilting a BBC micro:bit** like a paper
aeroplane. The board streams tilt + button data over USB, the browser turns it
into flight controls, and a pixel-art isometric Mapbox map renders the world.
Built as an event demo: a visitor picks up the controller and flies within
seconds, no instructions needed.

```
micro:bit --USB serial--> browser --> tilt/buttons --> flight model --> Mapbox map
```

## Quick start

```bash
npm install
npm run dev        # open http://localhost:5173
```

Copy `.env.example` to `.env` and add a Mapbox public token to unlock the
Fly tab (the map needs internet — Mapbox streams its tiles live):

```
VITE_MAPBOX_TOKEN=pk.your_token_here
```

Restart `npm run dev` after creating `.env`.

## The hardware loop

1. **Flash the micro:bit.** Open https://makecode.microbit.org, paste
   `firmware/reference.ts`, download, and copy the `.hex` onto the MICROBIT
   drive. Works on V1 and V2 boards — the program only uses the accelerometer
   and buttons A/B, which both boards share.
2. **Hold it flat**, USB cable pointing forward (away from you, toward the
   plane's nose). Tilt left/right to bank, tip the cable end down/up to pitch.
3. **Connect.** Click *Connect micro:bit* (browsers only allow serial from a
   real click) and pick the board. Hold flat, hit *calibrate*, run the tilt
   test — it tells you if an axis needs inverting.

No micro:bit? The keyboard always works: **arrows/WASD** tilt, **Q/E**
climb/descend. There is also a software simulator checkbox on the Test tab.

## How it all works

### 1. Serial (`src/serial.ts`)

The firmware sends one ASCII line ~33 times a second:

```
F1,<seq>,<ax>,<ay>,<a>,<b>
```

`F1` is a protocol tag (junk lines are ignored), `seq` counts up so dropped
lines are detected, `ax`/`ay` are accelerometer readings in milli-g, `a`/`b`
are 1 while a button is held. The reader buffers raw USB chunks (they arrive
in arbitrary pieces, never one line each), splits on newlines, validates every
field, and watches for silence: **500 ms with no valid line = "Controller
lost"**, controls drop to neutral, and reconnecting the cable resumes
automatically — no page reload.

### 2. Input (`src/input.ts`)

Raw sensor numbers are useless until conditioned. This layer:

- **Calibrates** — averages ~1 s of samples while you hold the board flat, so
  sensor offset and your grip are subtracted out.
- **Normalises** — divides by the reading at full tilt (658 mg ≈ 40°) and
  clamps to −1…1.
- **Dead-zones** (±8 %) and **smooths** (exponential moving average) so the
  plane doesn't jitter.
- **Reads buttons** — A/B held = climb/descend, A+B held 1 s = shortcut,
  A pressed in attract mode = start flying. Throttle-style controls are kept
  for the realistic models (see below).
- **Falls back to keyboard** and persists your invert/dead-zone/sensitivity
  settings in `localStorage`.

Output is one clean `Controls` object: `{ roll, pitch, climb, a, b, … }`.

### 3. Flight model (`src/models.ts`)

All models share one interface — `reset(state)` + `update(dt, controls,
state, env)` — so the app never cares which is active:

```ts
interface FlightModel {
  id: string;
  name: string;
  reset(state: FlightState): void;
  update(dt: number, controls: Controls, state: FlightState, env: Env): void;
}
```

The active **arcade** model is deliberately toy-like: constant 20 m/s
airspeed, your tilt picks a *screen direction* and the plane turns toward it
at most 75°/s, B climbs (+5 m/s), A descends (−4 m/s), and altitude is softly
clamped 15–150 m above ground — you can bouce off the floor but never crash.
Positions integrate with the small-area flat-Earth approximation
(`dLat = dN/111320`, `dLng = dE/(111320·cos(lat))`), and a geofence around
Bendigo warns near the edge and steers you back outside it.

### 4. World (`src/world.ts`)

The map is **live Mapbox GL JS, not pre-drawn tiles**, styled in code as a
flat cartoon: green base, outlined water and parks, cased roads, height-graded
3D blocks, hillshade + topo contours for relief. The camera is a fixed
isometric (pitch 55°, bearing 45°, constant zoom) that follows the plane with
a laggy smoothing.

The pixel look is a trick: the map renders at ¼ resolution in a small box and
CSS scales it up with `image-rendering: pixelated`. The HUD, plane, and fonts
live in a separate full-resolution layer so text stays sharp. Ground height
comes from `queryTerrainElevation()` (with a last-known fallback where tiles
haven't loaded), which also drives the soft altitude floor.

### 5. Presentation (`src/main.ts`, `src/style.css`, `src/audio.ts`)

- Fullscreen map-first Fly view: top-center instrument pill, right tool rail,
  bottom-left link status + pixel minimap, toast banners, start gate with
  attract-mode camera drift and a 3-2-1 countdown.
- Pixel plane sprite with an animated prop, and a ground shadow that sinks,
  shrinks, and fades as you climb — your main height cue.
- Synthesized two-stroke engine hum (Web Audio, no audio files) that tracks
  climb; mute persists.

## Project layout

| Path | What |
| --- | --- |
| `index.html` | Test tab + fullscreen Fly view markup |
| `src/serial.ts` | Web Serial reader, parser, reconnect |
| `src/input.ts` | Calibration, smoothing, buttons, keyboard |
| `src/models.ts` | Flight-model interface + arcade model + Bendigo bounds |
| `src/world.ts` | Map setup, flat style, iso camera, pixelation |
| `src/main.ts` | UI wiring + game loop |
| `src/audio.ts` | Synthesized engine sound |
| `src/style.css` | Pixel-world theme (Press Start 2P + VT323, vendored offline-safe) |
| `firmware/reference.ts` | MakeCode program for the micro:bit |

## Make it better — project ideas

Roughly easiest first. Each is a self-contained chunk of work:

1. **End-of-turn card.** The spec wants session stats (distance, top speed).
   Track them in the game loop and show a pixel-styled results card. Needs the
   session state machine (IDLE → READY → FLYING → TIME_UP) from the spec.
2. **Semi-realistic model.** Add `SemiModel implements FlightModel`: speed
   from throttle + pitch energy (`ω = g·tan(bank)/speed`), stall below a
   minimum speed, crash-and-respawn on terrain contact. Then a model switcher
   in the host menu (`M` key).
3. **Host menu.** Session length, tilt sensitivity, dead zone, invert flags,
   pixel size, fullscreen — persisted to `localStorage`, toggled with `M`.
4. **Custom Mapbox Studio style.** The in-code style is close, but the exact
   24-colour palette with three-tone buildings needs a Studio style. Design
   it, export the style URL, swap one line in `world.ts`.
5. **Realistic model.** Lift ∝ speed², parasitic + induced drag,
   control-surface rates instead of direct angles. Hard to fly, fun to build.
6. **Tests.** The input math (dead zone, smoothing, geofence) is pure logic —
   a perfect target for your first Vitest suite.
7. **Performance pass.** Measure frame time on the actual event laptop,
   try `fadeDuration: 0` trade-offs, reduce tile popping with a warm-up flyover.
8. **Accessibility.** Screen-reader labels on the canvas state, reduced-motion
   handling beyond the current CSS guard, high-contrast HUD theme.
9. **Soak test.** 20 back-to-back timed turns with scripted input; log memory
   and dropped serial lines. Event hardening is a feature.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| No boards in the picker | Wrong browser (needs Chrome/Edge/Opera, or Firefox 151+ desktop), or page not on HTTPS/`localhost` |
| `F1` lines but no motion | Run *calibrate*; check invert flags with the tilt test |
| Map won't load | Missing/invalid `VITE_MAPBOX_TOKEN`, or no internet |
| Fat pixelated Mapbox logo | Fixed — the attribution is counter-scaled to 1:1; if you see it, the pixel-size var didn't apply |
| Stale "Controller lost" | Cable wobble; replug — it auto-recovers within seconds |

## Spec

The full design document is `micro bit Flight Simulator Specification.md` —
demo flow, protocol, flight-model maths, milestones, and the event-day
checklist. Read section 7 (flight models) and 8 (rendering) before changing
physics or the map.

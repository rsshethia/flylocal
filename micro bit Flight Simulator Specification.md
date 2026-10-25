# micro:bit Flight Simulator: Specification

Draft v0.1 · 23 October 2026 · Mapbox GL JS + micro:bit over USB serial

## 1. Overview

A browser-based flight simulator for demos and showcases (for example school events and expos). A visitor holds a micro:bit, tilts it to bank and pitch a plane over a fixed local area rendered with Mapbox GL JS 3D terrain, and uses the buttons for throttle. The micro:bit is connected to the demo laptop by USB cable and read in the browser through the Web Serial API.

### Goals

- Visitors can pick up the controller and fly with no instructions in under 10 seconds.
- The host can run back-to-back timed turns with no page reloads.
- The flight model is switchable (arcade, semi-realistic, realistic) without changing the micro:bit program.
- Works with both micro:bit V1 and V2 boards using the same firmware and protocol.

### Non-goals (v1)

- Wireless control (Bluetooth or radio). USB serial only.
- Worldwide flying. The play area is a fixed local region.
- Multiplayer, accounts, or online leaderboards.
- Offline operation. Mapbox needs internet (see section 10).

## 2. Decisions so far

- Audience and setting: demo or showcase.
- Controller connection: USB serial (Web Serial API).
- Hardware: a mix of micro:bit V1 and V2, so only features common to both are required.
- Flight model: switchable; the player or host can choose.
- Mode switch and reset: both an on-screen menu and micro:bit shortcuts.
- Play area: a fixed local area (for example Bendigo / Victoria).
- Map engine: Mapbox GL JS, accepting that it needs internet.
- Session style: timed turns (default 2 minutes) with auto-reset for the next person.

* Visual style: live Mapbox rendering with an isometric pixel-art look, inspired by tinygyn.com. Not pre-generated art tiles. No chase-camera view: isometric only.

- Look and feel: pixel size 4 (480 × 270 art pixels on a 1080p screen), a 24-colour natural palette, flat three-tone building shading plus a ground shadow, no dithering, daytime only, about 1 to 2 km across the screen, aircraft about 24 to 32 art pixels wide.
- Aircraft: a small two-seater light plane.
- View: fixed 45° bearing, no rotation.
- Controller program: a simple MakeCode program that sends inputs over the wired USB connection. One flier at a time.
- Anything not specified takes the default option noted in this doc (for example a Bendigo start and end-of-turn stats).

## 3. Demo flow

The app is a small state machine.

| State | What happens | Leaves when |
| --- | --- | --- |
| IDLE (attract) | Camera slowly orbits a scenic spot. Banner: "Pick up the controller and press A to fly". | A pressed, or Start clicked |
| READY | "Hold the micro:bit flat". Auto-calibrates neutral tilt over 1 second. 3-2-1 countdown. | Countdown ends |
| FLYING | Timer counts down from the session length (default 120 s). Full control. | Timer reaches 0 |
| CRASHED | Only in models that can crash. Short message, then respawn at the last safe position. The timer keeps running. | After 3 s |
| TIME\_UP | "Time's up!" for 3 s, optional stats (distance, top speed). | After 3 s, returns to IDLE |

Additional rules:

- If no input change is seen for 60 s while FLYING, the app returns to IDLE.
- The host can pause, extend, or skip a turn with keyboard shortcuts (see section 8).
- Changing flight model is allowed in IDLE and READY. During FLYING it requires the host menu.

## 4. Architecture

Data flows one way: micro:bit → USB serial → Web Serial reader → input layer → flight model → camera and aircraft → Mapbox map. The HUD and session state read from the same shared state.

Suggested modules (plain TypeScript or JavaScript, no UI framework needed):

- `serial`: connect, reconnect, line parsing, stale-data detection.
- `input`: calibration, dead zone, smoothing, button edge detection, keyboard fallback. Outputs a normalised `Controls` object.
- `models/`: one file per flight model, all implementing the same interface.
- `world`: Mapbox setup, terrain, camera, aircraft layer, geofence.
- `session`: the state machine above and the timer.
- `ui`: HUD, menu, banners.

The browser page must be served over HTTPS or from `localhost`, because Web Serial requires a secure context.

## 5. micro:bit firmware and protocol

### 5.1 Hardware used

Only features common to V1 and V2: accelerometer (X and Y for tilt), button A, button B. The V2 touch logo is optional and must never be required for a function that has another route.

### 5.2 Serial settings

115200 baud, 8N1 (the MakeCode default). Send at about 33 Hz (one line every 30 ms).

### 5.3 Line format

One ASCII line per sample, newline terminated:

`F1,<seq>,<ax>,<ay>,<a>,<b>[,<logo>]`

- `F1` is the protocol identifier and version. The browser ignores lines that do not start with it.
- `seq` is an incrementing integer, used to detect dropped or stale data.
- `ax`, `ay` are accelerometer readings in milli-g (about ±1024 at 1 g).
- `a`, `b` are 1 while the button is pressed, otherwise 0.
- `logo` is optional (V2 only). A missing field is treated as 0.

### 5.4 Reference firmware (MakeCode, works on V1 and V2)

```ts
let seq = 0
basic.forever(function () {
    seq += 1
    serial.writeLine(
        "F1," + seq + "," +
        input.acceleration(Dimension.X) + "," +
        input.acceleration(Dimension.Y) + "," +
        (input.buttonIsPressed(Button.A) ? 1 : 0) + "," +
        (input.buttonIsPressed(Button.B) ? 1 : 0)
    )
    basic.pause(30)
})
```

The firmware sends raw readings only. All calibration, smoothing and button logic lives in the browser, so the same program works for every board and behaviour can be tuned without re-flashing.

### 5.5 How to hold it

Hold the micro:bit flat, LED display facing up, with the USB cable pointing forward (away from the player, towards the plane's nose). Tilt left or right to bank, tilt the cable end down or up to pitch. Axis signs vary with how it is held, so the app has "invert roll" and "invert pitch" settings, and the setup checklist includes a quick tilt test.

## 6. Controller mapping

### 6.1 Tilt

- Roll command = `ax` divided by the reading at full-deflection tilt, clamped to −1 to +1. Default full deflection is 40°, which is about 658 mg (1024 × sin 40°). Configurable.
- Pitch command is computed the same way from `ay`.
- Neutral is captured during READY by averaging about 1 second of samples. This removes sensor offset and however the player happens to hold the board.
- Dead zone: ignore ±8% around neutral.
- Smoothing: exponential moving average, `value += (target − value) × 0.2` per sample. Configurable.

### 6.2 Buttons

| Input | Action |
| --- | --- |
| Hold A | Throttle down (about 0.5 per second, so full range in 2 s) |
| Hold B | Throttle up |
| Hold A+B for 1 s | Cycle flight model (shortcut) |
| Press A in IDLE | Start a turn |
| V2 logo touch (optional) | Re-centre / recalibrate |

While A and B are both down, throttle changes are suppressed so the mode-switch hold does not nudge the speed.

Reset (return to start point) and recalibrate are always available from the on-screen menu and keyboard, and happen automatically at the start of each turn.

### 6.3 Keyboard fallback

Arrow keys or WASD for tilt, Q and E for throttle. This lets the demo carry on if the cable or board fails, and helps testing without hardware.

## 7. Flight models

All models implement one interface, so the rest of the app does not care which is active:

```ts
interface FlightModel {
  id: string;
  name: string;
  reset(state: FlightState): void;
  update(dt: number, controls: Controls, state: FlightState, env: Env): void;
}
```

`FlightState` holds longitude, latitude, altitude above sea level (m), heading, pitch, roll, speed (m/s), and throttle. `Controls` holds roll, pitch and throttle in the range −1 to 1 (throttle 0 to 1). `Env` provides ground elevation under the aircraft.

Position update each frame (metres moved north `dN` and east `dE`):

- `dLat = dN / 111320`
- `dLng = dE / (111320 × cos(lat))`

When switching model, keep position and heading, and re-initialise speed to a safe value for the new model.

### 7.1 Arcade (default for demos)

- Speed held in a comfortable range; throttle adjusts it gently.
- Heading turn rate follows bank angle (roughly proportional).
- Pitch is limited to about ±35° and auto-levels when the controller is near neutral.
- No stall. Terrain contact is a soft bounce-up rather than a crash. A minimum altitude of about 100 to 150 m above ground is enforced.

* Arcade steering is screen-relative. Tilt in any direction sets the desired direction of travel on screen, and the aircraft turns towards it at a limited rate, so tilting right always moves the plane towards screen-right.
* In arcade mode the A and B buttons climb and descend instead of changing throttle, and speed is automatic. The other models keep the throttle mapping in 6.2. Tune both in the prototype.

### 7.2 Semi-realistic

- Speed is affected by throttle and pitch (climbing slows, diving speeds up).
- Turn rate from bank: `ω = g × tan(bank) / speed`.
- Stall below a minimum speed: nose drops, controls soften until speed recovers.
- Terrain contact is a crash: CRASHED state, respawn.

### 7.3 Realistic

- Simplified lift, drag and thrust: lift scales with speed squared and angle of attack, with a stall angle; drag has parasitic and induced parts; thrust from throttle.
- Pitch and roll commands drive control-surface rates rather than setting angles directly.
- Terrain contact is a crash. No auto-levelling.
- This model needs the most tuning and is the lowest priority milestone. Expect it to be hard for casual visitors, so it is for the host or curious players only.

## 8. Rendering with Mapbox GL JS

### 8.1 Map setup

- Mapbox GL JS v3, a style (a custom flat-colour style in pixel-art mode, see 8.6; satellite-streets for a plain 3D view), with a `mapbox-dem` raster-DEM source and `map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.0 })`.
- Sky layer for the horizon, optional fog for depth and to hide tile pop-in.
- 3D buildings via `fill-extrusion` if the style provides them.
- `fadeDuration: 0`, `renderWorldCopies: false`, `maxBounds` set to the play area. Hide all map controls and interaction handlers (the player never touches the map).
- Terrain data tops out at moderate resolution, so low flying looks coarse. The minimum altitude rules in section 7 help hide this.

### 8.2 Camera control

- Use the free camera: `map.getFreeCameraOptions()`, set `position = MercatorCoordinate.fromLngLat([lng, lat], altitude)`, and orientation from heading and pitch, then `map.setFreeCameraOptions(...)` every frame inside `requestAnimationFrame`.
- Isometric follow camera (see 8.6): fixed pitch and bearing, centred on the aircraft's ground position and smoothed so it lags slightly. There is no chase camera.
- The camera never rolls. Bank is shown by tilting the aircraft.
- Max pitch is limited to 85°; the isometric pitch of about 55° is well inside it.

### 8.3 Aircraft

- A simple low-poly plane model (glTF) drawn either through the Mapbox 3D model layer or a Three.js custom layer. The prototype decides which; the spec only requires the plane to be visible in frame, banking and pitching with the model state.

### 8.4 Terrain collision

- Ground elevation from `map.queryTerrainElevation(lngLat)`. It only returns values where terrain tiles are loaded, so treat a missing value as "unknown" and fall back to the last known elevation plus a safe margin.

### 8.5 Play area (geofence)

- A fixed bounding region around the chosen area. Near the edge, show a "turn back" warning; beyond it, gently steer the aircraft back (arcade) or trigger a message and respawn (other models).
- Default start: Bendigo. Exact start coordinates and bounds to be confirmed.

### 8.6 Isometric pixel-art look (the only view)

The only view is a fixed isometric camera over a pixelated, flat-colour map. It is rendered live by Mapbox, so detail will be simpler than tinygyn.com, whose art appears to be pre-generated tile by tile and then viewed as a flat image map.

- **Camera.** Fixed pitch of about 55° and bearing of 45° (a true isometric elevation is about 35.3°, which is a Mapbox pitch of about 54.7°). Zoom is fixed. The camera follows the aircraft's ground position with smoothing. It does not chase behind the plane, so there is no chase camera.
- **Projection caveat.** Mapbox GL JS uses a perspective camera, so true orthographic isometric is not guaranteed. A distant camera with a narrow field of view approximates it. Confirm in the prototype.
- **Pixelation.** Render the map in a container at 1/N of screen size (default N = 4, so 480 × 270 on a 1920 × 1080 display) and scale it up with CSS `image-rendering: pixelated`. N is adjustable from 2 to 6 in the host menu. The HUD is drawn in a separate full-resolution layer with a pixel font so it stays readable.
- **Palette.** A custom flat-colour style: solid fills, 3D extruded buildings in flat colours, no labels, no gradients, no satellite imagery. Fixed palette of 24 natural colours (greens, browns, blue water, warm roofs). Dithering is off. A post-process pass that snaps colours to the palette is a later step, only if the flat style drifts from the 24 colours.
- **Terrain.** Mild exaggeration (about 1.2 to 1.5) so relief reads at low resolution. The pixel look also hides the coarse elevation data and tile pop-in noted in 8.1.
- **Altitude cues.** Because the camera angle does not change with pitch, show height with a ground shadow under the aircraft, aircraft size, and the altitude readout. Pitch and bank are shown by tilting the aircraft.
- **Aircraft.** A small two-seater light plane, drawn as a low-poly model through the same pixelation so it matches the map.
- **Terms.** The map stays live. Do not capture Mapbox output into your own tile set.
- **Host menu additions.** Pixel size.

* **Drawn features.** Water, parks, roads and extruded buildings. No map labels.
* **Shading.** Three tones per building (roof, left wall, right wall) plus a ground shadow under the aircraft.
* **Time of day.** Daytime only.
* **View size.** About 1 to 2 km across the screen at a fixed zoom.
* **Aircraft size.** About 24 to 32 art pixels wide on screen.

## 9. User interface

### 9.1 Screens and HUD

- Connect screen with a large "Connect micro:bit" button. Web Serial can only be opened from a user click.
- HUD during flight: speed, altitude above ground, heading, throttle bar, current flight model name, time remaining, controller connection indicator.
- Banners for "Controller lost", "No internet", "Turn back", "Time's up".
- Large type and high contrast, readable from a few metres away on a venue screen.

### 9.2 Host menu (toggle with `M`)

- Flight model selector.
- Session length, tilt sensitivity, dead zone, invert roll and pitch.
- Recalibrate, reset to start, skip turn, pause timer.
- Fullscreen toggle (`F`).
- Settings persist in the browser's local storage so they survive a reload.

## 10. Connectivity and reliability

### 10.1 Browser support

Web Serial works in desktop Chrome and Edge only. Not Safari, not Firefox, not iOS. The venue laptop must run one of these.

### 10.2 Controller connection

- Request the port with a filter for micro:bit USB devices (vendor ID `0x0D28`, product ID `0x0204`).
- After the first permission, `navigator.serial.getPorts()` lets the app reopen the same port on reload without a prompt, and the `connect` and `disconnect` events drive auto-reconnect.
- If no valid line arrives for 500 ms, set controls to neutral and show "Controller lost". Keep trying to reconnect. Normal operation resumes automatically when data returns.
- The line parser keeps a buffer, discards malformed lines, and caps buffer length.

### 10.3 Internet dependency

- Mapbox needs a live connection. The app checks connectivity at startup and shows "No internet" rather than a blank map if the style or tiles fail to load.
- A warm-up pass at setup (flying or panning over the play area once) fills the normal browser cache and reduces tile pop-in. It is a performance aid, not an offline mode.
- Use a Mapbox public token with URL restrictions. Check Mapbox's current pricing: map loads are what is billed, so avoid unnecessary page reloads during the event.

## 11. Performance and acceptance criteria

- 60 fps on the venue laptop in the play area, with no visible stutter in the arcade model.
- Input-to-screen latency under about 100 ms.
- Works with both a V1 and a V2 micro:bit running the reference firmware.
- Unplugging and re-plugging the cable recovers without a page reload within 5 seconds.
- 20 consecutive timed turns without a reload or visible degradation.
- A first-time visitor can take off and make a controlled turn within 30 seconds, with no instructions beyond the on-screen prompt.
- If the internet drops, the app shows a clear message and recovers when the connection returns.

## 12. Milestones

1. **Serial and input test page.** Connect, parse, calibrate, and show live tilt and buttons. Verify V1 and V2.
2. **Arcade flight on Mapbox.** Terrain, free camera, aircraft, isometric camera, geofence.
3. **Session flow and HUD.** State machine, timer, attract mode, auto-reset, connection banners.
4. **Host menu and extra models.** Semi-realistic first, then realistic. Mode switching by menu and A+B hold.
5. **Event hardening.** Setup checklist, reconnect testing, performance tuning on the venue laptop, soak test.

## 13. Event setup checklist

- Chrome or Edge on the laptop, cable plugged in, page opened from HTTPS or localhost.
- Venue wifi or ethernet tested; Mapbox token working.
- Connect micro:bit, run the tilt test, check invert settings.
- Warm-up flight over the play area.
- Fullscreen, session length set, one full practice turn.
- Spare micro:bit and spare USB cable on hand.

## 14. Remaining open items and assumed defaults

- Play area: default is Bendigo. Exact start coordinates and bounds are still to be set.
- Aircraft: a small two-seater light plane (decided).
- Venue laptop (still open): operating system, browser, and screen or projector size. It must run desktop Chrome or Edge.
- Scoring: default is simple end-of-turn stats (distance, top speed).
- micro:bit program: stays simple (MakeCode) and sends inputs over the wired USB connection (decided).
- Controllers: one flier at a time (decided).

* Pixel look: pixel size 4 and 24 natural colours (decided).
* View: fixed 45° bearing, no rotation (decided).
* Arcade-mode tilt means screen directions, so the controls never feel reversed (default taken; confirm in the prototype).
* Aircraft rendering: low-poly model through the pixel filter (default taken).

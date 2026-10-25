// Flight model types + arcade (screen-relative) implementation.
// Decisions: arcade = screen-relative velocity, auto-speed, A/B = climb/descend.

import type { Controls } from './input';

export interface FlightState {
  lng: number;
  lat: number;
  altMSL: number; // metres above sea level
  headingDeg: number; // 0=N, 90=E
  speed: number; // m/s forward
  bankDeg: number; // visual only in arcade
  pitchDeg: number; // visual only in arcade
}

export interface Env {
  groundElev(lng: number, lat: number): { elev: number; unknown: boolean };
}

export interface FlightModel {
  id: string;
  name: string;
  reset(s: FlightState): void;
  update(dt: number, c: Controls, s: FlightState, env: Env): void;
}

export const BENDIGO = {
  center: { lng: 144.279, lat: -36.757 },
  spawn: { lng: 144.279, lat: -36.7597, agl: 80, headingDeg: 0 },
  bounds: { minLat: -36.765, maxLat: -36.749, minLng: 144.268, maxLng: 144.29 },
  warnMarginM: 150,
};

export function moveLatLng(lat: number, lng: number, dN: number, dE: number): { lat: number; lng: number } {
  const dLat = dN / 111320;
  const dLng = dE / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

function angDiffDeg(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Arcade: kid-friendly. Constant auto speed, tilt = screen-direction intent. */
export class ArcadeModel implements FlightModel {
  id = 'arcade';
  name = 'Arcade';
  speed = 20; // m/s constant
  maxTurnDegS = 75;
  climbUpMS = 5;
  climbDownMS = 4;
  minAGL = 15;
  maxAGL = 150;
  cameraBearing = 45;

  reset(s: FlightState): void {
    s.lng = BENDIGO.spawn.lng;
    s.lat = BENDIGO.spawn.lat;
    s.headingDeg = BENDIGO.spawn.headingDeg;
    s.speed = this.speed;
    s.bankDeg = 0;
    s.pitchDeg = 0;
    // altMSL set by caller from ground+AGL (needs env); default fallback:
    if (!Number.isFinite(s.altMSL) || s.altMSL <= 0) s.altMSL = 300;
  }

  update(dt: number, c: Controls, s: FlightState, env: Env): void {
    // Screen intent: sx = roll (right+), syDown = pitch (down+).
    // Note: pitch sign depends on hold orientation; invert flags fix it (M1 tilt test).
    const sx = c.roll;
    const syDown = c.pitch;
    const mag = Math.hypot(sx, syDown);

    if (mag > 0.12) {
      // Screen-frame desired heading: up-screen = camera bearing direction.
      // screenAngle measured clockwise from up: atan2(x, -yDown... careful:
      // up component = -syDown. angle = atan2(sx, -syDown).
      const screenAngle = (Math.atan2(sx, -syDown) * 180) / Math.PI;
      const target = (this.cameraBearing + screenAngle + 360) % 360;
      const diff = angDiffDeg(s.headingDeg, target);
      const maxStep = this.maxTurnDegS * dt;
      // Expo feel: small sticks = fine control (scale step by intent magnitude).
      const scaled = Math.max(0, Math.min(1, (mag - 0.12) / 0.88));
      const step = Math.max(-maxStep, Math.min(maxStep, diff)) * (0.35 + 0.65 * scaled);
      s.headingDeg = (s.headingDeg + step + 360) % 360;
    }

    s.speed = this.speed;
    const hdg = (s.headingDeg * Math.PI) / 180;
    const dN = Math.cos(hdg) * s.speed * dt;
    const dE = Math.sin(hdg) * s.speed * dt;
    const p = moveLatLng(s.lat, s.lng, dN, dE);
    s.lat = p.lat;
    s.lng = p.lng;

    // Vertical from A/B (climb channel), release = level.
    const g = env.groundElev(s.lng, s.lat);
    const agl = s.altMSL - g.elev;
    let vs = 0;
    if (c.climb > 0) vs = this.climbUpMS * Math.min(1, c.climb);
    else if (c.climb < 0) vs = this.climbDownMS * Math.max(-1, c.climb);
    let newAgl = agl + vs * dt;
    // Soft floor/ceiling: slide, never crash.
    if (newAgl < this.minAGL) newAgl = this.minAGL;
    if (newAgl > this.maxAGL) newAgl = this.maxAGL;
    if (!g.unknown) s.altMSL = g.elev + newAgl;
    else s.altMSL += vs * dt; // coasting on unknown terrain keeps last margin

    // Geofence: gentle steer-back inside arcade (no respawn).
    const b = BENDIGO.bounds;
    const centre = BENDIGO.center;
    const outside = s.lat < b.minLat || s.lat > b.maxLat || s.lng < b.minLng || s.lng > b.maxLng;
    if (outside) {
      const toCentre = (Math.atan2(centre.lng - s.lng, centre.lat - s.lat) * 180) / Math.PI;
      const norm = (toCentre + 360) % 360;
      const d = angDiffDeg(s.headingDeg, norm);
      const steer = Math.max(-1, Math.min(1, d / 30)) * this.maxTurnDegS * dt * 1.5;
      s.headingDeg = (s.headingDeg + steer + 360) % 360;
      // Also nudge position back so a stuck stick can't pin the plane outside.
      const back = moveLatLng(s.lat, s.lng, Math.cos((norm * Math.PI) / 180) * 8 * dt, Math.sin((norm * Math.PI) / 180) * 8 * dt);
      s.lat = Math.max(b.minLat - 0.002, Math.min(b.maxLat + 0.002, back.lat));
      s.lng = Math.max(b.minLng - 0.002, Math.min(b.maxLng + 0.002, back.lng));
    }

    // Visual bank/pitch from intent (not physics).
    s.bankDeg += ((Math.max(-1, Math.min(1, sx)) * 30 - s.bankDeg) * Math.min(1, dt * 6));
    s.pitchDeg += ((Math.max(-1, Math.min(1, -syDown)) * 20 - s.pitchDeg) * Math.min(1, dt * 6));
  }
}

/** Distance (m) from point to bounds rect; negative = inside. */
export function geofenceStatus(lat: number, lng: number): { outside: boolean; warn: boolean; distM: number } {
  const b = BENDIGO.bounds;
  const latM = 111320;
  const lngM = 111320 * Math.cos((lat * Math.PI) / 180);
  const dLat = lat < b.minLat ? (b.minLat - lat) * latM : lat > b.maxLat ? (lat - b.maxLat) * latM : 0;
  const dLng = lng < b.minLng ? (b.minLng - lng) * lngM : lng > b.maxLng ? (lng - b.maxLng) * lngM : 0;
  const outsideDist = Math.hypot(dLat, dLng);
  if (outsideDist > 0) return { outside: true, warn: true, distM: outsideDist };
  const toEdge = Math.min(
    (lat - b.minLat) * latM,
    (b.maxLat - lat) * latM,
    (lng - b.minLng) * lngM,
    (b.maxLng - lng) * lngM,
  );
  return { outside: false, warn: toEdge < BENDIGO.warnMarginM, distM: -toEdge };
}

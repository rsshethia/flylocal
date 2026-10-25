// World: Mapbox GL JS setup — isometric follow camera, terrain, pixelation, geofence.
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { BENDIGO } from './models';

export interface WorldOptions {
  pixelN: number; // pixel size 2..6, default 4
  zoom: number; // fixed zoom, ~1-2km across
  bearing: number; // fixed 45
  pitch: number; // fixed ~55
}

const DEFAULTS: WorldOptions = { pixelN: 4, zoom: 15.2, bearing: 45, pitch: 55 };

// Flat pixel-art basemap, built in code (no Studio needed).
// Vector tiles from Mapbox Streets v8, zero labels, solid fills, extruded blocks.
// Glyphs/sprites omitted — there are no symbol layers.
const FLAT_STYLE = {
  version: 8,
  name: 'flylocal-flat',
  sources: {
    streets: { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' },
    dem: { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 },
    terrainVec: { type: 'vector', url: 'mapbox://mapbox.mapbox-terrain-v2' },
  },
  terrain: { source: 'dem', exaggeration: 1.3 },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#7cc46f' } },
    // Vegetation / ground cover
    { id: 'lc-wood', type: 'fill', source: 'streets', 'source-layer': 'landcover', filter: ['==', 'class', 'wood'], paint: { 'fill-color': '#5da85c' } },
    { id: 'lc-scrub', type: 'fill', source: 'streets', 'source-layer': 'landcover', filter: ['==', 'class', 'scrub'], paint: { 'fill-color': '#8ccb74' } },
    { id: 'lc-crop', type: 'fill', source: 'streets', 'source-layer': 'landcover', filter: ['==', 'class', 'crop'], paint: { 'fill-color': '#cdd68a' } },
    { id: 'lc-sand', type: 'fill', source: 'streets', 'source-layer': 'landcover', filter: ['==', 'class', 'sand'], paint: { 'fill-color': '#e3d6a4' } },
    { id: 'lc-snow', type: 'fill', source: 'streets', 'source-layer': 'landcover', filter: ['==', 'class', 'snow'], paint: { 'fill-color': '#eef3f5' } },
    { id: 'lu-park', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: ['==', 'class', 'park'], paint: { 'fill-color': '#93d683', 'fill-outline-color': '#5f9e52' } },
    { id: 'lu-grass', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: ['==', 'class', 'grass'], paint: { 'fill-color': '#86cc72' } },
    { id: 'lu-wood', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: ['==', 'class', 'wood'], paint: { 'fill-color': '#5da85c' } },
    { id: 'lu-sand', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: ['==', 'class', 'sand'], paint: { 'fill-color': '#e3d6a4' } },
    { id: 'lu-residential', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: ['==', 'class', 'residential'], paint: { 'fill-color': '#8fc46a' } },
    { id: 'lu-commercial', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: ['in', 'class', 'commercial', 'retail'], paint: { 'fill-color': '#cdb37e' } },
    { id: 'lu-industrial', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: ['==', 'class', 'industrial'], paint: { 'fill-color': '#c0aa84' } },
    { id: 'lu-cemetery', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: ['==', 'class', 'cemetery'], paint: { 'fill-color': '#69a85e' } },
    { id: 'lu-pitch', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: ['==', 'class', 'pitch'], paint: { 'fill-color': '#a5d67e' } },
    { id: 'lu-stadium', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: ['==', 'class', 'stadium'], paint: { 'fill-color': '#b9bd8f' } },
    { id: 'aeroway', type: 'fill', source: 'streets', 'source-layer': 'aeroway', paint: { 'fill-color': '#cfc8b8' } },
    // Soft relief over the flats, under everything drawn next.
    { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#4e5d43' } },
    // Water
    { id: 'water', type: 'fill', source: 'streets', 'source-layer': 'water', paint: { 'fill-color': '#55a3e0', 'fill-outline-color': '#3d7cb4' } },
    { id: 'waterway', type: 'line', source: 'streets', 'source-layer': 'waterway', paint: { 'line-color': '#55a3e0', 'line-width': 2 } },
    // Thin topo contours for a hand-drawn feel.
    {
      id: 'contour', type: 'line', source: 'terrainVec', 'source-layer': 'contour',
      paint: { 'line-color': '#8a6f4d', 'line-width': 1, 'line-opacity': 0.4 },
    },
    // Roads: dark casing under a light fill on majors; narrow singles elsewhere.
    {
      id: 'road-major-casing', type: 'line', source: 'streets', 'source-layer': 'road',
      filter: ['all', ['!=', 'structure', 'tunnel'], ['in', 'class', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary']],
      paint: { 'line-color': '#b39b62', 'line-width': 6 },
    },
    {
      id: 'road-major', type: 'line', source: 'streets', 'source-layer': 'road',
      filter: ['all', ['!=', 'structure', 'tunnel'], ['in', 'class', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary']],
      paint: { 'line-color': '#f8f4ec', 'line-width': 3.5 },
    },
    {
      id: 'road-minor', type: 'line', source: 'streets', 'source-layer': 'road',
      filter: ['all', ['!=', 'structure', 'tunnel'], ['!in', 'class', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary']],
      paint: { 'line-color': '#f5f1e8', 'line-width': 1.5 },
    },
    // Dark footing under every block so buildings sit on the ground.
    {
      id: 'building-foot', type: 'line', source: 'streets', 'source-layer': 'building',
      minzoom: 14, paint: { 'line-color': '#7c4f2a', 'line-width': 1, 'line-opacity': 0.6 },
    },
    {
      id: 'buildings', type: 'fill-extrusion', source: 'streets', 'source-layer': 'building',
      minzoom: 14, filter: ['==', 'extrude', 'true'],
      paint: {
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['coalesce', ['get', 'height'], 8],
          0, '#e6b877',
          20, '#d9a066',
          60, '#b5703f',
        ],
        'fill-extrusion-height': ['coalesce', ['get', 'height'], 10],
        'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': true,
      },
    },
  ],
};

export class World {
  private map: mapboxgl.Map | null = null;
  private outer: HTMLElement;
  private inner: HTMLElement;
  private opts: WorldOptions;
  private smooth: { lng: number; lat: number } | null = null;
  private lastElev = 250;
  private elevUnknown = true;
  private ready = false;
  onError: ((msg: string) => void) | null = null;

  constructor(outer: HTMLElement, inner: HTMLElement, opts?: Partial<WorldOptions>) {
    this.outer = outer;
    this.inner = inner;
    this.opts = { ...DEFAULTS, ...opts };
  }

  get isReady(): boolean {
    return this.ready;
  }
  get pixelN(): number {
    return this.opts.pixelN;
  }

  setPixelN(n: number): void {
    this.opts.pixelN = Math.max(2, Math.min(6, Math.round(n)));
    this.layout();
  }

  async init(token: string, spawn = BENDIGO.spawn): Promise<void> {
    if (!token) throw new Error('Missing Mapbox token (VITE_MAPBOX_TOKEN).');
    mapboxgl.accessToken = token;
    this.layout();

    this.map = new mapboxgl.Map({
      container: this.inner,
      style: FLAT_STYLE as never,
      center: [spawn.lng, spawn.lat],
      zoom: this.opts.zoom,
      pitch: this.opts.pitch,
      bearing: this.opts.bearing,
      antialias: false,
      interactive: false,
      fadeDuration: 0,
      renderWorldCopies: false,
      maxBounds: [
        [BENDIGO.bounds.minLng - 0.02, BENDIGO.bounds.minLat - 0.02],
        [BENDIGO.bounds.maxLng + 0.02, BENDIGO.bounds.maxLat + 0.02],
      ],
    });

    // Custom style has no labels by construction; fog for depth.
    this.map.on('style.load', () => {
      const m = this.map!;
      try {
        m.setFog({
          color: '#cfe8f5',
          'horizon-blend': 0.25,
          'high-color': '#add8e6',
          'space-color': '#0B1026',
          'star-intensity': 0,
        } as never);
      } catch {
        /* fog optional */
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Map load timeout — check internet / token.')), 20000);
      this.map!.once('load', () => {
        window.clearTimeout(timeout);
        this.ready = true;
        this.smooth = { lng: spawn.lng, lat: spawn.lat };
        resolve();
      });
      // Non-fatal style/tile errors surface here too — banner them, don't fail
      // init on the first transient error; the timeout above is the real guard.
      // Blank error events (aborted fetches etc.) stay in the console only.
      this.map!.on('error', (e) => {
        const err = (e as { error?: { message?: string; status?: number; url?: string } })?.error;
        const detail =
          err?.message?.trim() ||
          (typeof err?.status === 'number'
            ? `tile request failed (HTTP ${err.status})${err.url ? ` — ${err.url}` : ''}`
            : '');
        if (!detail) {
          console.debug('[map] unnamed error event', e);
          return;
        }
        console.warn('[map]', detail);
        this.onError?.(`Mapbox notice: ${detail}`);
      });
    });
    this.map.resize();
  }

  /** Render at 1/N then upscale to fill: true fullscreen pixelation. */
  layout(): void {
    const w = this.outer.clientWidth || 960;
    const h = this.outer.clientHeight || 600;
    const n = this.opts.pixelN;
    this.inner.style.width = `${Math.max(160, w / n)}px`;
    this.inner.style.height = `${Math.max(120, h / n)}px`;
    this.inner.style.transform = `scale(${n})`;
    this.inner.style.setProperty('--px-n', String(n));
    this.map?.resize();
  }

  /** Follow aircraft ground position; smoothing lags slightly. Call each frame. */
  follow(lng: number, lat: number): void {
    if (!this.map || !this.ready) return;
    if (!this.smooth) this.smooth = { lng, lat };
    const k = 0.12;
    this.smooth.lng += (lng - this.smooth.lng) * k;
    this.smooth.lat += (lat - this.smooth.lat) * k;
    this.map.jumpTo({
      center: [this.smooth.lng, this.smooth.lat],
      zoom: this.opts.zoom,
      bearing: this.opts.bearing,
      pitch: this.opts.pitch,
    });
  }

  groundElev(lng: number, lat: number): { elev: number; unknown: boolean } {
    if (!this.map || !this.ready) return { elev: this.lastElev, unknown: true };
    try {
      const v = this.map.queryTerrainElevation([lng, lat], { exaggerated: false });
      if (v === null || v === undefined || !Number.isFinite(v)) {
        return { elev: this.lastElev, unknown: true };
      }
      this.lastElev = v;
      this.elevUnknown = false;
      return { elev: v, unknown: false };
    } catch {
      return { elev: this.lastElev, unknown: true };
    }
  }

  get terrainUnknown(): boolean {
    return this.elevUnknown;
  }

  destroy(): void {
    this.map?.remove();
    this.map = null;
    this.ready = false;
  }
}

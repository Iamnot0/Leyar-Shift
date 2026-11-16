import type { Feature, GeoJSON } from 'geojson';
import { LngLatBounds, Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Bounds } from '../../lib/geo';
import type { ThemeColors } from '../../styles/tokens.generated';
import { tileTemplate, type MapPicture } from './imagery';

setWorkerUrl(workerUrl);

export const VIEW_PADDING = 48;
const PICTURE_PREFIX = 'picture:';
/** For each picture source on a map: the picture to report if it cannot load, or null for detail that may fail quietly. */
const drawnPictures = new WeakMap<MapLibreMap, Map<string, string | null>>();

interface MapOptions {
  /** One finger scrolls the page and two move the map. Off where the map is the task itself. */
  cooperativeGestures: boolean;
  onPictureError: (pictureId: string) => void;
}

export function createMap(container: HTMLElement, options: MapOptions): MapLibreMap {
  const map = new MapLibreMap({
    container,
    style: { version: 8, sources: {}, layers: [{ id: 'base', type: 'background', paint: { 'background-color': 'rgba(0, 0, 0, 0)' } }] },
    center: [0, 20],
    zoom: 1,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    cooperativeGestures: options.cooperativeGestures,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.on('error', (event) => {
    const sourceId = 'sourceId' in event && typeof event.sourceId === 'string' ? event.sourceId : null;
    if (!sourceId?.startsWith(PICTURE_PREFIX)) return console.error(event.error);
    // A picture that cannot load is reported in the page. Its finer detail is a refinement, and a picture already taken off the map no longer matters.
    const pictureId = drawnPictures.get(map)?.get(sourceId);
    if (pictureId) options.onPictureError(pictureId);
  });
  return map;
}

export function setSourceData(map: MapLibreMap, id: string, data: GeoJSON | Feature) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource(id, { type: 'geojson', data });
}

interface RasterSpec {
  id: string;
  reports: string | null;
  tiles: string;
  tileSize: number;
  minzoom: number;
  maxzoom: number;
}

/** Close enough to place a corner within a few metres, whatever picture is under the map. */
const MIN_WORKING_ZOOM = 18;
const MAP_TILE_SIZE = 512;

/** Tiles are asked for one zoom deeper on a high-density screen, so one image pixel lands on one device pixel. */
const screenDensity = () => Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)));

/** The map zoom at which a layer's deepest tiles are shown one image pixel to one device pixel. */
const nativeZoom = (spec: RasterSpec) => spec.maxzoom - Math.log2((MAP_TILE_SIZE * screenDensity()) / spec.tileSize);

/** Bottom to top: the backdrop, the picture, then the picture's finer detail. */
function rasterStack(picture: MapPicture | null, backdrop: MapPicture | null): RasterSpec[] {
  const whole = (shown: MapPicture): RasterSpec => ({ id: `${PICTURE_PREFIX}${shown.max_zoom}:${tileTemplate(shown)}`, reports: shown.id, tiles: tileTemplate(shown), tileSize: shown.tile_size, minzoom: shown.min_zoom, maxzoom: shown.max_zoom });
  const stack = [backdrop, picture].flatMap((shown) => (shown ? [whole(shown)] : []));
  if (picture?.detail) {
    const { url_template, tile_size, min_zoom, max_zoom } = picture.detail;
    stack.push({ id: PICTURE_PREFIX + url_template, reports: null, tiles: url_template, tileSize: tile_size, minzoom: min_zoom, maxzoom: max_zoom });
  }
  return stack;
}

/**
 * Draws the picture over its backdrop, and its finer detail over both, under every overlay.
 * A source already on the map is kept, so its loaded tiles stay on screen while the others arrive.
 */
export function syncImagery(map: MapLibreMap, picture: MapPicture | null, backdrop: MapPicture | null) {
  const stack = rasterStack(picture, backdrop);
  const wanted = new Set(stack.map((spec) => spec.id));
  for (const layer of map.getStyle().layers) {
    if (layer.id.startsWith(PICTURE_PREFIX) && !wanted.has(layer.id)) {
      map.removeLayer(layer.id);
      map.removeSource(layer.id);
    }
  }
  const firstOverlay = map.getStyle().layers.find((layer) => layer.id !== 'base' && !layer.id.startsWith(PICTURE_PREFIX))?.id;
  for (const spec of stack) {
    if (map.getSource(spec.id)) {
      map.moveLayer(spec.id, firstOverlay);
    } else {
      map.addSource(spec.id, { type: 'raster', tiles: [spec.tiles], tileSize: spec.tileSize / screenDensity(), minzoom: spec.minzoom, maxzoom: spec.maxzoom });
      map.addLayer({ id: spec.id, type: 'raster', source: spec.id }, firstOverlay);
    }
  }
  drawnPictures.set(map, new Map(stack.map((spec) => [spec.id, spec.reports])));
  // Past one step beyond its deepest tiles a picture is only a smear, so the map stops there.
  map.setMaxZoom(Math.max(MIN_WORKING_ZOOM, ...stack.map((spec) => nativeZoom(spec) + 1)));
}

export function toLngLatBounds(bounds: Bounds): LngLatBounds {
  return new LngLatBounds([bounds.west, bounds.south], [bounds.east, bounds.north]);
}

/**
 * The edge of the field: a white line over a soft dark halo, so it reads on any picture in either theme.
 * The picture layers are added under it.
 */
export function syncEdge(map: MapLibreMap, source: string, colors: ThemeColors) {
  map.setPaintProperty('base', 'background-color', colors.track);
  if (map.getLayer(`${source}-line`)) return;
  map.addLayer({ id: `${source}-halo`, type: 'line', source, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': colors['on-amber'], 'line-width': 12, 'line-blur': 6, 'line-opacity': 0.55 } });
  map.addLayer({ id: `${source}-line`, type: 'line', source, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': colors['on-deep'], 'line-width': 4 } });
}

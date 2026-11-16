import type { FieldGeometry, Polygon } from '../api/types';

export type LngLat = [lng: number, lat: number];

const EARTH_RADIUS_M = 6_371_008.8;
const METRES_PER_DEGREE_LAT = 110_574;
const METRES_PER_DEGREE_LNG_AT_EQUATOR = 111_320;
const SQUARE_METRES_PER_HECTARE = 10_000;

export const MIN_FIELD_HA = 0.5;
export const MAX_FIELD_HA = 2_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Outer rings of a field, whichever geometry type it arrives as. */
export function outerRings(geometry: FieldGeometry): number[][][] {
  return geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map((polygon) => polygon[0]);
}

/** Area of a ring on the sphere, in square metres. Accepts open or closed rings. */
function ringAreaM2(ring: number[][]): number {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    total += toRadians(lng2 - lng1) * (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

export function ringAreaHa(ring: number[][]): number {
  return ringAreaM2(ring) / SQUARE_METRES_PER_HECTARE;
}

export function areaHa(geometry: FieldGeometry): number {
  return outerRings(geometry).reduce((sum, ring) => sum + ringAreaHa(ring), 0);
}

/** Area-weighted centre of a ring. Good enough at field scale, where the ring is nearly planar. */
export function ringCentroid(ring: number[][]): LngLat {
  const points = isClosed(ring) ? ring.slice(0, -1) : ring;
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  if (area === 0) return [points[0][0], points[0][1]];
  return [x / (3 * area), y / (3 * area)];
}

export function centroid(geometry: FieldGeometry): LngLat {
  const rings = outerRings(geometry);
  const largest = rings.reduce((best, ring) => (ringAreaHa(ring) > ringAreaHa(best) ? ring : best), rings[0]);
  return ringCentroid(largest);
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function boundsOf(geometry: FieldGeometry): Bounds {
  const points = outerRings(geometry).flat();
  return {
    west: Math.min(...points.map(([lng]) => lng)),
    east: Math.max(...points.map(([lng]) => lng)),
    south: Math.min(...points.map(([, lat]) => lat)),
    north: Math.max(...points.map(([, lat]) => lat)),
  };
}

function isClosed(ring: number[][]): boolean {
  const first = ring[0];
  const last = ring.at(-1);
  return ring.length > 1 && last !== undefined && first[0] === last[0] && first[1] === last[1];
}

/** A GeoJSON polygon from corner points given without the closing repeat. */
export function polygonFromCorners(corners: LngLat[]): Polygon {
  return { type: 'Polygon', coordinates: [[...corners, corners[0]].map(([lng, lat]) => [lng, lat])] };
}

export function cornersOf(polygon: Polygon): LngLat[] {
  const ring = polygon.coordinates[0];
  return (isClosed(ring) ? ring.slice(0, -1) : ring).map(([lng, lat]): LngLat => [lng, lat]);
}

/** The same shape grown or shrunk about its centre to the given area, so a typed size keeps the outline the farmer drew. */
export function scaleRingTo(corners: LngLat[], hectares: number): LngLat[] {
  const current = ringAreaHa(corners);
  if (current <= 0) return corners;
  const factor = Math.sqrt(hectares / current);
  const [cx, cy] = ringCentroid(corners);
  return corners.map(([lng, lat]) => [cx + (lng - cx) * factor, cy + (lat - cy) * factor]);
}

/** A square of the given area centred on a point, for farmers who would rather type a size than draw. */
export function squareAround(centre: LngLat, hectares: number): Polygon {
  const half = Math.sqrt(hectares * SQUARE_METRES_PER_HECTARE) / 2;
  const [lng, lat] = centre;
  const dLat = half / METRES_PER_DEGREE_LAT;
  const dLng = half / (METRES_PER_DEGREE_LNG_AT_EQUATOR * Math.cos(toRadians(lat)));
  return polygonFromCorners([
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
  ]);
}

function segmentsCross(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const side = (p: LngLat, q: LngLat, r: LngLat) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

/** True when two edges that do not share a corner cross each other. */
export function selfIntersects(corners: LngLat[]): boolean {
  const count = corners.length;
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === count - 1);
      if (adjacent) continue;
      if (segmentsCross(corners[i], corners[(i + 1) % count], corners[j], corners[(j + 1) % count])) return true;
    }
  }
  return false;
}

export type FieldProblem = 'too_few_corners' | 'crosses_itself' | 'too_small' | 'too_large';

/** The first reason a drawn shape cannot be used as a field, or null when it can. */
export function fieldProblem(corners: LngLat[]): FieldProblem | null {
  if (corners.length < 3) return 'too_few_corners';
  if (selfIntersects(corners)) return 'crosses_itself';
  const hectares = ringAreaHa(corners);
  if (hectares < MIN_FIELD_HA) return 'too_small';
  if (hectares > MAX_FIELD_HA) return 'too_large';
  return null;
}

/** A rough box around the conterminous United States, used only to decide which picture to offer first. */
export function isInConterminousUs([lng, lat]: LngLat): boolean {
  return lat >= 24.4 && lat <= 49.4 && lng >= -125 && lng <= -66.9;
}

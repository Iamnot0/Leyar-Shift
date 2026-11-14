import { useEffect, useState } from 'react';
import { COUNTRY_BY_CODE } from '../data/addressCatalog';
import type { Bounds, LngLat } from '../lib/geo';

export interface Place {
  label: string;
  shortLabel?: string;
  city?: string;
  state?: string;
  country?: string;
  centre: LngLat;
  bounds: Bounds;
  postalCode?: string;
}

export interface AddressQuery {
  countryCode?: string;
  country?: string;
  state?: string;
  city?: string;
  street?: string;
  postalCode?: string;
}

interface GeocoderAddress {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
  country_code?: string;
  postcode?: string;
}

interface GeocoderRow {
  display_name?: string;
  lat: string;
  lon: string;
  boundingbox?: [south: string, north: string, west: string, east: string];
  address?: GeocoderAddress;
}

const DEFAULT_GEOCODER = 'https://nominatim.openstreetmap.org/search';

const normalizeGeocoderUrl = (value: string | undefined): string => {
  if (value === undefined) return DEFAULT_GEOCODER;
  const trimmed = value.trim();
  return trimmed.toLowerCase() === 'off' ? '' : trimmed;
};

/**
 * URL of the place lookup service. Empty when `VITE_GEOCODER_URL=off` in tests that want
 * only coordinate entry; defaults to OpenStreetMap Nominatim when the build leaves it unset.
 */
export const geocoderUrl = normalizeGeocoderUrl(import.meta.env.VITE_GEOCODER_URL);
const reverseGeocoderUrl = geocoderUrl ? geocoderUrl.replace(/\/search(?=[/?#]|$)/i, '/reverse') : '';

const COORDINATES = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/;
const COORD_TEXT = /^\s*-?\d+(?:\.\d+)?(?:\s*°\s*[NS])?\s*[,\s]\s*-?\d+(?:\.\d+)?(?:\s*°\s*[EW])?\s*$/i;
const DEG_TO_RAD = Math.PI / 180;
const KM_PER_DEG_LAT = 111.32;
const OFFLINE_HUB_RADIUS_KM = 60;

interface KnownHub {
  lat: number;
  lon: number;
  label: string;
}

const KNOWN_HUBS: KnownHub[] = [
  { lat: 40.4842, lon: -88.9937, label: 'Bloomington, United States' },
  { lat: 40.6936, lon: -89.5890, label: 'Peoria, United States' },
  { lat: 40.1164, lon: -88.2434, label: 'Champaign, United States' },
  { lat: 37.9717, lon: -100.8727, label: 'Garden City, United States' },
  { lat: 37.7528, lon: -100.0171, label: 'Dodge City, United States' },
  { lat: 41.5868, lon: -93.6250, label: 'Des Moines, United States' },
  { lat: 42.0308, lon: -93.6319, label: 'Ames, United States' },
  { lat: 40.9264, lon: -98.3420, label: 'Grand Island, United States' },
  { lat: 33.5779, lon: -101.8552, label: 'Lubbock, United States' },
  { lat: 36.7378, lon: -119.7871, label: 'Fresno, United States' },
  { lat: 46.8772, lon: -96.7898, label: 'Fargo, United States' },
  { lat: 46.7298, lon: -117.1817, label: 'Pullman, United States' },
  { lat: 43.0731, lon: -89.4012, label: 'Madison, United States' },
  { lat: 30.9010, lon: 75.8573, label: 'Ludhiana, India' },
  { lat: 29.6857, lon: 76.9905, label: 'Karnal, India' },
  { lat: 31.6340, lon: 74.8723, label: 'Amritsar, India' },
  { lat: 30.2110, lon: 74.9455, label: 'Bathinda, India' },
  { lat: 22.7196, lon: 75.8577, label: 'Indore, India' },
  { lat: 14.4745, lon: 100.1177, label: 'Suphan Buri, Thailand' },
  { lat: 16.4322, lon: 102.8236, label: 'Khon Kaen, Thailand' },
  { lat: 15.7030, lon: 100.1372, label: 'Nakhon Sawan, Thailand' },
  { lat: 18.7883, lon: 98.9853, label: 'Chiang Mai, Thailand' },
  { lat: 15.4865, lon: 120.9675, label: 'Cabanatuan, Philippines' },
  { lat: 10.7202, lon: 122.5621, label: 'Iloilo City, Philippines' },
  { lat: 52.1579, lon: -106.6702, label: 'Saskatoon, Canada' },
  { lat: 50.4452, lon: -104.6189, label: 'Regina, Canada' },
  { lat: 49.6956, lon: -112.8451, label: 'Lethbridge, Canada' },
  { lat: -35.1082, lon: 147.3598, label: 'Wagga Wagga, Australia' },
  { lat: -27.5598, lon: 151.9507, label: 'Toowoomba, Australia' },
  { lat: -11.8604, lon: -55.5091, label: 'Sinop, Brazil' },
  { lat: -23.3045, lon: -51.1696, label: 'Londrina, Brazil' },
  { lat: 31.4504, lon: 73.1350, label: 'Faisalabad, Pakistan' },
  { lat: 10.0452, lon: 105.7469, label: 'Cần Thơ, Vietnam' },
  { lat: -33.8899, lon: -60.5736, label: 'Pergamino, Argentina' },
];

export const isCoordinateString = (value: string | null | undefined): boolean => Boolean(value && COORD_TEXT.test(value.trim()));

export function cleanPlaceName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && !isCoordinateString(trimmed) ? trimmed : null;
}

function countryLabel(address?: GeocoderAddress): string | undefined {
  const code = address?.country_code?.trim().toUpperCase();
  if (code && COUNTRY_BY_CODE[code]) return COUNTRY_BY_CODE[code];
  const raw = address?.country?.trim();
  if (!raw) return undefined;
  return /^united states of america$/i.test(raw) ? 'United States' : raw;
}

export function formatCityCountry(address?: GeocoderAddress, displayName?: string): string | undefined {
  if (address) {
    const city =
      address.city ??
      address.town ??
      address.village ??
      address.hamlet ??
      address.municipality ??
      address.county?.replace(/\s+County$/i, '') ??
      address.state;
    const country = countryLabel(address);
    if (city && country) return `${city}, ${country}`;
    if (city) return city;
    if (country) return country;
  }
  if (!displayName || isCoordinateString(displayName)) return undefined;
  const parts = displayName
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const country = /^united states of america$/i.test(last) ? 'United States' : last;
    return `${parts[0]}, ${country}`;
  }
  return parts[0];
}

export function offlineCityCountry(lat: number, lon: number): string | null {
  let best: KnownHub | null = null;
  let bestDistance = Infinity;
  const cosLat = Math.cos(lat * DEG_TO_RAD);
  for (const hub of KNOWN_HUBS) {
    const dLat = (lat - hub.lat) * KM_PER_DEG_LAT;
    const dLon = (lon - hub.lon) * KM_PER_DEG_LAT * cosLat;
    const distance = Math.hypot(dLat, dLon);
    if (distance <= OFFLINE_HUB_RADIUS_KM && distance < bestDistance) {
      bestDistance = distance;
      best = hub;
    }
  }
  return best?.label ?? null;
}

const coordKey = (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`;
const reverseCache = new Map<string, string | null>();
const reverseInFlight = new Map<string, Promise<string | null>>();

/** Resolves a field coordinate to a human-readable "City, Country" label without throwing offline. */
export async function reversePlace(lat: number, lon: number, signal?: AbortSignal): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const known = offlineCityCountry(lat, lon);
  if (known) return known;

  const key = coordKey(lat, lon);
  if (reverseCache.has(key)) return reverseCache.get(key) ?? null;
  if (!reverseGeocoderUrl || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;

  const pending = reverseInFlight.get(key);
  if (pending) return pending;

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '10',
  });

  const task = fetch(`${reverseGeocoderUrl}?${params}`, { headers: { Accept: 'application/json' }, signal })
    .then(async (response) => {
      if (!response.ok) return null;
      const row = (await response.json()) as GeocoderRow;
      const formatted = formatCityCountry(row.address, row.display_name) ?? null;
      reverseCache.set(key, formatted);
      return formatted;
    })
    .catch(() => null)
    .finally(() => {
      reverseInFlight.delete(key);
    });

  reverseInFlight.set(key, task);
  return task;
}

/**
 * Returns a farmer-readable location name ("City, Country" or the field's own name).
 * Raw coordinate strings are stripped and resolved automatically.
 */
export function useResolvedPlace(lat: number, lon: number, rawName?: string | null, enabled = true, fallback = 'Your field'): string {
  const explicit = cleanPlaceName(rawName);
  const offline = enabled && !explicit ? offlineCityCountry(lat, lon) : null;
  const key = coordKey(lat, lon);
  const cached = enabled && !explicit && !offline ? (reverseCache.get(key) ?? null) : null;
  const [resolved, setResolved] = useState<{ key: string; label: string | null }>({ key, label: cached });

  useEffect(() => {
    if (!enabled || explicit || offline || reverseCache.has(key)) return;
    const controller = new AbortController();
    reversePlace(lat, lon, controller.signal).then((label) => {
      if (!controller.signal.aborted && label) setResolved({ key, label });
    });
    return () => controller.abort();
  }, [enabled, explicit, offline, key, lat, lon]);

  if (explicit) return explicit;
  if (offline) return offline;
  if (cached) return cached;
  if (resolved.key === key && resolved.label) return resolved.label;
  return fallback;
}

/** A square around a point roughly 5 km across — close enough to see a field once zoomed in. */
function around([lng, lat]: LngLat): Bounds {
  const pad = 0.03;
  return { south: lat - pad, north: lat + pad, west: lng - pad, east: lng + pad };
}

/** Reads `lat, lng` (the order most farmers paste from Google Maps) and checks the numbers are real places on Earth. */
export function parseCoordinates(text: string): Place | null {
  const match = text.match(COORDINATES);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const cityCountry = offlineCityCountry(lat, lng);
  return {
    label: cityCountry ?? 'Selected location',
    ...(cityCountry ? { shortLabel: cityCountry } : {}),
    centre: [lng, lat],
    bounds: around([lng, lat]),
  };
}

async function fetchPlaces(params: URLSearchParams): Promise<Place[]> {
  const response = await fetch(`${geocoderUrl}?${params}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Place search answered ${response.status}`);
  const rows = (await response.json()) as GeocoderRow[];
  return rows.map((row) => {
    const centre: LngLat = [Number(row.lon), Number(row.lat)];
    const box = row.boundingbox?.map(Number);
    const postalCode = row.address?.postcode?.split(';')[0]?.split(',')[0]?.trim();
    const shortLabel = formatCityCountry(row.address, row.display_name) ?? offlineCityCountry(centre[1], centre[0]) ?? undefined;
    const city =
      row.address?.city ?? row.address?.town ?? row.address?.village ?? row.address?.hamlet ?? row.address?.municipality;
    const country = countryLabel(row.address);
    return {
      label: row.display_name ?? shortLabel ?? 'Selected place',
      ...(shortLabel ? { shortLabel } : {}),
      ...(city ? { city } : {}),
      ...(row.address?.state ? { state: row.address.state } : {}),
      ...(country ? { country } : {}),
      centre,
      bounds: box ? { south: box[0], north: box[1], west: box[2], east: box[3] } : around(centre),
      ...(postalCode ? { postalCode } : {}),
    };
  });
}

function structuredParams(query: AddressQuery, includeFreeText: boolean): URLSearchParams {
  const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '5' });
  const street = query.street?.trim();
  const city = query.city?.trim();
  const state = query.state?.trim();
  const postalCode = query.postalCode?.trim();
  const countryCode = query.countryCode?.trim().toLowerCase();
  const country = query.country?.trim();

  if (street) params.set('street', street);
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  if (postalCode) params.set('postalcode', postalCode);
  if (countryCode) params.set('countrycodes', countryCode);
  else if (country) params.set('country', country);

  if (includeFreeText) {
    const combined = [street, city, state, postalCode, country].filter(Boolean).join(', ');
    if (combined) params.set('q', combined);
  }
  return params;
}

/**
 * Looks up a farm address or place name with the configured geocoder (OpenStreetMap Nominatim by default).
 * Only the address the farmer entered is sent, and only when they submit the search.
 */
export async function searchPlaces(input: string | AddressQuery): Promise<Place[]> {
  if (typeof input === 'string') {
    const direct = parseCoordinates(input);
    if (direct) return [direct];
    if (!geocoderUrl || !input.trim()) return [];
    return fetchPlaces(new URLSearchParams({ q: input.trim(), format: 'jsonv2', addressdetails: '1', limit: '5' }));
  }

  const direct = [input.street, input.city, input.postalCode].map((part) => (part ? parseCoordinates(part) : null)).find(Boolean);
  if (direct) return [direct];
  if (!geocoderUrl) return [];

  // Nominatim rejects requests combining `q` with structured fields (`city`/`state`/`street`/`postalcode`).
  const isNominatim = geocoderUrl.includes('nominatim.openstreetmap.org');
  const results = await fetchPlaces(structuredParams(input, !isNominatim));
  if (results.length > 0 || !isNominatim) return results;

  // Rural route addresses or partial postal codes can miss Nominatim's strict street index; fall back to town + region.
  const broader = [input.city?.trim(), input.state?.trim(), input.country?.trim()].filter(Boolean).join(', ');
  if (!broader || (!input.street?.trim() && !input.postalCode?.trim())) return results;
  const fallback = new URLSearchParams({ q: broader, format: 'jsonv2', addressdetails: '1', limit: '5' });
  if (input.countryCode?.trim()) fallback.set('countrycodes', input.countryCode.trim().toLowerCase());
  return fetchPlaces(fallback);
}

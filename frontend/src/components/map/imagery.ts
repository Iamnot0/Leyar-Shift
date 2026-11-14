import { useEffect, useMemo, useState } from 'react';
import type { ContextLayer, CoverageScope } from '../../api/types';
import { isInConterminousUs, type LngLat } from '../../lib/geo';

export interface CreditLink {
  label: string;
  href: string;
}

/** What the map needs to draw a picture under a field: a backend context layer, or the one the interface brings itself. */
export type MapPicture = Pick<ContextLayer, 'id' | 'title' | 'url_template' | 'tile_size' | 'min_zoom' | 'max_zoom' | 'attribution' | 'license' | 'coverage_scope' | 'native_resolution_m' | 'time'> & {
  /** Links the provider asks to be shown beside its credit. */
  credit_links?: CreditLink[];
  /**
   * A finer rendering of the same picture, drawn over it from `min_zoom` in. Its address takes the
   * tile's bounds as `{bbox-epsg-3857}`. It may arrive late or not at all: the picture stands without it.
   */
  detail?: Pick<ContextLayer, 'url_template' | 'tile_size' | 'min_zoom' | 'max_zoom'>;
  /**
   * The deepest zoom that has tiles at a place, for a picture that does not reach everywhere or
   * goes deeper in some places than others. Null when it has nothing worth showing there.
   */
  deepestZoomAt?: (place: LngLat, signal: AbortSignal) => Promise<number | null>;
};

export type PictureChoice = { mode: 'sharpest' } | { mode: 'picture'; id: string } | { mode: 'none' };

export const SHARPEST: PictureChoice = { mode: 'sharpest' };

export function tileTemplate(picture: Pick<MapPicture, 'url_template' | 'time'>): string {
  return picture.url_template.replace('{time}', picture.time?.default ?? '');
}

function tileAt([lng, lat]: LngLat, zoom: number): { x: number; y: number } {
  const count = 2 ** zoom;
  const clamp = (value: number) => Math.min(count - 1, Math.max(0, Math.floor(value)));
  const latitude = (lat * Math.PI) / 180;
  return { x: clamp(((lng + 180) / 360) * count), y: clamp(((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2) * count) };
}

/** A regional picture answers 404 where it has no tiles, so its deepest tile at the place is asked for. */
async function regionalDepthAt(picture: Pick<MapPicture, 'url_template' | 'time' | 'max_zoom'>, place: LngLat, signal: AbortSignal): Promise<number | null> {
  const { x, y } = tileAt(place, picture.max_zoom);
  const response = await fetch(tileTemplate(picture).replace('{z}', String(picture.max_zoom)).replace('{x}', String(x)).replace('{y}', String(y)), { signal });
  return response.ok ? picture.max_zoom : null;
}

const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
/** Deepest first. Below these the photo is no finer than the 10 m worldwide picture, so it is not worth showing. */
const ESRI_LEVELS = [19, 18, 17];

/** Esri answers a missing tile with a grey "not yet available" picture, so its own map of what exists is asked instead. */
async function esriDepthAt(place: LngLat, signal: AbortSignal): Promise<number | null> {
  const found = await Promise.all(
    ESRI_LEVELS.map(async (zoom) => {
      const { x, y } = tileAt(place, zoom);
      const response = await fetch(`${ESRI_IMAGERY}/tilemap/${zoom}/${y}/${x}/1/1?f=json`, { signal });
      const answer: { data?: number[] } = await response.json();
      return response.ok && answer.data?.[0] === 1 ? zoom : null;
    }),
  );
  return found.find((zoom) => zoom !== null) ?? null;
}

/**
 * The one picture the interface brings itself. Outside the United States nothing the backend lists
 * is finer than 10 m, and a field cannot be recognised at that. Clay chose Esri for it on 2026-11-14.
 * Esri's terms ask for an ArcGIS account and allow non-commercial use only.
 */
const ESRI_WORLD_IMAGERY: MapPicture = {
  id: 'esri_world_imagery',
  title: 'Satellite photo, about 1 m',
  url_template: `${ESRI_IMAGERY}/tile/{z}/{y}/{x}`,
  tile_size: 256,
  min_zoom: 0,
  max_zoom: ESRI_LEVELS[0],
  attribution: 'Esri, Vantor, Earthstar Geographics, and the GIS User Community',
  license: 'Esri Master License Agreement',
  credit_links: [
    { label: 'Powered by Esri', href: 'https://www.esri.com' },
    { label: 'Esri terms of use', href: 'https://goto.arcgis.com/termsofuse/viewtermsofuse' },
  ],
  coverage_scope: 'global',
  native_resolution_m: 1,
  time: null,
  deepestZoomAt: esriDepthAt,
};

function toPicture(layer: ContextLayer, detail: ContextLayer | undefined): MapPicture {
  const { id, title, url_template, tile_size, min_zoom, max_zoom, attribution, license, coverage_scope, time } = layer;
  const picture: MapPicture = { id, title, url_template, tile_size, min_zoom, max_zoom, attribution, license, coverage_scope, time, native_resolution_m: detail?.native_resolution_m ?? layer.native_resolution_m };
  if (layer.license_url) picture.credit_links = [{ label: `Licence: ${license ?? 'terms'}`, href: layer.license_url }];
  if (detail) picture.detail = { url_template: detail.url_template, tile_size: detail.tile_size, min_zoom: detail.min_zoom, max_zoom: detail.max_zoom };
  if (coverage_scope !== 'global') picture.deepestZoomAt = (place, signal) => regionalDepthAt(picture, place, signal);
  return picture;
}

/**
 * Every picture on offer under a field: the backend's picture layers, each joined with the layer
 * that sharpens it, and the Esri photo. Data maps need their legend, so they are not pictures.
 */
export function picturesFrom(contextLayers: ContextLayer[]): MapPicture[] {
  const wholes = contextLayers.filter((layer) => layer.kind === 'picture' && layer.detail_of === null);
  return [...wholes.map((layer) => toPicture(layer, contextLayers.find((candidate) => candidate.detail_of === layer.id))), ESRI_WORLD_IMAGERY];
}

/** Before the backend has checked a field, the scopes that apply are judged from the place alone. */
export function likelyScopes(place: LngLat): CoverageScope[] {
  return isInConterminousUs(place) ? ['global', 'us_only'] : ['global'];
}

function sharpest(pictures: MapPicture[], scopes: CoverageScope[]): MapPicture | null {
  const detail = (picture: MapPicture) => picture.native_resolution_m ?? Infinity;
  return pictures.filter((picture) => scopes.includes(picture.coverage_scope)).reduce<MapPicture | null>((best, picture) => (best === null || detail(picture) < detail(best) ? picture : best), null);
}

/** A picture found missing at one spot is skipped across the map tile of this zoom around it, about 10 km. */
const NEIGHBOURHOOD_ZOOM = 12;

/**
 * The picture to show at a place, and the one to keep under it.
 *
 * "Sharpest" is the finest picture whose scope covers the place and that really has tiles there. A
 * picture that does not reach everywhere is asked how deep it goes at the place first, and is drawn
 * over the sharpest picture that does reach everywhere, so the map is never left empty while it
 * loads or if it never arrives. A picture chosen by hand that is missing here gives way to the
 * sharpest one that is not. Choosing again tries every picture afresh.
 *
 * `shown` is the picture to name and credit. `picture` is the same one once it can be drawn.
 */
export function usePicture(pictures: MapPicture[], choice: PictureChoice, scopes: CoverageScope[], place: LngLat) {
  const [gaps, setGaps] = useState<string[]>([]);
  const [depths, setDepths] = useState<Record<string, number>>({});
  const [lastChoice, setLastChoice] = useState(choice);
  if (lastChoice !== choice) {
    setLastChoice(choice);
    setGaps([]);
  }

  const [lng, lat] = place;
  const neighbourhood = tileAt(place, NEIGHBOURHOOD_ZOOM);
  const here = (id: string) => `${id}@${neighbourhood.x}/${neighbourhood.y}`;
  const present = pictures.filter((picture) => !gaps.includes(here(picture.id)));
  const chosen = choice.mode === 'picture' ? (present.find((picture) => picture.id === choice.id) ?? null) : null;
  const shown = choice.mode === 'none' ? null : (chosen ?? sharpest(present, scopes));
  const everywhere = present.filter((picture) => picture.coverage_scope === 'global' && !picture.deepestZoomAt);
  const backdrop = shown?.deepestZoomAt ? sharpest(everywhere, ['global']) : null;
  const choiceMissing = choice.mode === 'picture' && chosen === null;

  const asked = shown?.deepestZoomAt ? here(shown.id) : null;
  const depth = asked === null ? undefined : depths[asked];
  const picture = useMemo(() => {
    if (!shown?.deepestZoomAt) return shown;
    if (depth === undefined) return null;
    return depth === shown.max_zoom ? shown : { ...shown, max_zoom: depth };
  }, [shown, depth]);

  useEffect(() => {
    if (!shown?.deepestZoomAt || asked === null || depth !== undefined) return;
    const controller = new AbortController();
    const missing = () => setGaps((current) => [...current, asked]);
    shown
      .deepestZoomAt([lng, lat], controller.signal)
      .then((found) => (found === null ? missing() : setDepths((current) => ({ ...current, [asked]: found }))))
      .catch(() => {
        // A question that was superseded is not an answer. One that failed means the picture cannot be reached.
        if (!controller.signal.aborted) missing();
      });
    return () => controller.abort();
  }, [shown, asked, depth, lng, lat]);

  const reportFailure = (pictureId: string) => setGaps((current) => [...current, here(pictureId)]);
  return { shown, picture, backdrop, choiceMissing, reportFailure };
}

import type { Feature } from 'geojson';
import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { MapPicture } from './imagery';
import type { Bounds, LngLat } from '../../lib/geo';
import { themes, type ThemeName } from '../../styles/tokens.generated';
import { VIEW_PADDING, createMap, setSourceData, syncEdge, syncImagery, toLngLatBounds } from './mapSetup';

const NUDGE_PX = 12;
const MAX_FIT_ZOOM = 16;
const ARROWS: Record<string, [dx: number, dy: number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export interface MapView {
  bounds: Bounds;
}

interface FieldEditorMapProps {
  corners: LngLat[];
  /** While true, a tap on the map adds a corner at the end of the boundary. */
  adding: boolean;
  /** Corner buttons are drawn only while the boundary is being marked or edited, so a finished field reads cleanly. */
  showHandles: boolean;
  selected: number | null;
  imagery: MapPicture | null;
  /** Kept under `imagery`, so the map is never empty while it loads. */
  backdrop: MapPicture | null;
  theme: ThemeName;
  /** Set to a new object to move the map there. */
  view: MapView | null;
  onAddCorner: (corner: LngLat) => void;
  onMoveCorner: (index: number, corner: LngLat) => void;
  onRemoveCorner: (index: number) => void;
  onSelect: (index: number | null) => void;
  onCentreChange: (centre: LngLat) => void;
  onImageryError: (pictureId: string) => void;
}

function draftShape(corners: LngLat[]): Feature {
  if (corners.length >= 3) return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] } };
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: corners } };
}

/**
 * The map a field is drawn on. Corners are real buttons: they can be dragged, tabbed to,
 * nudged with the arrow keys and removed with Delete, so drawing never depends on a pointer.
 */
export function FieldEditorMap(props: FieldEditorMapProps) {
  const { corners, selected, imagery, backdrop, theme, view, showHandles } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const latest = useRef(props);
  const handles = useRef<Marker[]>([]);
  const cornerCount = showHandles ? corners.length : 0;

  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const instance = createMap(container, { cooperativeGestures: false, onPictureError: (pictureId) => latest.current.onImageryError(pictureId) });
    instance.getCanvas().setAttribute('aria-label', 'Map for marking your field. Tap to add corners, or type the field size beside the map to place a square. Each corner is a button after the map.');
    instance.on('click', (event) => {
      const target = event.originalEvent.target;
      if (target instanceof Element && target.closest('.corner-handle')) return;
      if (latest.current.adding) latest.current.onAddCorner([event.lngLat.lng, event.lngLat.lat]);
      else latest.current.onSelect(null);
    });
    instance.on('moveend', () => {
      const centre = instance.getCenter();
      latest.current.onCentreChange([centre.lng, centre.lat]);
    });
    instance.once('load', () => setMap(instance));
    return () => {
      setMap(null);
      instance.remove();
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    setSourceData(map, 'draft', draftShape(corners));
    syncEdge(map, 'draft', themes[theme]);
  }, [map, corners, theme]);

  useEffect(() => {
    if (!map) return;
    syncImagery(map, imagery, backdrop);
  }, [map, imagery, backdrop]);

  useEffect(() => {
    if (!map) return;
    handles.current = Array.from({ length: cornerCount }, (_, index) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'corner-handle';
      element.setAttribute('aria-label', `Corner ${index + 1} of ${cornerCount}. Arrow keys move it. Delete removes it.`);
      element.addEventListener('click', () => latest.current.onSelect(index));
      element.addEventListener('focus', () => latest.current.onSelect(index));
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          latest.current.onRemoveCorner(index);
          return;
        }
        const arrow = ARROWS[event.key];
        if (!arrow) return;
        event.preventDefault();
        event.stopPropagation();
        const point = map.project(latest.current.corners[index]);
        const moved = map.unproject([point.x + arrow[0] * NUDGE_PX, point.y + arrow[1] * NUDGE_PX]);
        latest.current.onMoveCorner(index, [moved.lng, moved.lat]);
      });
      const handle = new Marker({ element, draggable: true }).setLngLat([0, 0]).addTo(map);
      handle.on('drag', () => {
        const position = handle.getLngLat();
        latest.current.onMoveCorner(index, [position.lng, position.lat]);
      });
      return handle;
    });
    // Removing a corner destroys the button that had focus. Hand focus to the corner now selected.
    const { selected: focusIndex } = latest.current;
    if (focusIndex !== null && document.activeElement === document.body) handles.current[focusIndex]?.getElement().focus({ preventScroll: true });
    return () => {
      for (const handle of handles.current) handle.remove();
      handles.current = [];
    };
  }, [map, cornerCount]);

  useEffect(() => {
    handles.current.forEach((handle, index) => {
      if (corners[index]) handle.setLngLat(corners[index]);
      handle.getElement().setAttribute('aria-pressed', String(index === selected));
    });
  }, [map, corners, selected]);

  useEffect(() => {
    if (!map || !view) return;
    map.fitBounds(toLngLatBounds(view.bounds), { padding: VIEW_PADDING, duration: 0, maxZoom: MAX_FIT_ZOOM });
  }, [map, view]);

  return (
    <div className="map-frame">
      <div ref={containerRef} className="map map--editor" />
    </div>
  );
}

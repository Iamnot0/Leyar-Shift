import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { FieldGeometry } from '../../api/types';
import type { MapPicture } from './imagery';
import { boundsOf } from '../../lib/geo';
import { themes, type ThemeName } from '../../styles/tokens.generated';
import { VIEW_PADDING, createMap, setSourceData, syncEdge, syncImagery, toLngLatBounds } from './mapSetup';

interface FieldMapProps {
  fieldName: string;
  boundary: FieldGeometry;
  imagery: MapPicture | null;
  /** Kept under `imagery`, so the map is never empty while it loads. */
  backdrop: MapPicture | null;
  theme: ThemeName;
  onImageryError: (pictureId: string) => void;
}

export function FieldMap({ fieldName, boundary, imagery, backdrop, theme, onImageryError }: FieldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const reportImageryError = useRef(onImageryError);

  useEffect(() => {
    reportImageryError.current = onImageryError;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const instance = createMap(container, { cooperativeGestures: true, onPictureError: (pictureId) => reportImageryError.current(pictureId) });
    instance.once('load', () => setMap(instance));
    return () => {
      setMap(null);
      instance.remove();
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    map.getCanvas().setAttribute('aria-label', `Map of ${fieldName}, with the edge of the field drawn in white. Arrow keys move the map; plus and minus zoom.`);
  }, [map, fieldName]);

  useEffect(() => {
    if (!map) return;
    setSourceData(map, 'field', { type: 'Feature', geometry: boundary, properties: {} });
    syncEdge(map, 'field', themes[theme]);
    map.fitBounds(toLngLatBounds(boundsOf(boundary)), { padding: VIEW_PADDING, duration: 0 });
  }, [map, boundary, theme]);

  useEffect(() => {
    if (!map) return;
    syncImagery(map, imagery, backdrop);
  }, [map, imagery, backdrop]);

  return (
    <div className="map-frame">
      <div ref={containerRef} className="map" />
    </div>
  );
}

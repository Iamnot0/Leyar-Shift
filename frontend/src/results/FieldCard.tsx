import { lazy, Suspense } from 'react';
import { cleanPlaceName, useResolvedPlace } from '../api/places';
import type { FieldPlan } from '../app/plan';
import type { Analysis } from '../api/types';
import { MapBoundary } from '../components/map/MapBoundary';
import { likelyScopes, usePicture, type MapPicture, type PictureChoice } from '../components/map/imagery';
import { EvidenceTag } from '../components/ui/EvidenceTag';
import { ImageryPicker } from '../components/ui/ImageryPicker';
import { Card, Tile } from '../components/ui/kit';
import { coveredCount } from '../lib/evidence';
import { NULL_REASON_WORDS } from '../content/copy';
import { formatHectares, formatWhole } from '../lib/format';
import { areaHa, centroid, type LngLat } from '../lib/geo';
import type { ThemeName } from '../styles/tokens.generated';
import { currentOf, scoreOf } from './reading';

// The map library is by far the largest part of the app, so it loads only when a map is on screen.
const FieldMap = lazy(() => import('../components/map/FieldMap').then((module) => ({ default: module.FieldMap })));

export interface PictureProps {
  pictures: MapPicture[];
  pictureChoice: PictureChoice;
  theme: ThemeName;
  onPictureChange: (choice: PictureChoice) => void;
}

interface FieldCardProps extends PictureProps {
  field: FieldPlan;
  analysis: Analysis | null;
}

function useFieldPicture({ field, analysis, pictures, pictureChoice }: FieldCardProps) {
  const place: LngLat = analysis ? [analysis.field.centroid.lon, analysis.field.centroid.lat] : centroid(field.geometry);
  return usePicture(pictures, pictureChoice, analysis?.field.coverage_scopes ?? likelyScopes(place), place);
}

function FieldPhotoMap({ field, theme, state }: { field: FieldPlan; theme: ThemeName; state: ReturnType<typeof usePicture> }) {
  return (
    <MapBoundary>
      <Suspense
        fallback={
          <p className="map-frame map-frame__fallback" role="status">
            Loading the map…
          </p>
        }
      >
        <FieldMap fieldName={cleanPlaceName(field.name) ?? 'your field'} boundary={field.geometry} imagery={state.picture} backdrop={state.backdrop} theme={theme} onImageryError={state.reportFailure} />
      </Suspense>
    </MapBoundary>
  );
}

/** The field on its picture and nothing else, for the working state. */
export function FieldPhoto(props: FieldCardProps) {
  return <FieldPhotoMap field={props.field} theme={props.theme} state={useFieldPicture(props)} />;
}

export function FieldCard(props: FieldCardProps & { analysis: Analysis }) {
  const { field, analysis, pictures, pictureChoice, theme, onPictureChange } = props;
  const state = useFieldPicture(props);
  const [lon, lat] = centroid(field.geometry);
  const cityCountry = useResolvedPlace(lat, lon, null, true, '');
  const title = cleanPlaceName(field.name) ?? (cityCountry || 'Your field');
  const subtitle = cityCountry && title !== cityCountry ? cityCountry : null;
  const current = currentOf(analysis);
  const water = scoreOf(current, 'water_balance');
  const bare = current.cover_calendar.bare_weeks_per_year;
  // Where a satellite measures the water that left the field, it is set beside the model's own figure.
  const measuredUse = analysis.field_evidence.find((item) => item.kind === 'evapotranspiration' && item.quantity.value !== null);
  const waterWords = water?.physical && water.physical.value !== null ? formatWhole(water.physical.value, water.physical.unit) : NULL_REASON_WORDS[water?.physical?.null_reason ?? water?.null_reason ?? 'not_configured'];
  const bareWords = bare.value !== null ? formatWhole(bare.value, bare.unit) : NULL_REASON_WORDS[bare.null_reason ?? 'not_configured'];
  return (
    <Card className="narrow" title="Your field">
      <FieldPhotoMap field={field} theme={theme} state={state} />
      <p>
        <strong>{title}</strong>
        {subtitle && (
          <>
            <br />
            <span className="secondary">{subtitle}</span>
          </>
        )}
      </p>
      <div className="tile-grid">
        <Tile label="Field size" value={`${formatHectares(areaHa(field.geometry))} ha`} />
        <Tile label="Data we could find" value={`${coveredCount(analysis.datasets)} of ${analysis.datasets.length} sources`} />
        <Tile label="Water your crops use now" value={waterWords} />
        <Tile label="Bare soil now" value={bareWords} />
      </div>
      {measuredUse && (
        <div className="meaning">
          <strong className="meaning__label">Checked against the satellite</strong>
          <span>{measuredUse.summary}</span>
          <EvidenceTag source={measuredUse.quantity} />
        </div>
      )}
      <ImageryPicker pictures={pictures} choice={pictureChoice} shown={state.shown} backdrop={state.backdrop} choiceMissing={state.choiceMissing} onChange={onPictureChange} />
    </Card>
  );
}

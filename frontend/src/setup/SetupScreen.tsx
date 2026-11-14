import { lazy, Suspense, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMeta } from '../app/context';
import type { CoverageState, FarmDraft, FieldPlan } from '../app/plan';
import { cleanPlaceName, geocoderUrl, offlineCityCountry, parseCoordinates, reversePlace, searchPlaces, useResolvedPlace, type Place } from '../api/places';
import { CITIES_BY_REGION, COUNTRY_BY_CODE, FEATURED_COUNTRIES, lookupPostalCode, OTHER_COUNTRIES, REGIONS_BY_COUNTRY } from '../data/addressCatalog';
import type { Equipment, Priority, RotationYear, WaterAvailability } from '../api/types';
import type { MapView } from '../components/map/FieldEditorMap';
import { MapBoundary } from '../components/map/MapBoundary';
import { likelyScopes, usePicture } from '../components/map/imagery';
import { Drawer } from '../components/ui/Drawer';
import { CheckIcon } from '../components/ui/Icons';
import { ImageryPicker, PhotoCredit } from '../components/ui/ImageryPicker';
import { Card, CardState, Reminder } from '../components/ui/kit';
import { Segmented } from '../components/ui/Segmented';
import { SourceList } from '../components/ui/SourceList';
import { coveredCount } from '../lib/evidence';
import { FIELD_PROBLEM_COPY, NEXT_STEP_WORDS, PRIORITY_WORDS, SETUP_STEPS, SETUP_TITLES, WATER_OPTIONS } from '../content/copy';
import { formatHectares, formatNumber, numberWord, sentenceCase } from '../lib/format';
import { MAX_FIELD_HA, MIN_FIELD_HA, boundsOf, cornersOf, fieldProblem, polygonFromCorners, ringAreaHa, ringCentroid, squareAround, type LngLat } from '../lib/geo';
import type { PictureProps } from '../results/FieldCard';
import { deriveFieldRequirements } from './fieldEquipment';
import { RotationQuestion, type CropsState, type HistoryState, type RotationAnswer, type RotationQuestionHandle } from './RotationQuestion';

const FieldEditorMap = lazy(() => import('../components/map/FieldEditorMap').then((module) => ({ default: module.FieldEditorMap })));

type SearchState = { status: 'idle' } | { status: 'searching' } | { status: 'done'; places: Place[] } | { status: 'failed' };
type Problems = { field?: string; water?: string; priorities?: string };

const LAST = SETUP_STEPS.length - 1;
const CUSTOM_OPTION = '__custom__';
const NEEDS_FIELD = 'Mark your field first: search for your place, or tap its corners on the map.';

interface SetupScreenProps extends PictureProps {
  initialStep: number;
  /** The field last checked, to start from when coming back from the results. */
  field: FieldPlan | null;
  coverage: CoverageState;
  history: HistoryState;
  crops: CropsState;
  farm: FarmDraft;
  onFarmChange: (draft: FarmDraft) => void;
  rotationYears: RotationYear[] | null;
  rotationConfirmed: boolean;
  /** There are results to go back to. */
  canLeave: boolean;
  /** Forgets the saved field, its answers and its results. */
  onRemoveField: () => void;
  onCheckField: (field: FieldPlan) => void;
  onRetryCrops: () => void;
  onRetryHistory: () => void;
  onCompare: (fieldName: string | null, draft: FarmDraft, rotation: RotationAnswer) => void;
}

const shapeKey = (corners: LngLat[]) => JSON.stringify(corners);
const hectaresOf = (corners: LngLat[]) => formatHectares(ringAreaHa(corners));

/** Four short steps. The first covers the field boundary and its water supply. */
export function SetupScreen(props: SetupScreenProps) {
  const { initialStep, pictures, pictureChoice, theme, field, coverage, history, crops, farm, onFarmChange, rotationYears, rotationConfirmed, canLeave } = props;
  const { onPictureChange, onCheckField, onRetryCrops, onRetryHistory, onCompare } = props;
  const meta = useMeta();
  const ids = useId();
  const startCorners = field ? cornersOf(field.geometry) : [];
  const [step, setStep] = useState(initialStep);
  const [waterOpen, setWaterOpen] = useState(true);
  const [corners, setCorners] = useState<LngLat[]>(startCorners);
  const [checkedShape, setCheckedShape] = useState<string | null>(field ? shapeKey(startCorners) : null);
  const initialName = cleanPlaceName(field?.name) ?? '';
  const [name, setName] = useState(initialName);
  const manualNameRef = useRef(Boolean(initialName));
  const [pickedPlaceLabel, setPickedPlaceLabel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<MapView | null>(() => (startCorners.length >= 3 ? { bounds: boundsOf(polygonFromCorners(startCorners)) } : null));
  const [mapCentre, setMapCentre] = useState<LngLat>([0, 20]);
  const [squareHa, setSquareHa] = useState('');
  /** Where the square was last placed. While set, changing the size redraws it at once. */
  const [squareCentre, setSquareCentre] = useState<LngLat | null>(null);
  const [countryCode, setCountryCode] = useState('');
  const [stateName, setStateName] = useState('');
  const [customState, setCustomState] = useState(false);
  const [cityName, setCityName] = useState('');
  const [customCity, setCustomCity] = useState(false);
  const [street, setStreet] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [reqCropId, setReqCropId] = useState('');
  const [coordText, setCoordText] = useState('');
  const [coordError, setCoordError] = useState<string | null>(null);
  const [coordsOpen, setCoordsOpen] = useState(!geocoderUrl);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
  const [errors, setErrors] = useState<Problems>({});
  const [removing, setRemoving] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  // The safe choice takes focus, so a stray Enter keeps the field.
  useEffect(() => {
    if (removing) keepRef.current?.focus();
  }, [removing]);
  /** Action waiting for the field coverage check or crop list before moving on. */
  const [pending, setPending] = useState<null | 'next'>(null);
  const [submitting, setSubmitting] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const rotationRef = useRef<RotationQuestionHandle>(null);

  const problem = fieldProblem(corners);
  const hasCorners = corners.length >= 3;
  const lookingAt = hasCorners ? ringCentroid(corners) : mapCentre;
  const dropdownPlace = cityName.trim() && countryCode ? `${cityName.trim()}, ${COUNTRY_BY_CODE[countryCode]}` : '';
  const resolvedCornerPlace = useResolvedPlace(lookingAt[1], lookingAt[0], null, hasCorners, '');
  const locationLabel = hasCorners
    ? resolvedCornerPlace || pickedPlaceLabel || dropdownPlace || 'Marked field'
    : pickedPlaceLabel || dropdownPlace || offlineCityCountry(mapCentre[1], mapCentre[0]) || 'Not chosen yet';
  const effectiveFieldName = cleanPlaceName(name) || resolvedCornerPlace || pickedPlaceLabel || dropdownPlace || null;
  const { shown, picture, backdrop, choiceMissing, reportFailure } = usePicture(pictures, pictureChoice, likelyScopes(lookingAt), lookingAt);
  // A shape that changed after it was checked has to be checked again: the data that covers it may differ.
  const checked = checkedShape === shapeKey(corners);
  const covered = checked && coverage.status === 'ready' ? coverage.coverage : null;
  const checking = checked && coverage.status === 'checking';
  const failure = checked && coverage.status === 'failed' ? coverage.error : null;

  const missing = covered ? covered.datasets.filter((dataset) => dataset.status !== 'available') : [];
  const found = covered ? coveredCount(covered.datasets) : 0;

  if (pending === 'next' && (covered || failure)) {
    setPending(null);
    if (covered) setStep(1);
  }

  if (submitting && crops.status === 'failed') {
    setSubmitting(false);
  }

  useEffect(() => {
    if (!submitting || crops.status !== 'ready') return;
    const rotation = rotationRef.current?.resolve();
    if (rotation) {
      onCompare(effectiveFieldName, farm, rotation);
      return;
    }
    queueMicrotask(() => setSubmitting(false));
  }, [submitting, crops.status, farm, effectiveFieldName, onCompare]);

  // A new step is a new page in all but name: start at its top, with focus on the title.
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    titleRef.current?.focus({ preventScroll: true });
  }, [step]);

  const show = setStep;

  // On a phone the map sits above the ways of finding a field. Bring it into view once there is something to see.
  const showOnMap = (bounds: MapView['bounds']) => {
    setView({ bounds });
    mapRef.current?.scrollIntoView({ block: 'nearest' });
  };

  const check = (shape: LngLat[], label: string | null) => {
    setCheckedShape(shapeKey(shape));
    onCheckField({ name: cleanPlaceName(label), geometry: polygonFromCorners(shape) });
  };

  const replaceShape = (next: LngLat[], label: string, edit = false) => {
    setPending(null);
    setCorners(next);
    setName(label);
    setAdding(false);
    setEditing(edit && next.length > 0);
    setSelected(null);
    setErrors({});
    if (next.length >= 3) showOnMap(boundsOf(polygonFromCorners(next)));
  };

  const stateOptions = countryCode ? (REGIONS_BY_COUNTRY[countryCode] ?? []) : [];
  const cityOptions = countryCode && stateName ? (CITIES_BY_REGION[countryCode]?.[stateName] ?? []) : [];
  const useStateSelect = countryCode === '' || (!customState && stateOptions.length > 0);
  const useCitySelect = countryCode === '' || (!customCity && (!stateName && useStateSelect ? true : cityOptions.length > 0));

  const handleCountryChange = (nextCode: string) => {
    setCountryCode(nextCode);
    setStateName('');
    setCustomState(false);
    setCityName('');
    setCustomCity(false);
    setPostalCode('');
    setPickedPlaceLabel(null);
    if (!manualNameRef.current) setName('');
    setAddressError(null);
  };

  const handleStateSelect = (value: string) => {
    setAddressError(null);
    setPostalCode('');
    setPickedPlaceLabel(null);
    if (!manualNameRef.current) setName('');
    if (value === CUSTOM_OPTION) {
      setCustomState(true);
      setStateName('');
      setCityName('');
      setCustomCity(false);
      return;
    }
    setCustomState(false);
    setStateName(value);
    setCityName('');
    setCustomCity(false);
  };

  const handleCitySelect = (value: string) => {
    setAddressError(null);
    setPickedPlaceLabel(null);
    if (value === CUSTOM_OPTION) {
      setCustomCity(true);
      setCityName('');
      setPostalCode('');
      if (!manualNameRef.current) setName('');
      return;
    }
    setCustomCity(false);
    setCityName(value);
    setPostalCode(lookupPostalCode(countryCode, stateName, value));
    if (!manualNameRef.current && value && countryCode) setName(`${value}, ${COUNTRY_BY_CODE[countryCode]}`);
  };

  const applyPlace = (place: Place) => {
    if (!postalCode.trim() && place.postalCode) setPostalCode(place.postalCode);
    const cityCountry = place.shortLabel ?? (dropdownPlace || offlineCityCountry(place.centre[1], place.centre[0]));
    if (cityCountry) {
      setPickedPlaceLabel(cityCountry);
      if (!manualNameRef.current) setName(cityCountry);
    }
    showOnMap(place.bounds);
  };

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    const hasAddress = Boolean(countryCode || stateName.trim() || cityName.trim() || street.trim() || postalCode.trim());
    if (!hasAddress) {
      setAddressError('Select a country or enter a city, street, or postal code.');
      return;
    }
    setAddressError(null);
    setSearch({ status: 'searching' });
    try {
      const places = await searchPlaces({
        countryCode: countryCode || undefined,
        country: countryCode ? COUNTRY_BY_CODE[countryCode] : undefined,
        state: stateName.trim() || undefined,
        city: cityName.trim() || undefined,
        street: street.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
      });
      setSearch({ status: 'done', places });
      if (places.length === 1) applyPlace(places[0]);
    } catch {
      setSearch({ status: 'failed' });
    }
  };

  const handleCoordSearch = (event: FormEvent) => {
    event.preventDefault();
    const place = parseCoordinates(coordText);
    if (!place) {
      setCoordError('Enter latitude and longitude as two numbers, for example 38.05, -100.95.');
      return;
    }
    setCoordError(null);
    if (place.shortLabel) {
      setPickedPlaceLabel(place.shortLabel);
      if (!manualNameRef.current) setName(place.shortLabel);
    }
    setSearch({ status: 'done', places: [place] });
    showOnMap(place.bounds);
    if (!place.shortLabel) {
      const [lon, lat] = place.centre;
      reversePlace(lat, lon).then((label) => {
        if (!label) return;
        setPickedPlaceLabel(label);
        if (!manualNameRef.current) setName((current) => current || label);
        setSearch((current) => (current.status === 'done' ? { status: 'done', places: [{ ...place, label, shortLabel: label }] } : current));
      });
    }
  };

  const drawSquare = (centre: LngLat, text: string) => {
    const size = Number(text);
    if (!Number.isFinite(size) || size < MIN_FIELD_HA || size > MAX_FIELD_HA) return false;
    const label = manualNameRef.current ? name : (offlineCityCountry(centre[1], centre[0]) ?? pickedPlaceLabel ?? (dropdownPlace || cleanPlaceName(name) || ''));
    if (!manualNameRef.current && label) setPickedPlaceLabel(label);
    replaceShape(cornersOf(squareAround(centre, size)), label, true);
    setSquareCentre(centre);
    return true;
  };

  const placeSquare = (event: FormEvent) => {
    event.preventDefault();
    if (!drawSquare(mapCentre, squareHa)) setErrors({ field: `Type a field size between ${MIN_FIELD_HA} and ${formatNumber(MAX_FIELD_HA)} hectares.` });
  };

  const resizeSquare = (text: string) => {
    setSquareHa(text);
    if (squareCentre) drawSquare(squareCentre, text);
  };

  const removeCorner = (index: number) => {
    setCorners((current) => current.filter((_, position) => position !== index));
    setSelected(corners.length > 1 ? Math.max(0, index - 1) : null);
  };

  const addCornerAfter = (index: number) => {
    const next = corners[(index + 1) % corners.length];
    const midpoint: LngLat = [(corners[index][0] + next[0]) / 2, (corners[index][1] + next[1]) / 2];
    setCorners((current) => [...current.slice(0, index + 1), midpoint, ...current.slice(index + 1)]);
    setSelected(index + 1);
  };

  const WATER_NEEDED = 'Choose how the field gets its water.';
  const PRIORITY_NEEDED = 'Choose at least one thing that matters to you.';
  const selectedWaterOption = farm.water ? WATER_OPTIONS.find((option) => option.value === farm.water) ?? null : null;

  const useField = () => {
    if (problem) return setErrors({ field: FIELD_PROBLEM_COPY[problem] });
    if (farm.water === null) {
      setWaterOpen(true);
      return setErrors({ water: WATER_NEEDED });
    }
    setAdding(false);
    setEditing(false);
    if (covered) return show(1);
    setPending('next');
    if (!checking) check(corners, effectiveFieldName);
  };

  const update = (change: Partial<FarmDraft>) => onFarmChange({ ...farm, ...change });
  const clearError = (key: keyof Problems) => setErrors((current) => ({ ...current, [key]: undefined }));
  const { equipmentOptions, cropRequirements } = deriveFieldRequirements(crops, meta.equipment);
  const ownedIds = farm.equipment ?? [];
  const equipMode =
    farm.equipment === null
      ? 'not_sure'
      : equipmentOptions.length > 0 && equipmentOptions.every((item) => ownedIds.includes(item.id))
        ? 'all_field'
        : 'custom';
  const remainingEquipment = equipmentOptions.filter((item) => !ownedIds.includes(item.id));
  const selectedEquipment = equipmentOptions.filter((item) => ownedIds.includes(item.id));
  // The comparison needs at least one cash or forage crop the farmer can plant and harvest.
  const mainCrops = cropRequirements.filter((crop) => crop.category === 'cash' || crop.category === 'forage');
  const workableCrops = mainCrops.filter((crop) => farm.equipment === null || crop.equipmentIds.every((id) => ownedIds.includes(id)));
  const equipmentBlocks = crops.status === 'ready' && mainCrops.length > 0 && workableCrops.length === 0;
  const equipmentProblem = `${ownedIds.length === 0 ? 'With no machines chosen' : 'With only these machines'}, none of the ${mainCrops.length} crops for this field can be planted and harvested. Add the machines you can own, hire or borrow, or choose “Not sure”.`;
  const focusedCrop = reqCropId ? (cropRequirements.find((crop) => crop.id === reqCropId) ?? null) : null;
  const unranked = meta.priorities.filter((priority) => !farm.priorities.includes(priority.id as Priority));

  const handleEquipModeChange = (value: string) => {
    if (value === 'not_sure') {
      update({ equipment: null });
      return;
    }
    if (value === 'all_field') {
      update({ equipment: equipmentOptions.map((item) => item.id) });
      return;
    }
    update({ equipment: farm.equipment ?? [] });
  };

  const addEquipment = (id: string) => {
    if (!id) return;
    const item = id as Equipment;
    if (!ownedIds.includes(item)) update({ equipment: [...ownedIds, item] });
  };

  const removeEquipment = (item: Equipment) => {
    update({ equipment: ownedIds.filter((existing) => existing !== item) });
  };

  const movePriority = (index: number, by: -1 | 1) => {
    const next = [...farm.priorities];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    update({ priorities: next });
  };

  const next = () => {
    if (step === 1 && equipmentBlocks) return;
    if (step === 2 && farm.priorities.length === 0) return setErrors({ priorities: PRIORITY_NEEDED });
    show(step + 1);
  };

  const jump = (target: number) => {
    if (target > 0 && covered === null) {
      setErrors({ field: NEEDS_FIELD });
      return show(0);
    }
    show(target);
  };

  const compare = () => {
    if (covered === null) {
      setErrors({ field: NEEDS_FIELD });
      return show(0);
    }
    if (farm.water === null) {
      setWaterOpen(true);
      setErrors({ water: WATER_NEEDED });
      return show(0);
    }
    if (equipmentBlocks) return show(1);
    if (farm.priorities.length === 0) {
      setErrors({ priorities: PRIORITY_NEEDED });
      return show(2);
    }
    if (crops.status === 'loading' && (!covered.crop_history_available || rotationYears !== null)) {
      setSubmitting(true);
      return;
    }
    const rotation = rotationRef.current?.resolve();
    if (rotation) onCompare(effectiveFieldName, farm, rotation);
  };

  const marked = corners.length >= 3 && !problem;
  let status = adding ? 'Tap the map to mark the first corner.' : 'No corners marked yet.';
  if (corners.length > 0) status = marked ? `${corners.length} corners marked, about ${hectaresOf(corners)} hectares` : `${corners.length} ${corners.length === 1 ? 'corner' : 'corners'} marked. ${problem ? FIELD_PROBLEM_COPY[problem] : ''}`;

  const fieldStep = (
    <>
      <div className="row">
        <Card className="wide" title="Mark your field on the map">
          {geocoderUrl && (
            <form role="search" className="address-form" onSubmit={handleSearch} aria-label="Find your place by address">
              <div className="address-grid">
                <div className="field">
                  <label htmlFor={`${ids}-country`}>Country</label>
                  <select id={`${ids}-country`} autoComplete="country" value={countryCode} onChange={(event) => handleCountryChange(event.target.value)}>
                    <option value="">Select country</option>
                    <optgroup label="Common agricultural regions">
                      {FEATURED_COUNTRIES.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="All countries">
                      {OTHER_COUNTRIES.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                <div className="field">
                  <div className="field__head">
                    <label htmlFor={`${ids}-state`}>Province / State</label>
                    {customState && stateOptions.length > 0 && (
                      <button
                        type="button"
                        className="link-button field__toggle"
                        onClick={() => {
                          setCustomState(false);
                          setStateName('');
                          setCityName('');
                          setCustomCity(false);
                        }}
                      >
                        Pick from list
                      </button>
                    )}
                  </div>
                  {useStateSelect ? (
                    <select id={`${ids}-state`} autoComplete="address-level1" value={stateName} disabled={!countryCode} onChange={(event) => handleStateSelect(event.target.value)}>
                      <option value="">{countryCode ? 'Select province or state' : 'Select a country first'}</option>
                      {stateOptions.map((region) => (
                        <option key={region} value={region}>
                          {region}
                        </option>
                      ))}
                      {countryCode && <option value={CUSTOM_OPTION}>Other (type manually)…</option>}
                    </select>
                  ) : (
                    <input
                      id={`${ids}-state`}
                      type="text"
                      autoComplete="address-level1"
                      value={stateName}
                      placeholder="Province, state, or region"
                      onChange={(event) => {
                        setStateName(event.target.value);
                        setAddressError(null);
                      }}
                    />
                  )}
                </div>

                <div className="field">
                  <div className="field__head">
                    <label htmlFor={`${ids}-city`}>City / Town</label>
                    {customCity && cityOptions.length > 0 && (
                      <button
                        type="button"
                        className="link-button field__toggle"
                        onClick={() => {
                          setCustomCity(false);
                          setCityName('');
                        }}
                      >
                        Pick from list
                      </button>
                    )}
                  </div>
                  {useCitySelect ? (
                    <select
                      id={`${ids}-city`}
                      autoComplete="address-level2"
                      value={cityName}
                      disabled={!countryCode || (!stateName && stateOptions.length > 0)}
                      onChange={(event) => handleCitySelect(event.target.value)}
                    >
                      <option value="">{!countryCode ? 'Select a country first' : !stateName && stateOptions.length > 0 ? 'Select province first' : 'Select city or town'}</option>
                      {cityOptions.map((town) => (
                        <option key={town} value={town}>
                          {town}
                        </option>
                      ))}
                      {cityOptions.length > 0 && <option value={CUSTOM_OPTION}>Other city or town…</option>}
                    </select>
                  ) : (
                    <input
                      id={`${ids}-city`}
                      type="text"
                      autoComplete="address-level2"
                      value={cityName}
                      placeholder="City, town, or village"
                      onChange={(event) => {
                        setCityName(event.target.value);
                        setAddressError(null);
                      }}
                    />
                  )}
                </div>

                <div className="field">
                  <label htmlFor={`${ids}-postal`}>Postal code</label>
                  <input
                    id={`${ids}-postal`}
                    type="text"
                    autoComplete="postal-code"
                    value={postalCode}
                    placeholder="Auto-filled from city (or type)"
                    onChange={(event) => {
                      setPostalCode(event.target.value);
                      setAddressError(null);
                    }}
                  />
                </div>

                <div className="field address-grid__wide">
                  <label htmlFor={`${ids}-street`}>Street</label>
                  <input
                    id={`${ids}-street`}
                    type="text"
                    autoComplete="street-address"
                    value={street}
                    placeholder="Street, road, or rural route (optional)"
                    onChange={(event) => {
                      setStreet(event.target.value);
                      setAddressError(null);
                    }}
                  />
                </div>
              </div>

              {addressError && <p className="form-error">{addressError}</p>}

              <div className="button-row address-form__actions">
                <button type="submit" className="button button--primary">
                  Search
                </button>
                {(countryCode || stateName || cityName || street || postalCode) && (
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setCountryCode('');
                      setStateName('');
                      setCustomState(false);
                      setCityName('');
                      setCustomCity(false);
                      setStreet('');
                      setPostalCode('');
                      setPickedPlaceLabel(null);
                      if (!manualNameRef.current) setName('');
                      setAddressError(null);
                      setSearch({ status: 'idle' });
                    }}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  className="button"
                  aria-expanded={coordsOpen}
                  aria-controls={`${ids}-coord-form`}
                  onClick={() => setCoordsOpen((open) => !open)}
                >
                  Or enter latitude and longitude
                </button>
              </div>
            </form>
          )}

          {(coordsOpen || !geocoderUrl) && (
            <form id={`${ids}-coord-form`} className="field coord-fallback__form" onSubmit={handleCoordSearch}>
              <label htmlFor={`${ids}-coords`}>Latitude and longitude</label>
              <div className="input-row">
                <input
                  id={`${ids}-coords`}
                  type="text"
                  inputMode="decimal"
                  value={coordText}
                  placeholder="For example 38.05, -100.95"
                  onChange={(event) => {
                    setCoordText(event.target.value);
                    if (coordError) setCoordError(null);
                  }}
                />
                <button type="submit" className="button">
                  Go
                </button>
              </div>
              {coordError && <p className="form-error">{coordError}</p>}
            </form>
          )}

          <div role="status">
            {search.status === 'searching' && <p className="secondary">Searching…</p>}
            {search.status === 'failed' && <p className="form-error">Place search is not answering. Open latitude and longitude above to type coordinates instead.</p>}
            {search.status === 'done' && search.places.length === 0 && <p className="secondary">We found no place matching that address. Try a nearby town, or enter latitude and longitude.</p>}
          </div>
          {search.status === 'done' && search.places.length > 0 && (
            <ul className="places">
              {search.places.map((place) => (
                <li key={`${place.label}-${place.centre.join()}`}>
                  <button type="button" className="button" onClick={() => applyPlace(place)}>
                    {place.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div ref={mapRef}>
            <MapBoundary>
              <Suspense
                fallback={
                  <p className="map-frame map-frame__fallback" role="status">
                    Loading the map…
                  </p>
                }
              >
                <FieldEditorMap
                  corners={corners}
                  adding={adding}
                  showHandles={adding || editing}
                  selected={selected}
                  imagery={picture}
                  backdrop={backdrop}
                  theme={theme}
                  view={view}
                  onAddCorner={(corner) => setCorners((current) => [...current, corner])}
                  onMoveCorner={(index, corner) => setCorners((current) => current.map((existing, position) => (position === index ? corner : existing)))}
                  onRemoveCorner={removeCorner}
                  onSelect={setSelected}
                  onCentreChange={setMapCentre}
                  onImageryError={reportFailure}
                />
              </Suspense>
            </MapBoundary>
          </div>
          <div className="button-row" role="group" aria-label="Field edge tools">
            <button
              type="button"
              className="button"
              aria-pressed={adding}
              onClick={() => {
                setAdding((current) => !current);
                setEditing(false);
              }}
            >
              Add corners
            </button>
            <button
              type="button"
              className="button"
              aria-pressed={editing}
              disabled={corners.length === 0}
              onClick={() => {
                setEditing((current) => !current);
                setAdding(false);
              }}
            >
              Move corners
            </button>
            <button
              type="button"
              className="button"
              disabled={corners.length === 0}
              onClick={() => {
                setSquareCentre(null);
                replaceShape([], name);
              }}
            >
              Start over
            </button>
            {adding && corners.length > 0 && (
              <button type="button" className="button" onClick={() => removeCorner(corners.length - 1)}>
                Undo last corner
              </button>
            )}
            {selected !== null && corners.length >= 2 && (
              <button type="button" className="button" onClick={() => addCornerAfter(selected)}>
                Add a corner after corner {selected + 1}
              </button>
            )}
            {selected !== null && (
              <button type="button" className="button" onClick={() => removeCorner(selected)}>
                Remove corner {selected + 1}
              </button>
            )}
          </div>
          <p className="marked" role="status">
            {marked && <CheckIcon />}
            {status}
          </p>
          <p className="caption">
            Tap each corner of your field. Drag a yellow dot to move it. <PhotoCredit shown={shown} />
          </p>
          <ImageryPicker pictures={pictures} choice={pictureChoice} shown={shown} backdrop={backdrop} choiceMissing={choiceMissing} onChange={onPictureChange} />
        </Card>

        <Card className="narrow" title="Where is your field?">
          <p className="secondary">Search for your place, or tap the corners on the map.</p>
          <form className="field" onSubmit={placeSquare}>
            <label htmlFor={`${ids}-size`}>Don’t want to draw it?</label>
            <p id={`${ids}-size-help`} className="caption">
              Type the field size and we’ll place a square in the middle of the map.
            </p>
            <div className="input-row">
              <input id={`${ids}-size`} type="number" inputMode="decimal" min={MIN_FIELD_HA} max={MAX_FIELD_HA} step="0.5" value={squareHa} aria-describedby={`${ids}-size-help`} onChange={(event) => resizeSquare(event.target.value)} />
              <span>hectares</span>
              <button type="submit" className="button">
                Place square
              </button>
            </div>
          </form>
          <div className="field">
            <label htmlFor={`${ids}-name`}>Name this field (optional)</label>
            <input
              id={`${ids}-name`}
              type="text"
              maxLength={80}
              value={name}
              placeholder={locationLabel !== 'Not chosen yet' ? locationLabel : 'e.g. North quarter'}
              onChange={(event) => {
                const next = event.target.value;
                manualNameRef.current = next.trim().length > 0;
                setName(next);
              }}
            />
          </div>
          <dl className="panel summary-list">
            <div>
              <dt>Field size</dt>
              <dd>{corners.length >= 3 ? `${hectaresOf(corners)} hectares` : 'Not marked yet'}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{locationLabel}</dd>
            </div>
            <div>
              <dt>Data we could find</dt>
              <dd>{covered ? `${found} of ${covered.datasets.length} sources` : checking ? 'Checking…' : 'Not checked yet'}</dd>
            </div>
          </dl>
          <details className="drawer water-drawer" open={waterOpen} onToggle={(event) => setWaterOpen(event.currentTarget.open)}>
            <summary>
              <span className="drawer__title">How does this field get water?</span>
              {selectedWaterOption && <span className="drawer__count">{selectedWaterOption.label}</span>}
            </summary>
            <div className="drawer__body">
              <div className="water-drawer__question" aria-describedby={errors.water ? `${ids}-water-error` : undefined}>
                <Segmented<WaterAvailability | ''>
                  legend="Water"
                  hideLegend
                  stack="always"
                  options={WATER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  value={farm.water ?? ''}
                  onChange={(water) => {
                    if (water !== '') update({ water });
                    clearError('water');
                  }}
                />
                {selectedWaterOption && <p className="secondary">{selectedWaterOption.help}</p>}
                {errors.water && (
                  <p className="form-error" role="alert" id={`${ids}-water-error`}>
                    {errors.water}
                  </p>
                )}
              </div>
            </div>
          </details>
          {errors.field && (
            <p className="form-error" role="alert">
              {errors.field}
            </p>
          )}
          {failure && (
            <p className="form-error" role="alert">
              {failure.problem.detail}
            </p>
          )}
          <div className="stack stack--tight">
            <button type="button" className="button button--primary button--full" disabled={checking && pending !== null} onClick={useField}>
              {checking && pending === 'next' ? 'Checking your field…' : 'Use this field'}
            </button>
            <p className="caption">Next: {NEXT_STEP_WORDS[0]}</p>
          </div>
        </Card>
      </div>

      <Card title="Data for this field">
        {covered ? (
          <>
            <p>
              {found === 0
                ? `None of our ${covered.datasets.length} sources cover this spot, so we can’t compare rotations here. Try a different place.`
                : `${found} of our ${covered.datasets.length} sources cover this spot. That is enough to compare rotations. Where a source is missing, we say what we use instead.`}
            </p>
            {missing.length > 0 && (
              <Drawer title={`${missing.length} ${missing.length === 1 ? 'source that doesn’t' : 'sources that don’t'} cover this field`}>
                <SourceList datasets={missing} />
              </Drawer>
            )}
          </>
        ) : checking ? (
          <CardState kind="loading" title="Checking which data covers this field…" />
        ) : failure ? (
          <CardState kind="error" title="We could not check the data for this field." action={failure.retryable ? { label: 'Try again', run: () => check(corners, effectiveFieldName) } : undefined}>
            {failure.problem.detail}
          </CardState>
        ) : (
          <CardState kind="empty" title="No field marked yet">
            Mark your field, then press “Use this field”. We then check which of our sources cover it.
          </CardState>
        )}
      </Card>
    </>
  );

  const questions = (
    <Card className="question-card">
      {step === 1 && (
        <>
          <section className="question">
            <h2 className="card__title">What equipment can you use?</h2>
            <p className="secondary">
              {crops.status === 'ready'
                ? `Filtered for ${field?.name?.trim() || 'your marked field'}. Own, hire, or borrow.`
                : 'Own, hire, or borrow. We flag rotations that need equipment you do not have.'}
            </p>
            <div className="address-grid">
              <div className={equipMode === 'not_sure' ? 'field address-grid__wide' : 'field'}>
                <label htmlFor={`${ids}-equip-mode`}>Equipment access</label>
                <select id={`${ids}-equip-mode`} value={equipMode} onChange={(event) => handleEquipModeChange(event.target.value)}>
                  <option value="custom">Choose specific equipment</option>
                  <option value="all_field">Full set for this field ({equipmentOptions.length})</option>
                  <option value="not_sure">Not sure (do not filter)</option>
                </select>
              </div>
              {equipMode !== 'not_sure' && (
                <div className="field">
                  <label htmlFor={`${ids}-add-equip`}>Add equipment</label>
                  <select
                    id={`${ids}-add-equip`}
                    value=""
                    disabled={remainingEquipment.length === 0}
                    onChange={(event) => addEquipment(event.target.value)}
                  >
                    <option value="">
                      {remainingEquipment.length === 0 ? 'All field equipment added' : 'Select a machine…'}
                    </option>
                    {remainingEquipment.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.crops.length > 0
                          ? `${item.label} (${item.crops.length} ${item.crops.length === 1 ? 'crop' : 'crops'})`
                          : item.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            {equipMode !== 'not_sure' && selectedEquipment.length > 0 && (
              <ul className="equip-chips" aria-label="Selected equipment">
                {selectedEquipment.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="equip-chip"
                      title={item.description}
                      aria-label={`Remove ${item.label}`}
                      onClick={() => removeEquipment(item.id)}
                    >
                      <span>{item.label}</span>
                      <span className="equip-chip__x" aria-hidden="true">
                        ×
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {farm.equipment !== null && crops.status === 'ready' && mainCrops.length > 0 && !equipmentBlocks && (
              <p className="secondary" role="status">
                {workableCrops.length} of {mainCrops.length} crops for this field can be grown with these machines.
              </p>
            )}
            {equipmentBlocks && (
              <p className="form-error" role="alert">
                {equipmentProblem}
              </p>
            )}
          </section>

          <section className="question">
            <div className="field">
              <label htmlFor={`${ids}-req-crop`}>Check requirements by crop</label>
              {crops.status === 'loading' ? (
                <p className="secondary" role="status">
                  Loading crop requirements for your field…
                </p>
              ) : crops.status === 'failed' ? (
                <p className="secondary">Crop requirements could not be loaded for this location yet.</p>
              ) : (
                <select id={`${ids}-req-crop`} value={focusedCrop ? focusedCrop.id : ''} onChange={(event) => setReqCropId(event.target.value)}>
                  <option value="">Select a crop to check ({cropRequirements.length} suited)</option>
                  {cropRequirements.map((crop) => (
                    <option key={crop.id} value={crop.id}>
                      {crop.name} ({crop.equipmentLabels.length > 0 ? crop.equipmentLabels.join(', ') : 'No special equipment'})
                    </option>
                  ))}
                </select>
              )}
            </div>
            {focusedCrop && (() => {
              const missingIds = focusedCrop.equipmentIds.filter((id) => !ownedIds.includes(id));
              const missingLabels = equipmentOptions.filter((item) => missingIds.includes(item.id)).map((item) => item.label);
              const isReady = farm.equipment === null || missingIds.length === 0;
              const matchAlready =
                farm.equipment !== null &&
                focusedCrop.equipmentIds.length === ownedIds.length &&
                focusedCrop.equipmentIds.every((id) => ownedIds.includes(id));
              return (
                <div className="req-item">
                  <div className="req-item__main">
                    <div className="req-item__head">
                      <strong>{focusedCrop.name}</strong>
                      <span className={`pill ${isReady ? 'pill--good' : 'pill--care'}`}>
                        {farm.equipment === null
                          ? 'Not filtered'
                          : isReady
                            ? 'Fits your equipment'
                            : `Needs ${missingLabels.join(', ') || missingIds.join(', ')}`}
                      </span>
                    </div>
                    <p className="secondary">
                      Equipment: {focusedCrop.equipmentLabels.length > 0 ? focusedCrop.equipmentLabels.join(', ') : 'None needed'}
                      {focusedCrop.waterNeed ? ` · ${focusedCrop.waterNeed}` : ''}
                      {focusedCrop.nitrogenFixing ? ' · Fixes nitrogen' : ''}
                      {focusedCrop.grownLocally ? ' · Grown nearby' : ''}
                    </p>
                  </div>
                  {focusedCrop.equipmentIds.length > 0 && !matchAlready && (
                    <button type="button" className="button" onClick={() => update({ equipment: [...focusedCrop.equipmentIds] })}>
                      Match {focusedCrop.name}
                    </button>
                  )}
                </div>
              );
            })()}
          </section>

          <section className="question">
            <div className="address-grid">
              <div className="field">
                <label htmlFor={`${ids}-forage`}>Forage / livestock crop</label>
                <select
                  id={`${ids}-forage`}
                  value={farm.requireForage ? 'yes' : 'no'}
                  onChange={(event) => update({ requireForage: event.target.value === 'yes' })}
                >
                  <option value="no">No forage requirement</option>
                  <option value="yes">Need a forage crop</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={`${ids}-market`}>Crop market</label>
                <select
                  id={`${ids}-market`}
                  value={farm.localMarketOnly ? 'local' : 'any'}
                  onChange={(event) => update({ localMarketOnly: event.target.value === 'local' })}
                >
                  <option value="any">Any crop that fits</option>
                  <option value="local">Only crops grown nearby</option>
                </select>
              </div>
            </div>
          </section>
        </>
      )}

      {step === 2 && (
        <section className="question" aria-describedby={errors.priorities ? `${ids}-priorities-error` : undefined}>
          <h2 className="card__title">What matters most to you?</h2>
          <p className="secondary">Pick in order, most important first. One is enough.</p>
          {farm.priorities.length > 0 && (
            <ol className="ranking" aria-label="What matters to you, in order">
              {farm.priorities.map((priority, index) => {
                const label = PRIORITY_WORDS[priority];
                return (
                  <li key={priority} className="ranking__item">
                    <span className="ranking__place">{index + 1}</span>
                    <span className="ranking__label">{label}</span>
                    <span className="button-row">
                      <button type="button" className="button" aria-label={`Up: ${label}`} disabled={index === 0} onClick={() => movePriority(index, -1)}>
                        Up
                      </button>
                      <button type="button" className="button" aria-label={`Down: ${label}`} disabled={index === farm.priorities.length - 1} onClick={() => movePriority(index, 1)}>
                        Down
                      </button>
                      <button type="button" className="button" aria-label={`Remove: ${label}`} onClick={() => update({ priorities: farm.priorities.filter((existing) => existing !== priority) })}>
                        Remove
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {unranked.length > 0 && (
            <div className="choice-grid" role="group" aria-label="Add something that matters">
              {unranked.map((priority) => (
                <button
                  key={priority.id}
                  type="button"
                  className="button button--choice"
                  onClick={() => {
                    update({ priorities: [...farm.priorities, priority.id as Priority] });
                    clearError('priorities');
                  }}
                >
                  <strong>{PRIORITY_WORDS[priority.id as Priority]}</strong>
                  <span>{priority.description}</span>
                </button>
              ))}
            </div>
          )}
          {errors.priorities && (
            <p className="form-error" role="alert" id={`${ids}-priorities-error`}>
              {errors.priorities}
            </p>
          )}
        </section>
      )}

      {/* Kept mounted, so a rotation already entered survives a look back at an earlier step. */}
      <section className="question" hidden={step !== LAST}>
        <h2 className="card__title">What do you grow here now?</h2>
        {covered ? (
          <RotationQuestion
            key={`${covered.field.centroid.lat},${covered.field.centroid.lon}`}
            ref={rotationRef}
            coverage={covered}
            history={checked ? history : { status: 'idle' }}
            crops={crops}
            initialYears={rotationYears}
            initialConfirmed={rotationConfirmed}
            onRetryCrops={onRetryCrops}
            onRetryHistory={onRetryHistory}
          />
        ) : (
          <p className="secondary">Mark your field first. What the cropland map shows for it appears here.</p>
        )}
      </section>

      <div className="stack stack--tight">
        <div className="button-row">
          <button type="button" className="button" onClick={() => show(step - 1)}>
            Back
          </button>
          {step < LAST ? (
            <button type="button" className="button button--primary" onClick={next}>
              Next
            </button>
          ) : (
            <button type="button" className="button button--primary" disabled={submitting} onClick={compare}>
              {submitting ? 'Preparing comparison…' : 'Compare rotations'}
            </button>
          )}
        </div>
        {step < LAST && <p className="caption">Next: {NEXT_STEP_WORDS[step]}</p>}
      </div>
    </Card>
  );

  return (
    <>
      {canLeave && (
        <div className="leave-row">
          <a className="back-link" href="/results">
            Back to your results
          </a>
          {!removing && (
            <button type="button" className="link-button" onClick={() => setRemoving(true)}>
              Remove this field
            </button>
          )}
        </div>
      )}
      {canLeave && removing && (
        <div className="strip strip--care" role="group" aria-labelledby={`${ids}-remove`}>
          <p id={`${ids}-remove`} className="strip__body">
            Remove {field?.name?.trim() || 'this field'}? Its answers and results are cleared from this browser, and you start again with a new field.
          </p>
          <div className="button-row">
            <button type="button" className="button" onClick={props.onRemoveField}>
              Remove field
            </button>
            <button type="button" className="button" ref={keepRef} onClick={() => setRemoving(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
      <header className="page-head">
        <h1 className="page-title" ref={titleRef} tabIndex={-1}>
          {SETUP_TITLES[step]}
        </h1>
        <p className="lead">{sentenceCase(numberWord(SETUP_STEPS.length))} short questions. Your answers decide which rotations we compare for you.</p>
      </header>
      <nav aria-label="Steps">
        <ol className="stepper">
          {SETUP_STEPS.map((label, index) => (
            <li key={label}>
              <button type="button" className="stepper__step" aria-current={index === step ? 'step' : undefined} onClick={() => jump(index)}>
                <span className="stepper__number">{index + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="screen-part" hidden={step !== 0}>
        {fieldStep}
      </div>
      <div className="screen-part" hidden={step === 0}>
        {questions}
      </div>
      <Reminder />
    </>
  );
}

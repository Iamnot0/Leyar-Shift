import { useEffect, useId, useRef, useState } from 'react';
import type { FieldBriefing } from '../api/fieldBriefing';
import type {
  Analysis,
  Crop,
  CropFitCheck,
  Equipment,
  Label,
  RainfallScenario,
  TemperatureScenario,
  WaterAvailability,
} from '../api/types';
import { labelOf, useMeta } from '../app/context';
import { Card, CardState, Pill, type PillTone } from '../components/ui/kit';
import { HEAT_WORDS, RAIN_WORDS } from '../content/copy';
import { MONTHS } from '../lib/format';
import { bestOf, byRank, shortName } from '../results/reading';
import { REAL_RAIN_MM, degrees } from './words';

export type PredictionHorizon = 'week' | 'month' | 'year';

const WATER_SETUP_LABELS: Record<WaterAvailability, string> = {
  rain_fed: 'Rain only',
  limited: 'Some irrigation',
  reliable: 'Reliable irrigation',
};

const DEMAND_LABELS: Record<'low' | 'medium' | 'high', string> = {
  low: 'Low water demand',
  medium: 'Medium water demand',
  high: 'Needs steady water',
};

const SHORT_DEMAND: Record<'low' | 'medium' | 'high', string> = {
  low: 'Low water need',
  medium: 'Moderate water',
  high: 'Steady water',
};

const CATEGORY_LABELS: Record<Crop['category'], string> = {
  cash: 'Cash crop',
  forage: 'Forage crop',
  cover: 'Cover crop',
  fallow: 'Fallow',
};

const ROOT_LABELS: Record<'shallow' | 'medium' | 'deep', string> = {
  shallow: 'Shallow roots',
  medium: 'Medium-depth roots',
  deep: 'Deep roots',
};

const FIT_TONES: Record<CropFitCheck['status'], PillTone> = {
  fits: 'good',
  strained: 'care',
  does_not_fit: 'care',
  unknown: 'neutral',
};

const COLD_HARDY_IDS = new Set(['winter_wheat', 'small_grain', 'alfalfa', 'rye', 'triticale', 'oats']);
const WARM_TENDER_IDS = new Set(['corn', 'soybean', 'sorghum', 'cotton', 'sunflower', 'dry_beans', 'rice']);

interface CropRotationMatch {
  rank: number | null;
  name: string;
  benefits: string[];
  whySuggested: string[];
}

interface CropTimingMatch {
  verdict: string;
  good: boolean;
  reason: string;
  basis: string | null;
}

interface HorizonSnapshot {
  titleContext: string;
  asideLabel: string;
  asideTone: PillTone;
  intro: string;
  conditions: { label: string; value: string }[];
  dryBias: boolean;
  frostRisk: boolean;
  heatRisk: boolean;
  wetBias: boolean;
}

export interface SuggestedCropDetail {
  id: string;
  name: string;
  badge: { label: string; tone: PillTone };
  cardTraits: string[];
  whyFit: string[];
  timing: CropTimingMatch | null;
  crop: Crop;
  waterMatchNote: string;
  equipmentLabels: string[];
  missingEquipmentLabels: string[];
  fitChecks: CropFitCheck[];
  rotations: CropRotationMatch[];
}

function cleanCropName(name: string): string {
  return name.replace(/ \([^)]*\)$/, '');
}

function buildHorizonSnapshot(
  horizon: PredictionHorizon,
  briefing: FieldBriefing,
  water: WaterAvailability | null,
  scenario: { rainfall: RainfallScenario; temperature: TemperatureScenario },
): HorizonSnapshot {
  const waterPhrase = water ? WATER_SETUP_LABELS[water].toLowerCase() : 'your field setup';

  if (horizon === 'week') {
    const forecast = briefing.forecast;
    const advice = briefing.sowThisWeek;
    const conditions: { label: string; value: string }[] = [];
    let dryBias = water === 'rain_fed' || water === 'limited';
    let frostRisk = false;
    let heatRisk = false;
    let wetBias = false;
    let intro = `Matched to the next 7 days, soil moisture, and ${waterPhrase}.`;

    if (forecast.available && forecast.days.length > 0) {
      const weekDays = forecast.days.slice(0, 7);
      const totalRain = weekDays.reduce((sum, day) => sum + day.rainMm, 0);
      const lowC = Math.min(...weekDays.map((day) => day.lowC));
      const highC = Math.max(...weekDays.map((day) => day.highC));
      frostRisk = weekDays.some((day) => day.frost);
      heatRisk = weekDays.some((day) => day.heat);
      wetBias = totalRain >= 20;
      if (totalRain < REAL_RAIN_MM * 2) dryBias = true;
      const rainLabel = totalRain < REAL_RAIN_MM ? 'Dry (under 1 mm)' : `About ${Math.round(totalRain)} mm`;
      conditions.push({ label: 'Next 7 days rain', value: rainLabel });
      conditions.push({ label: 'Temperature range', value: `${degrees(lowC)} to ${degrees(highC)}` });
      if (frostRisk || heatRisk) {
        conditions.push({
          label: 'Weather watch',
          value: frostRisk && heatRisk ? 'Frost and strong heat' : frostRisk ? 'Frost expected' : 'Strong heat expected',
        });
      }
      const tempPhrase = `${degrees(lowC)} to ${degrees(highC)}`;
      const rainIntro = totalRain < REAL_RAIN_MM ? 'dry 7-day forecast' : `${Math.round(totalRain)} mm forecast rain`;
      intro = `Matched to the ${rainIntro} (${tempPhrase}${frostRisk ? ', with frost nights' : ''}) and ${waterPhrase}.`;
    }
    if (briefing.soilSurface.available) {
      const s = briefing.soilSurface;
      const soilWord =
        s.usualLow !== null && s.now < s.usualLow
          ? 'Drier than usual'
          : s.usualHigh !== null && s.now > s.usualHigh
            ? 'Wetter than usual'
            : 'Near usual';
      if (s.usualLow !== null && s.now < s.usualLow) dryBias = true;
      conditions.push({ label: 'Topsoil moisture', value: soilWord });
    }
    if (water) conditions.push({ label: 'Water supply', value: WATER_SETUP_LABELS[water] });

    const hasSowNow = advice.available && advice.crops.some((item) => item.good);
    return {
      titleContext: 'Next 7 days prediction',
      asideLabel: hasSowNow ? 'Sow this week' : 'Next 7 days',
      asideTone: hasSowNow ? 'good' : 'neutral',
      intro,
      conditions,
      dryBias,
      frostRisk,
      heatRisk,
      wetBias,
    };
  }

  if (horizon === 'month') {
    const month = briefing.monthOutlook;
    const advice = briefing.plantThisMonth;
    const conditions: { label: string; value: string }[] = [];
    let monthName = 'Next month';
    let dryBias = water !== 'reliable';
    let frostRisk = false;
    let wetBias = false;
    let intro = `Matched to next month’s outlook and ${waterPhrase}.`;

    if (month.available) {
      monthName = MONTHS[month.month - 1] ?? 'Next month';
      const rainMm = Math.round(month.rainMm.value);
      const coldestC = degrees(month.coldestNightC.value);
      const frostShare = month.frost.shareOfYears;
      frostRisk = (frostShare !== null && frostShare >= 0.25) || month.coldestNightC.value <= 2;
      if (month.rainMm.value < 25) dryBias = true;
      if (month.rainMm.value >= 50) wetBias = true;
      conditions.push({ label: `${monthName} rain`, value: `About ${rainMm} mm` });
      conditions.push({ label: 'Coldest nights', value: `About ${coldestC}` });
      conditions.push({ label: `Frost in ${monthName}`, value: month.frost.words });
      intro = `Matched to ${monthName} (${rainMm} mm usual rain, coldest nights around ${coldestC}) and ${waterPhrase}.`;
    }
    if (water) conditions.push({ label: 'Water supply', value: WATER_SETUP_LABELS[water] });

    const hasPlantNow = advice.available && advice.crops.some((item) => item.good);
    return {
      titleContext: `${monthName} prediction`,
      asideLabel: hasPlantNow ? `Good in ${monthName}` : monthName,
      asideTone: hasPlantNow ? 'good' : 'neutral',
      intro,
      conditions,
      dryBias,
      frostRisk,
      heatRisk: false,
      wetBias,
    };
  }

  const climate = briefing.yearClimate;
  const conditions: { label: string; value: string }[] = [];
  const dryBias =
    scenario.rainfall !== 'normal' ||
    water !== 'reliable' ||
    (climate.available && climate.dryYearMm !== null && climate.dryYearMm < 420);
  const heatRisk =
    scenario.temperature !== 'normal' ||
    (climate.available && climate.hotDaysPerYear !== null && climate.hotDaysPerYear >= 20);
  const frostRisk = climate.available && climate.frostDaysPerYear !== null && climate.frostDaysPerYear >= 30;
  let intro = `Matched to full-year rotations and ${waterPhrase}.`;

  if (climate.available) {
    const usualRain = Math.round(climate.usualRainMm);
    conditions.push({ label: 'Usual year rain', value: `About ${usualRain} mm` });
    if (climate.dryYearMm !== null) {
      conditions.push({ label: 'Dry year rain', value: `Under ${Math.round(climate.dryYearMm)} mm` });
    }
    if (climate.hotDaysPerYear !== null) {
      conditions.push({ label: 'Very hot days', value: `${Math.round(climate.hotDaysPerYear)} a year` });
    }
    const dryNote = climate.dryYearMm !== null ? `, under ${Math.round(climate.dryYearMm)} mm in a dry year` : '';
    intro = `Matched to ${usualRain} mm usual yearly rain${dryNote}, top-scoring rotations, and ${waterPhrase}.`;
  }
  conditions.push({
    label: 'Year scenario',
    value: `${RAIN_WORDS[scenario.rainfall]} rain, ${HEAT_WORDS[scenario.temperature].toLowerCase()} weather`,
  });
  if (water) conditions.push({ label: 'Water supply', value: WATER_SETUP_LABELS[water] });

  return {
    titleContext: 'This year prediction',
    asideLabel: 'Full year',
    asideTone: 'good',
    intro,
    conditions,
    dryBias,
    frostRisk,
    heatRisk,
    wetBias: false,
  };
}

function waterMatchMessage(demand: Crop['water_demand'], water: WaterAvailability | null): string {
  if (!demand) return 'Water need varies by variety and local sowing date.';
  if (!water) return `${DEMAND_LABELS[demand]}. Compare with your irrigation capacity.`;
  if (demand === 'low') return `Low water demand pairs well with ${WATER_SETUP_LABELS[water].toLowerCase()} and dry spells.`;
  if (demand === 'medium') {
    return water === 'rain_fed'
      ? 'Moderate water demand; relies on stored soil moisture under rain-only farming.'
      : `Fits ${WATER_SETUP_LABELS[water].toLowerCase()} with timely watering during dry spells.`;
  }
  return water === 'reliable'
    ? 'Higher moisture need supported by reliable irrigation.'
    : 'Needs steady water; yields drop sharply without reliable moisture at peak growth.';
}

function resolveCropBadge(
  horizon: PredictionHorizon,
  crop: Crop,
  timing: CropTimingMatch | null,
  inBest: boolean,
  inTop: boolean,
  snapshot: HorizonSnapshot,
): { label: string; tone: PillTone } {
  if (horizon === 'week' || horizon === 'month') {
    if (timing?.good) return { label: timing.verdict, tone: 'good' };
    if (timing?.verdict === 'Prep ahead') return { label: 'Prep ahead', tone: 'neutral' };
    if (timing?.verdict && timing.verdict !== 'Out of season') return { label: timing.verdict, tone: 'care' };
    if (snapshot.frostRisk && isColdHardy(crop)) return { label: 'Handles frost', tone: 'good' };
    if (snapshot.dryBias && crop.water_demand === 'low') return { label: 'Low water need', tone: 'good' };
    if (crop.nitrogen_fixing) return { label: 'Adds nitrogen', tone: 'good' };
    if (crop.water_demand === 'low') return { label: 'Saves water', tone: 'good' };
    if (inBest) return { label: 'Top rotation', tone: 'good' };
    return { label: crop.grown_locally ? 'Grown nearby' : 'Off-season now', tone: 'neutral' };
  }

  if (inBest) return { label: 'Best rotation crop', tone: 'good' };
  if (snapshot.dryBias && crop.water_demand === 'low') return { label: 'Dry-year fit', tone: 'good' };
  if (crop.nitrogen_fixing) return { label: 'Adds nitrogen', tone: 'good' };
  if (inTop) return { label: 'Top year option', tone: 'good' };
  if (crop.water_demand === 'low') return { label: 'Saves water', tone: 'good' };
  return { label: crop.grown_locally ? 'Grown nearby' : 'Local fit', tone: 'neutral' };
}

function isColdHardy(crop: Crop, fitChecks: CropFitCheck[] = []): boolean {
  const frostCheck = fitChecks.find((check) => check.check === 'frost');
  if (frostCheck?.status === 'fits' && WARM_TENDER_IDS.has(crop.id) === false) return true;
  return COLD_HARDY_IDS.has(crop.id) || crop.category === 'cover';
}

function pickSuggestedCrops(
  horizon: PredictionHorizon,
  crops: Crop[],
  analysis: Analysis | null,
  briefing: FieldBriefing,
  water: WaterAvailability | null,
  userEquipment: Equipment[] | null,
  equipmentCatalog: Label[],
  scenario: { rainfall: RainfallScenario; temperature: TemperatureScenario },
): { snapshot: HorizonSnapshot; items: SuggestedCropDetail[] } {
  const snapshot = buildHorizonSnapshot(horizon, briefing, water, scenario);
  const adviceReading = horizon === 'week' ? briefing.sowThisWeek : horizon === 'month' ? briefing.plantThisMonth : null;

  const rankedRotations = analysis ? byRank(analysis) : [];
  const best = analysis ? bestOf(analysis) : null;
  const bestCropIds = new Set(best?.years.map((year) => year.crop_id) ?? []);
  const topCropIds = new Set<string>();
  const rotationsByCrop = new Map<string, CropRotationMatch[]>();
  const fitChecksByCrop = new Map<string, CropFitCheck[]>();

  for (const rotation of rankedRotations) {
    const rotationName = shortName(rotation);
    const matchInfo: CropRotationMatch = {
      rank: rotation.overall.rank,
      name: rotationName,
      benefits: rotation.benefits.map((benefit) => benefit.text),
      whySuggested: rotation.why_suggested.map((reason) => reason.text),
    };
    const seenInRot = new Set<string>();
    for (const year of rotation.years) {
      for (const cropId of [year.crop_id, year.cover_crop_id]) {
        if (!cropId || cropId === 'fallow' || seenInRot.has(cropId)) continue;
        seenInRot.add(cropId);
        if (rotation.overall.rank !== null && rotation.overall.rank <= 3) {
          topCropIds.add(cropId);
        }
        const list = rotationsByCrop.get(cropId) ?? [];
        list.push(matchInfo);
        rotationsByCrop.set(cropId, list);
      }
    }
    for (const fit of rotation.crop_fit) {
      if (!fitChecksByCrop.has(fit.crop_id) && fit.checks.length > 0) {
        fitChecksByCrop.set(fit.crop_id, fit.checks);
      }
    }
  }

  const timingById = new Map<string, CropTimingMatch>();
  const timingByName = new Map<string, CropTimingMatch>();
  if (adviceReading && adviceReading.available) {
    for (const entry of adviceReading.crops) {
      const match: CropTimingMatch = {
        verdict: entry.verdict,
        good: entry.good,
        reason: entry.reason,
        basis: adviceReading.basis ?? null,
      };
      if (entry.crop_id) timingById.set(entry.crop_id, match);
      timingByName.set(cleanCropName(entry.name).toLowerCase(), match);
      timingByName.set(entry.name.toLowerCase(), match);
    }
  } else if (horizon === 'year') {
    for (const sourceAdvice of [briefing.sowThisWeek, briefing.plantThisMonth]) {
      if (!sourceAdvice.available) continue;
      for (const entry of sourceAdvice.crops) {
        const match: CropTimingMatch = {
          verdict: entry.verdict,
          good: entry.good,
          reason: entry.reason,
          basis: sourceAdvice.basis ?? null,
        };
        if (entry.crop_id && !timingById.has(entry.crop_id)) timingById.set(entry.crop_id, match);
        const key = cleanCropName(entry.name).toLowerCase();
        if (!timingByName.has(key)) timingByName.set(key, match);
      }
    }
  }

  const baseCandidates = crops.filter((crop) => crop.category !== 'fallow' && crop.suitable !== false);
  const poolMap = new Map<string, Crop>();
  for (const crop of baseCandidates) poolMap.set(crop.id, crop);

  if (adviceReading && adviceReading.available) {
    for (const entry of adviceReading.crops) {
      if (!entry.crop_id || entry.crop_id === 'fallow') continue;
      if (!poolMap.has(entry.crop_id)) {
        const fromAllCrops = crops.find((candidate) => candidate.id === entry.crop_id);
        if (fromAllCrops && fromAllCrops.suitable !== false) {
          poolMap.set(fromAllCrops.id, fromAllCrops);
        } else if (entry.good || entry.verdict === 'Prep ahead') {
          poolMap.set(entry.crop_id, {
            id: entry.crop_id,
            name: entry.name,
            category: 'cash',
            family: null,
            nitrogen_fixing: false,
            rooting_depth: null,
            water_demand: null,
            equipment: [],
            suitable: true,
            suitability_reason: entry.reason,
            grown_locally: null,
          });
        }
      }
    }
  }

  if (poolMap.size === 0) {
    for (const id of topCropIds) {
      poolMap.set(id, {
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1).replaceAll('_', ' '),
        category: 'cash',
        family: null,
        nitrogen_fixing: false,
        rooting_depth: null,
        water_demand: null,
        equipment: [],
        suitable: true,
        suitability_reason: 'Included in the top-scoring rotations for your field.',
        grown_locally: null,
      });
    }
  }

  const scored = Array.from(poolMap.values()).map((crop) => {
    const cleanName = cleanCropName(crop.name);
    const inBest = bestCropIds.has(crop.id);
    const inTop = topCropIds.has(crop.id);
    const timing = timingById.get(crop.id) ?? timingByName.get(cleanName.toLowerCase()) ?? timingByName.get(crop.name.toLowerCase()) ?? null;
    const fitChecks = fitChecksByCrop.get(crop.id) ?? [];
    const rotations = rotationsByCrop.get(crop.id) ?? [];
    const equipmentLabels = crop.equipment.map((eq) => labelOf(equipmentCatalog, eq));
    const missingEquipmentLabels =
      userEquipment === null
        ? []
        : crop.equipment.filter((eq) => !userEquipment.includes(eq)).map((eq) => labelOf(equipmentCatalog, eq));

    let priority = 0;
    if (horizon === 'week' || horizon === 'month') {
      if (timing?.good) priority += 60;
      else if (timing?.verdict === 'Prep ahead') priority += 32;
      else if (timing?.verdict === 'Out of season') priority -= 22;
      else if (timing) priority -= 8;

      if (snapshot.frostRisk) {
        if (isColdHardy(crop, fitChecks)) priority += 18;
        else if (WARM_TENDER_IDS.has(crop.id) && !timing?.good) priority -= 14;
      }
      if (snapshot.dryBias) {
        if (crop.water_demand === 'low') priority += 18;
        else if (crop.water_demand === 'high' && water !== 'reliable') priority -= 10;
        if (crop.rooting_depth === 'deep') priority += 8;
      } else if (snapshot.wetBias) {
        if (crop.water_demand === 'medium' || crop.category === 'cover') priority += 8;
      }
      if (crop.nitrogen_fixing) priority += 7;
      if (inBest) priority += 14;
      else if (inTop) priority += 7;
    } else {
      if (inBest) priority += 48;
      else if (inTop) priority += 26;
      if (snapshot.dryBias) {
        if (crop.water_demand === 'low') priority += 22;
        if (crop.rooting_depth === 'deep') priority += 12;
        if (crop.water_demand === 'high' && water !== 'reliable') priority -= 12;
      }
      if (snapshot.heatRisk) {
        const heatCheck = fitChecks.find((check) => check.check === 'heat');
        if (heatCheck?.status === 'fits') priority += 10;
        else if (heatCheck?.status === 'does_not_fit') priority -= 14;
        if (crop.water_demand === 'low') priority += 10;
      }
      if (crop.nitrogen_fixing) priority += 12;
      if (crop.grown_locally === true) priority += 6;
    }

    if (userEquipment !== null) {
      priority += missingEquipmentLabels.length === 0 ? 8 : -6;
    }
    if (crop.category === 'cash' || crop.category === 'forage') priority += 6;
    if (crop.grown_locally === true) priority += 4;

    const badge = resolveCropBadge(horizon, crop, timing, inBest, inTop, snapshot);
    const cardTraits: string[] = [];
    if (crop.water_demand) cardTraits.push(SHORT_DEMAND[crop.water_demand]);
    if (crop.nitrogen_fixing) cardTraits.push('Fixes nitrogen');
    if (crop.grown_locally === true) cardTraits.push('Grown nearby');
    else if (crop.rooting_depth === 'deep') cardTraits.push('Deep roots');
    if (cardTraits.length === 0) cardTraits.push(CATEGORY_LABELS[crop.category]);

    const whyFit: string[] = [];
    const addWhy = (text: string | null | undefined) => {
      const cleaned = text?.trim();
      if (cleaned && !whyFit.includes(cleaned)) whyFit.push(cleaned);
    };

    if (horizon === 'week' || horizon === 'month') {
      if (timing?.good) addWhy(`${timing.verdict}: ${timing.reason}`);
      else if (timing) addWhy(`${timing.verdict}: ${timing.reason}`);
      if (snapshot.frostRisk && isColdHardy(crop, fitChecks)) {
        addWhy('Cold-hardy option suited to cool nights or frost risk.');
      }
      if (snapshot.dryBias && crop.water_demand === 'low') {
        addWhy('Low water demand keeps yield steadier when rainfall is short.');
      }
    } else {
      for (const rot of rotations.slice(0, 2)) {
        if (rot.rank === 1) {
          addWhy(`Part of the #1 ranked rotation for your field (${rot.name}).`);
        }
        for (const msg of rot.whySuggested.slice(0, 1)) addWhy(msg);
        for (const msg of rot.benefits.slice(0, 1)) addWhy(msg);
      }
    }

    if (crop.nitrogen_fixing) addWhy('Adds natural nitrogen to the soil for the crop that follows.');
    if (crop.rooting_depth === 'deep') addWhy('Deep roots pull moisture from lower soil layers and loosen tight ground.');
    if (horizon !== 'year') {
      for (const rot of rotations.slice(0, 1)) {
        for (const msg of rot.benefits.slice(0, 1)) addWhy(msg);
      }
    }
    if (crop.suitability_reason) addWhy(crop.suitability_reason);
    if (whyFit.length === 0) {
      addWhy(inBest ? 'Matches top-scoring field rotation results.' : 'Matches local climate and soil conditions.');
    }

    return {
      priority,
      item: {
        id: crop.id,
        name: cleanName,
        badge,
        cardTraits: cardTraits.slice(0, 3),
        whyFit: whyFit.slice(0, 3),
        timing,
        crop,
        waterMatchNote: waterMatchMessage(crop.water_demand, water),
        equipmentLabels,
        missingEquipmentLabels,
        fitChecks,
        rotations: rotations.slice(0, 3),
      } satisfies SuggestedCropDetail,
    };
  });

  scored.sort((a, b) => b.priority - a.priority || a.item.name.localeCompare(b.item.name));
  return { snapshot, items: scored.slice(0, 4).map((entry) => entry.item) };
}

function CropDetailDialog({
  crop,
  snapshot,
  horizon,
  equipmentSet,
  onClose,
}: {
  crop: SuggestedCropDetail | null;
  snapshot: HorizonSnapshot;
  horizon: PredictionHorizon;
  equipmentSet: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const meta = useMeta();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (crop && !dialog.open) {
      dialog.showModal();
    } else if (!crop && dialog.open) {
      dialog.close();
    }
  }, [crop]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;
    let pressedOutside = false;
    const isOutside = (event: PointerEvent) => {
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };
    const onDown = (event: PointerEvent) => {
      pressedOutside = isOutside(event);
    };
    const onUp = (event: PointerEvent) => {
      if (pressedOutside && isOutside(event)) dialog.close();
      pressedOutside = false;
    };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('pointerup', onUp);
    return () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
    };
  }, []);

  const horizonNoun = horizon === 'week' ? 'next 7 days' : horizon === 'month' ? 'next month' : 'this year';

  return (
    <dialog
      ref={dialogRef}
      className="crop-dialog"
      closedby="any"
      aria-labelledby={titleId}
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = '';
        onClose();
      }}
    >
      {crop && (
        <div className="crop-dialog__panel">
          <header className="crop-dialog__head">
            <div className="crop-dialog__titles">
              <p className="crop-dialog__kicker">{snapshot.titleContext}</p>
              <div className="crop-dialog__title-row">
                <h3 id={titleId} className="crop-dialog__title">
                  {crop.name}
                </h3>
                <Pill tone={crop.badge.tone}>{crop.badge.label}</Pill>
              </div>
            </div>
            <button
              type="button"
              className="crop-dialog__close"
              onClick={() => dialogRef.current?.close()}
            >
              Close
            </button>
          </header>

          <section className="crop-dialog__hero" aria-label={`Why grow ${crop.name} for ${horizonNoun}`}>
            <h4 className="crop-dialog__section-title">Why grow this for {horizonNoun}</h4>
            <ul className="crop-dialog__reasons">
              {crop.whyFit.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {snapshot.conditions.length > 0 && (
              <dl className="crop-dialog__conditions">
                {snapshot.conditions.map((item) => (
                  <div key={item.label} className="crop-dialog__condition">
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section className="crop-dialog__section" aria-label="Crop and field profile">
            <h4 className="crop-dialog__section-title">Field and crop profile</h4>
            <dl className="crop-dialog__facts">
              <div className="crop-dialog__fact">
                <dt>Water demand</dt>
                <dd>{crop.crop.water_demand ? DEMAND_LABELS[crop.crop.water_demand] : 'Varies'}</dd>
                <dd className="crop-dialog__note">{crop.waterMatchNote}</dd>
              </div>

              <div className="crop-dialog__fact">
                <dt>Soil &amp; roots</dt>
                <dd>
                  {crop.crop.nitrogen_fixing ? 'Fixes nitrogen' : 'Uses soil nitrogen'}
                  {crop.crop.rooting_depth ? ` · ${ROOT_LABELS[crop.crop.rooting_depth]}` : ''}
                </dd>
                <dd className="crop-dialog__note">
                  {crop.crop.nitrogen_fixing
                    ? 'Leaves nitrogen behind for following crops.'
                    : crop.crop.rooting_depth === 'deep'
                      ? 'Deep roots reach lower moisture stores.'
                      : 'Pairs well when rotated with deep-rooted or nitrogen-fixing crops.'}
                </dd>
              </div>

              <div className="crop-dialog__fact">
                <dt>Equipment needed</dt>
                <dd>{crop.equipmentLabels.length > 0 ? crop.equipmentLabels.join(', ') : 'Standard field tools'}</dd>
                <dd className="crop-dialog__note">
                  {!equipmentSet
                    ? 'Equipment filter set to Not sure.'
                    : crop.missingEquipmentLabels.length === 0
                      ? 'All required machinery is in your selected setup.'
                      : `Missing from your list: ${crop.missingEquipmentLabels.join(', ')}.`}
                </dd>
              </div>

              <div className="crop-dialog__fact">
                <dt>Crop group &amp; local record</dt>
                <dd>
                  {CATEGORY_LABELS[crop.crop.category]}
                  {crop.crop.family ? ` (${crop.crop.family})` : ''}
                </dd>
                <dd className="crop-dialog__note">
                  {crop.crop.grown_locally === true
                    ? 'Commonly grown in surrounding county records.'
                    : crop.crop.grown_locally === false
                      ? 'Limited nearby acreage in regional records.'
                      : 'Check buyer demand and seed availability locally.'}
                </dd>
              </div>
            </dl>
          </section>

          {crop.fitChecks.length > 0 && (
            <section className="crop-dialog__section" aria-label="Field suitability checks">
              <h4 className="crop-dialog__section-title">Checks on your field</h4>
              <ul className="crop-dialog__checks">
                {crop.fitChecks.map((check) => (
                  <li key={check.check} className="crop-dialog__check">
                    <div className="crop-dialog__check-head">
                      <strong>{labelOf(meta.crop_fit_checks, check.check)}</strong>
                      <Pill tone={FIT_TONES[check.status]}>{labelOf(meta.crop_fit_statuses, check.status)}</Pill>
                    </div>
                    <p>{check.text}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {crop.rotations.length > 0 && (
            <section className="crop-dialog__section" aria-label="Rotations with this crop">
              <h4 className="crop-dialog__section-title">Rotations using {crop.name}</h4>
              <ul className="crop-dialog__rotations">
                {crop.rotations.map((rot) => (
                  <li key={rot.name} className="crop-dialog__rotation">
                    <strong>{rot.rank ? `#${rot.rank}: ` : ''}{rot.name}</strong>
                    {rot.benefits.length > 0 && <span>{rot.benefits.slice(0, 2).join(' ')}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {crop.timing?.basis && <p className="caption crop-dialog__basis">{crop.timing.basis}</p>}
        </div>
      )}
    </dialog>
  );
}

interface SuggestedCropsProps {
  horizon: PredictionHorizon;
  crops: Crop[];
  analysis: Analysis | null;
  briefing: FieldBriefing;
  water: WaterAvailability | null;
  equipment: Equipment[] | null;
  scenario: { rainfall: RainfallScenario; temperature: TemperatureScenario };
  loading: boolean;
}

export function SuggestedCropsCard({
  horizon,
  crops,
  analysis,
  briefing,
  water,
  equipment,
  scenario,
  loading,
}: SuggestedCropsProps) {
  const meta = useMeta();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { snapshot, items } = pickSuggestedCrops(
    horizon,
    crops,
    analysis,
    briefing,
    water,
    equipment,
    meta.equipment,
    scenario,
  );
  const selectedCrop = selectedId ? items.find((item) => item.id === selectedId) ?? null : null;

  return (
    <Card
      className="suggested-crops"
      title="Suggested crops to grow"
      smallTitle
      aside={<Pill tone={snapshot.asideTone}>{snapshot.asideLabel}</Pill>}
    >
      {items.length === 0 ? (
        loading ? (
          <CardState kind="loading" title="Checking crops suited to your field…" />
        ) : (
          <CardState kind="empty" title="No crop suggestions ready yet">
            Run a full comparison or check your water supply settings to see suited crops for your field.
          </CardState>
        )
      ) : (
        <>
          <p className="secondary">{snapshot.intro}</p>
          <ul className="crop-suggest-grid">
            {items.map((crop) => (
              <li key={crop.id} className="crop-suggest-tile">
                <button
                  type="button"
                  className="crop-pick"
                  onClick={() => setSelectedId(crop.id)}
                >
                  <span className="crop-pick__head">
                    <strong className="crop-pick__title">{crop.name}</strong>
                    <Pill tone={crop.badge.tone}>{crop.badge.label}</Pill>
                  </span>
                  <span className="crop-pick__traits">{crop.cardTraits.join(' · ')}</span>
                  <span className="crop-pick__action">Why it fits</span>
                </button>
              </li>
            ))}
          </ul>
          <CropDetailDialog
            crop={selectedCrop}
            snapshot={snapshot}
            horizon={horizon}
            equipmentSet={equipment !== null}
            onClose={() => setSelectedId(null)}
          />
        </>
      )}
    </Card>
  );
}

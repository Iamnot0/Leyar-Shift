import type { Crop, Equipment, Label } from '../api/types';
import type { CropsState } from './RotationQuestion';

export interface FieldEquipmentItem {
  id: Equipment;
  label: string;
  description: string;
  crops: string[];
}

export interface CropRequirement {
  id: string;
  name: string;
  category: Crop['category'];
  waterNeed: string | null;
  nitrogenFixing: boolean;
  grownLocally: boolean | null;
  suitabilityReason: string;
  equipmentIds: Equipment[];
  equipmentLabels: string[];
}

const WATER_NEED_TEXT: Record<NonNullable<Crop['water_demand']>, string> = {
  low: 'Low water need',
  medium: 'Medium water need',
  high: 'High water need',
};

/**
 * Derives dynamic equipment choices and crop requirements strictly from the crops
 * returned for the farmer's current field (`GET /v1/crops?lat&lon`).
 */
export function deriveFieldRequirements(
  cropsState: CropsState,
  metaEquipment: readonly Label[],
): { equipmentOptions: FieldEquipmentItem[]; cropRequirements: CropRequirement[] } {
  const byId = new Map<string, Label>(metaEquipment.map((item) => [item.id, item]));
  if (cropsState.status !== 'ready') {
    return {
      equipmentOptions: metaEquipment.map((item) => ({
        id: item.id as Equipment,
        label: item.label,
        description: item.description,
        crops: [],
      })),
      cropRequirements: [],
    };
  }

  const usable = cropsState.crops.filter((crop) => crop.category !== 'fallow' && crop.suitable !== false);
  const cropsByEquip = new Map<Equipment, string[]>();
  for (const crop of usable) {
    for (const eq of crop.equipment) {
      const list = cropsByEquip.get(eq) ?? [];
      if (!list.includes(crop.name)) list.push(crop.name);
      cropsByEquip.set(eq, list);
    }
  }

  const equipmentOptions: FieldEquipmentItem[] = [];
  for (const item of metaEquipment) {
    const id = item.id as Equipment;
    const crops = cropsByEquip.get(id);
    if (!crops || crops.length === 0) continue;
    equipmentOptions.push({
      id,
      label: item.label,
      description: `Needed here for ${crops.join(', ')}.`,
      crops,
    });
  }

  const finalEquipment =
    equipmentOptions.length > 0
      ? equipmentOptions
      : metaEquipment.map((item) => ({
          id: item.id as Equipment,
          label: item.label,
          description: item.description,
          crops: [],
        }));

  const categoryRank: Record<Crop['category'], number> = { cash: 0, forage: 1, cover: 2, fallow: 3 };
  const sortedCrops = [...usable].sort(
    (a, b) =>
      Number(Boolean(b.grown_locally)) - Number(Boolean(a.grown_locally)) ||
      categoryRank[a.category] - categoryRank[b.category] ||
      a.name.localeCompare(b.name),
  );

  const cropRequirements: CropRequirement[] = sortedCrops.map((crop) => ({
    id: crop.id,
    name: crop.name,
    category: crop.category,
    waterNeed: crop.water_demand ? WATER_NEED_TEXT[crop.water_demand] : null,
    nitrogenFixing: crop.nitrogen_fixing,
    grownLocally: crop.grown_locally,
    suitabilityReason: crop.suitability_reason,
    equipmentIds: crop.equipment,
    equipmentLabels: crop.equipment.map((eq) => byId.get(eq)?.label ?? eq),
  }));

  return { equipmentOptions: finalEquipment, cropRequirements };
}

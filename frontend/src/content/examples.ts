import type { AnalysisPlan } from '../app/plan';

export interface ExampleField {
  id: string;
  place: string;
  /** The place as the sample pill shows it. */
  short: string;
  story: string;
  cropId: string;
  plan: Omit<AnalysisPlan, 'scenario'>;
}

const polygon = (ring: [number, number][]) => ({ type: 'Polygon' as const, coordinates: [ring] });

/**
 * Real fields, each one crop for most of 2008 to 2025 on the USDA Cropland Data Layer.
 * Opening one runs the same live analysis as any field; nothing about them is stored or made up.
 */
export const EXAMPLE_FIELDS: ExampleField[] = [
  {
    id: 'kansas',
    place: 'Garden City, Kansas',
    short: 'Garden City, KS',
    story: 'Corn pivot over the Ogallala aquifer · limited water',
    cropId: 'corn',
    plan: {
      field: { name: 'Corn pivot near Garden City, Kansas', geometry: polygon([[-100.727883, 37.94787], [-100.727905, 37.948222], [-100.727971, 37.948571], [-100.72808, 37.948913], [-100.72823, 37.949245], [-100.728421, 37.949564], [-100.728651, 37.949866], [-100.728918, 37.95015], [-100.729218, 37.950411], [-100.729549, 37.950648], [-100.729908, 37.950858], [-100.730292, 37.951039], [-100.730696, 37.95119], [-100.731117, 37.951309], [-100.731551, 37.951394], [-100.731993, 37.951446], [-100.73244, 37.951463], [-100.732887, 37.951446], [-100.733329, 37.951394], [-100.733763, 37.951309], [-100.734184, 37.95119], [-100.734588, 37.951039], [-100.734972, 37.950858], [-100.735331, 37.950648], [-100.735662, 37.950411], [-100.735962, 37.95015], [-100.736229, 37.949866], [-100.736459, 37.949564], [-100.73665, 37.949245], [-100.7368, 37.948913], [-100.736909, 37.948571], [-100.736975, 37.948222], [-100.736997, 37.94787], [-100.736975, 37.947518], [-100.736909, 37.947169], [-100.7368, 37.946827], [-100.73665, 37.946495], [-100.736459, 37.946176], [-100.736229, 37.945874], [-100.735962, 37.94559], [-100.735662, 37.945329], [-100.735331, 37.945092], [-100.734972, 37.944882], [-100.734588, 37.944701], [-100.734184, 37.94455], [-100.733763, 37.944431], [-100.733329, 37.944346], [-100.732887, 37.944294], [-100.73244, 37.944277], [-100.731993, 37.944294], [-100.731551, 37.944346], [-100.731117, 37.944431], [-100.730696, 37.94455], [-100.730292, 37.944701], [-100.729908, 37.944882], [-100.729549, 37.945092], [-100.729218, 37.945329], [-100.728918, 37.94559], [-100.728651, 37.945874], [-100.728421, 37.946176], [-100.72823, 37.946495], [-100.72808, 37.946827], [-100.727971, 37.947169], [-100.727905, 37.947518], [-100.727883, 37.94787]]) },
      farm: { water: 'limited', equipment: null, priorities: ['income', 'conserve_water', 'build_soil'], requireForage: false, localMarketOnly: false, ownFigures: [] },
      years: [{ crop_id: 'corn', cover_crop_id: null }],
      confirmed: true,
    },
  },
  {
    id: 'nebraska',
    place: 'York, Nebraska',
    short: 'York, NE',
    story: 'Corn nearly every year · reliable irrigation',
    cropId: 'corn',
    plan: {
      field: { name: 'Corn field near York, Nebraska', geometry: polygon([[-97.720396, 40.86379], [-97.712884, 40.86379], [-97.712884, 40.86951], [-97.720396, 40.86951], [-97.720396, 40.86379]]) },
      farm: { water: 'reliable', equipment: null, priorities: ['conserve_water', 'income', 'build_soil'], requireForage: false, localMarketOnly: false, ownFigures: [] },
      years: [{ crop_id: 'corn', cover_crop_id: null }],
      confirmed: true,
    },
  },
  {
    id: 'texas',
    place: 'Lubbock, Texas',
    short: 'Lubbock, TX',
    story: 'Cotton every year · limited water',
    cropId: 'cotton',
    plan: {
      field: { name: 'Cotton field near Lubbock, Texas', geometry: polygon([[-101.919932, 33.37762], [-101.913128, 33.37762], [-101.913128, 33.38334], [-101.919932, 33.38334], [-101.919932, 33.37762]]) },
      farm: { water: 'limited', equipment: null, priorities: ['income', 'conserve_water'], requireForage: false, localMarketOnly: false, ownFigures: [] },
      years: [{ crop_id: 'cotton', cover_crop_id: null }],
      confirmed: true,
    },
  },
];

export interface CropPhoto {
  name: string;
  alt: string;
  author: string;
  license: string;
  source: string;
}

const COMMONS = 'https://commons.wikimedia.org/wiki/File:';

/** Real photographs from Wikimedia Commons, kept on this site at 400 × 300 and credited where they are shown. */
export const PHOTOS: Record<string, CropPhoto> = {
  corn: { name: 'Corn', alt: 'Corn plants with young ears in a field', author: 'JFVelasquez Floro', license: 'CC0', source: `${COMMONS}0538Maize_fields_in_Bulacan_09.jpg` },
  sorghum: { name: 'Sorghum', alt: 'Tall sorghum plants with seed heads against the sky', author: 'Swathi Sridharan', license: 'CC BY-SA 2.0', source: `${COMMONS}Local_Malawi_variety_of_sorghum.jpg` },
  wheat: { name: 'Wheat', alt: 'A field of ripe wheat', author: 'Hugh Venables', license: 'CC BY-SA 2.0', source: `${COMMONS}Ripe_wheat_field_-_geograph.org.uk_-_7835402.jpg` },
  soybean: { name: 'Soybeans', alt: 'Rows of soybean plants', author: 'United Soybean Board', license: 'CC BY 2.0', source: `${COMMONS}Soybean_Plants_in_the_Field_(9624015808).jpg` },
  sunflower: { name: 'Sunflower', alt: 'A field of sunflowers in bloom', author: 'Björn S.', license: 'CC BY-SA 3.0', source: `${COMMONS}Sunflower_field_-_panoramio_(11).jpg` },
  cotton: { name: 'Cotton', alt: 'Open cotton bolls on the plant', author: 'Nanditha Gogate, WELL Labs', license: 'CC BY-SA 4.0', source: `${COMMONS}Mature_cotton_boll_in_Raichur,_Karnataka.jpg` },
  dry_beans: { name: 'Beans', alt: 'Bean plants with broad leaves', author: 'Nizil Shah', license: 'CC BY-SA 4.0', source: `${COMMONS}Mung_Bean_plant_(16077).jpg` },
  alfalfa: { name: 'Alfalfa', alt: 'A field of flowering alfalfa', author: 'Chris Morgan', license: 'CC BY-SA 2.0', source: `${COMMONS}Walking_through_a_field_of_alfalfa_-_geograph.org.uk_-_4073273.jpg` },
  small_grain: { name: 'Small grains', alt: 'A field of ripening oats', author: 'Estormiz', license: 'CC0', source: `${COMMONS}Oat_field_Hailuoto_20260903.jpg` },
  cover_crop: { name: 'Cover crop', alt: 'A green cover crop growing across a field', author: 'David Pashley', license: 'CC BY-SA 2.0', source: `${COMMONS}Either_green_manure_crop_or_game_cover_-_geograph.org.uk_-_7581998.jpg` },
  fallow: { name: 'Fallow', alt: 'A field left in stubble after harvest', author: 'Peter Wood', license: 'CC BY-SA 2.0', source: `${COMMONS}Field_path_through_after-harvest_stubble_-_geograph.org.uk_-_7070988.jpg` },
  rice: { name: 'Rice', alt: 'Young rice plants in a flooded paddy', author: 'Basile Morin', license: 'CC BY-SA 4.0', source: `${COMMONS}Green_rice_sheaves_planted_in_a_paddy_field_with_long_shadows_at_golden_hour_in_Don_Det_Laos.jpg` },
};

const ALIASES: Record<string, string> = { winter_wheat: 'wheat', pulses: 'dry_beans' };

// A double crop is named by its parts (rice_wheat, wheat_soybean), and each part has its own photo.
export function photoKeys(cropId: string): string[] {
  const key = ALIASES[cropId] ?? cropId;
  if (key in PHOTOS) return [key];
  return cropId.split('_').map((part) => ALIASES[part] ?? part).filter((part) => part in PHOTOS);
}

export function photoSrc(key: string): string {
  return `/crops/${key}.webp`;
}

/** Author and licence for each photo shown, as the licences ask. */
export function photoCredit(keys: string[]): string {
  return `Photos from Wikimedia Commons by ${keys.map((key) => `${PHOTOS[key].author} (${PHOTOS[key].license})`).join(', ')}.`;
}

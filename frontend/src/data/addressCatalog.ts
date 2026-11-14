export interface CountryOption {
  code: string;
  name: string;
}

export const FEATURED_COUNTRY_CODES = [
  'US', 'IN', 'PH', 'CA', 'AU', 'BR', 'AR', 'MX', 'GB', 'FR', 'DE', 'ES', 'IT',
  'UA', 'PK', 'BD', 'CN', 'ID', 'TH', 'VN', 'JP', 'NG', 'KE', 'ZA',
] as const;

const ALL_COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

const regionNames = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

const FALLBACK_NAMES: Record<string, string> = {
  US: 'United States',
  IN: 'India',
  PH: 'Philippines',
  CA: 'Canada',
  AU: 'Australia',
  GB: 'United Kingdom',
  BR: 'Brazil',
  AR: 'Argentina',
  MX: 'Mexico',
  FR: 'France',
  DE: 'Germany',
};

const countryName = (code: string): string => regionNames?.of(code) ?? FALLBACK_NAMES[code] ?? code;

const FEATURED_SET = new Set<string>(FEATURED_COUNTRY_CODES);

export const FEATURED_COUNTRIES: CountryOption[] = FEATURED_COUNTRY_CODES.map((code) => ({
  code,
  name: countryName(code),
}));

export const OTHER_COUNTRIES: CountryOption[] = ALL_COUNTRY_CODES
  .filter((code) => !FEATURED_SET.has(code))
  .map((code) => ({ code, name: countryName(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const COUNTRY_BY_CODE: Record<string, string> = Object.fromEntries(
  ALL_COUNTRY_CODES.map((code) => [code, countryName(code)]),
);

export const REGIONS_BY_COUNTRY: Record<string, string[]> = {
  US: [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
    'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
    'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
    'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
    'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island',
    'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
    'West Virginia', 'Wisconsin', 'Wyoming',
  ],
  IN: [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat',
    'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
    'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
    'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  ],
  PH: [
    'Agusan del Norte', 'Bataan', 'Batangas', 'Bohol', 'Bukidnon', 'Bulacan', 'Cagayan', 'Camarines Sur',
    'Capiz', 'Cavite', 'Cebu', 'Cotabato', 'Davao del Norte', 'Davao del Sur', 'Ilocos Norte', 'Ilocos Sur',
    'Iloilo', 'Isabela', 'La Union', 'Laguna', 'Leyte', 'Maguindanao', 'Mindoro Occidental', 'Mindoro Oriental',
    'Misamis Oriental', 'Negros Occidental', 'Negros Oriental', 'Nueva Ecija', 'Nueva Vizcaya', 'Pampanga',
    'Pangasinan', 'Quezon', 'Rizal', 'South Cotabato', 'Sultan Kudarat', 'Tarlac', 'Zambales',
  ],
  CA: [
    'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador',
    'Northwest Territories', 'Nova Scotia', 'Nunavut', 'Ontario', 'Prince Edward Island', 'Quebec',
    'Saskatchewan', 'Yukon',
  ],
  AU: [
    'Australian Capital Territory', 'New South Wales', 'Northern Territory', 'Queensland',
    'South Australia', 'Tasmania', 'Victoria', 'Western Australia',
  ],
  BR: [
    'Bahia', 'Goiás', 'Maranhão', 'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Paraná',
    'Pernambuco', 'Piauí', 'Rio Grande do Sul', 'Santa Catarina', 'São Paulo', 'Tocantins',
  ],
  AR: [
    'Buenos Aires', 'Chaco', 'Córdoba', 'Corrientes', 'Entre Ríos', 'La Pampa', 'Mendoza',
    'Salta', 'San Luis', 'Santa Fe', 'Santiago del Estero', 'Tucumán',
  ],
  MX: [
    'Chihuahua', 'Coahuila', 'Durango', 'Guanajuato', 'Jalisco', 'Michoacán', 'Nuevo León',
    'Oaxaca', 'Puebla', 'Sinaloa', 'Sonora', 'Tamaulipas', 'Veracruz', 'Zacatecas',
  ],
  GB: ['England', 'Northern Ireland', 'Scotland', 'Wales'],
  FR: [
    'Auvergne-Rhône-Alpes', 'Bourgogne-Franche-Comté', 'Bretagne', 'Centre-Val de Loire', 'Grand Est',
    'Hauts-de-France', 'Île-de-France', 'Normandie', 'Nouvelle-Aquitaine', 'Occitanie', 'Pays de la Loire',
    "Provence-Alpes-Côte d'Azur",
  ],
  DE: [
    'Baden-Württemberg', 'Bayern', 'Brandenburg', 'Hessen', 'Mecklenburg-Vorpommern', 'Niedersachsen',
    'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Sachsen', 'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen',
  ],
  ES: ['Andalucía', 'Aragón', 'Castilla y León', 'Castilla-La Mancha', 'Cataluña', 'Extremadura', 'Galicia', 'Murcia', 'Navarra', 'Valencia'],
  IT: ['Campania', 'Emilia-Romagna', 'Lombardia', 'Piemonte', 'Puglia', 'Sicilia', 'Toscana', 'Veneto'],
  UA: ['Cherkasy', 'Chernihiv', 'Dnipro', 'Kharkiv', 'Kherson', 'Kyiv', 'Mykolaiv', 'Odesa', 'Poltava', 'Sumy', 'Vinnytsia', 'Zaporizhzhia'],
  PK: ['Balochistan', 'Islamabad', 'Khyber Pakhtunkhwa', 'Punjab', 'Sindh'],
  BD: ['Barishal', 'Chattogram', 'Dhaka', 'Khulna', 'Mymensingh', 'Rajshahi', 'Rangpur', 'Sylhet'],
  CN: ['Anhui', 'Guangdong', 'Hebei', 'Heilongjiang', 'Henan', 'Hubei', 'Hunan', 'Jiangsu', 'Jilin', 'Liaoning', 'Shandong', 'Sichuan', 'Xinjiang'],
  ID: ['Central Java', 'East Java', 'Lampung', 'North Sumatra', 'South Sulawesi', 'South Sumatra', 'West Java'],
  TH: ['Chiang Mai', 'Khon Kaen', 'Nakhon Ratchasima', 'Nakhon Sawan', 'Suphan Buri', 'Ubon Ratchathani', 'Udon Thani'],
  VN: ['An Giang', 'Cần Thơ', 'Đắk Lắk', 'Đồng Tháp', 'Hà Nội', 'Kiên Giang', 'Long An', 'Nghệ An', 'Sóc Trăng'],
  JP: ['Aomori', 'Chiba', 'Fukuoka', 'Hokkaido', 'Ibaraki', 'Kumamoto', 'Nagano', 'Niigata', 'Tochigi'],
  NG: ['Benue', 'Kano', 'Kaduna', 'Katsina', 'Niger', 'Ogun', 'Oyo', 'Plateau'],
  KE: ['Bungoma', 'Eldoret / Uasin Gishu', 'Kiambu', 'Nakuru', 'Narok', 'Trans Nzoia'],
  ZA: ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Western Cape'],
};

export const CITIES_BY_REGION: Record<string, Record<string, string[]>> = {
  US: {
    California: ['Bakersfield', 'Chico', 'Fresno', 'Merced', 'Modesto', 'Salinas', 'Stockton', 'Tulare', 'Visalia'],
    Colorado: ['Burlington', 'Fort Morgan', 'Greeley', 'Lamar', 'Sterling', 'Yuma'],
    Illinois: ['Bloomington', 'Champaign', 'Decatur', 'Galesburg', 'Peoria', 'Springfield'],
    Indiana: ['Columbus', 'Evansville', 'Fort Wayne', 'Lafayette', 'Vincennes'],
    Iowa: ['Ames', 'Cedar Rapids', 'Des Moines', 'Fort Dodge', 'Mason City', 'Sioux City', 'Waterloo'],
    Kansas: ['Colby', 'Dodge City', 'Garden City', 'Great Bend', 'Hays', 'Holcomb', 'Hutchinson', 'Liberal', 'Manhattan', 'Salina', 'Topeka', 'Ulysses', 'Wichita'],
    Minnesota: ['Fargo-Moorhead', 'Mankato', 'Marshall', 'Rochester', 'St. Cloud', 'Willmar'],
    Missouri: ['Cape Girardeau', 'Chillicothe', 'Columbia', 'Jefferson City', 'Kirksville', 'Springfield'],
    Montana: ['Billings', 'Bozeman', 'Great Falls', 'Havre', 'Miles City'],
    Nebraska: ['Grand Island', 'Hastings', 'Kearney', 'Lincoln', 'McCook', 'Norfolk', 'North Platte', 'Scottsbluff'],
    'North Dakota': ['Bismarck', 'Devils Lake', 'Fargo', 'Grand Forks', 'Jamestown', 'Minot', 'Williston'],
    Ohio: ['Bowling Green', 'Findlay', 'Lima', 'Mansfield', 'Marion', 'Wooster'],
    Oklahoma: ['Altus', 'Enid', 'Guymon', 'Lawton', 'Stillwater', 'Woodward'],
    'South Dakota': ['Aberdeen', 'Brookings', 'Huron', 'Mitchell', 'Pierre', 'Sioux Falls', 'Watertown'],
    Texas: ['Amarillo', 'College Station', 'Corpus Christi', 'Dalhart', 'Lubbock', 'McAllen', 'Plainview', 'Waco'],
    Washington: ['Moses Lake', 'Pasco', 'Pullman', 'Spokane', 'Walla Walla', 'Wenatchee', 'Yakima'],
    Wisconsin: ['Eau Claire', 'Fond du Lac', 'Green Bay', 'Janesville', 'Madison', 'Stevens Point'],
  },
  IN: {
    Bihar: ['Bhagalpur', 'Darbhanga', 'Gaya', 'Muzaffarpur', 'Patna', 'Purnia'],
    Gujarat: ['Ahmedabad', 'Anand', 'Banaskantha', 'Junagadh', 'Rajkot', 'Surat'],
    Haryana: ['Ambala', 'Bhiwani', 'Hisar', 'Karnal', 'Kurukshetra', 'Rohtak', 'Sirsa'],
    'Madhya Pradesh': ['Bhopal', 'Gwalior', 'Indore', 'Jabalpur', 'Sagar', 'Ujjain'],
    Maharashtra: ['Akola', 'Amravati', 'Aurangabad', 'Kolhapur', 'Nagpur', 'Nashik', 'Pune', 'Solapur'],
    Punjab: ['Amritsar', 'Bathinda', 'Firozpur', 'Jalandhar', 'Jagraon', 'Khanna', 'Ludhiana', 'Moga', 'Patiala', 'Sangrur'],
    Rajasthan: ['Alwar', 'Bikaner', 'Hanumangarh', 'Jaipur', 'Kota', 'Sri Ganganagar'],
    'Uttar Pradesh': ['Agra', 'Aligarh', 'Bareilly', 'Gorakhpur', 'Kanpur', 'Lucknow', 'Meerut', 'Varanasi'],
    'West Bengal': ['Bardhaman', 'Hooghly', 'Malda', 'Murshidabad', 'Nadia', 'Siliguri'],
  },
  PH: {
    Bukidnon: ['Don Carlos', 'Malaybalay', 'Manolo Fortich', 'Maramag', 'Valencia'],
    Cagayan: ['Aparri', 'Gattaran', 'Solana', 'Tuao', 'Tuguegarao'],
    Cotabato: ['Kabacan', 'Kidapawan', 'Midsayap', 'Mlang', 'Pigcawayan'],
    Iloilo: ['Barotac Nuevo', 'Dumangas', 'Iloilo City', 'Oton', 'Passi', 'Pototan'],
    Isabela: ['Alicia', 'Cauayan', 'Ilagan', 'Roxas', 'San Mateo', 'Santiago'],
    'Negros Occidental': ['Bacolod', 'Bago', 'Kabankalan', 'La Carlota', 'Sagay', 'Victorias'],
    'Nueva Ecija': ['Bongabon', 'Cabanatuan', 'Gapan', 'Guimba', 'Muñoz', 'Palayan', 'San Jose', 'Talavera'],
    Pampanga: ['Arayat', 'Candaba', 'Guagua', 'Lubao', 'Magalang', 'San Fernando'],
    Pangasinan: ['Alaminos', 'Bayambang', 'Dagupan', 'Lingayen', 'Rosales', 'San Carlos', 'Urdaneta'],
    Tarlac: ['Capas', 'Concepcion', 'Gerona', 'Paniqui', 'Tarlac City', 'Victoria'],
  },
  CA: {
    Alberta: ['Brooks', 'Calgary', 'Camrose', 'Grande Prairie', 'Lethbridge', 'Medicine Hat', 'Red Deer'],
    Manitoba: ['Brandon', 'Dauphin', 'Morden', 'Portage la Prairie', 'Steinbach', 'Winnipeg'],
    Ontario: ['Chatham-Kent', 'Guelph', 'Kingston', 'London', 'Ottawa', 'Woodstock'],
    Saskatchewan: ['Melfort', 'Moose Jaw', 'North Battleford', 'Prince Albert', 'Regina', 'Saskatoon', 'Swift Current', 'Yorkton'],
  },
  AU: {
    'New South Wales': ['Dubbo', 'Griffith', 'Moree', 'Narrabri', 'Tamworth', 'Wagga Wagga'],
    Queensland: ['Dalby', 'Emerald', 'Kingaroy', 'Roma', 'Toowoomba', 'Townsville'],
    'South Australia': ['Clare', 'Keith', 'Loxton', 'Mount Gambier', 'Port Pirie'],
    Victoria: ['Bendigo', 'Echuca', 'Horsham', 'Mildura', 'Shepparton'],
    'Western Australia': ['Albany', 'Esperance', 'Geraldton', 'Katanning', 'Merredin', 'Northam'],
  },
  PK: {
    Punjab: ['Bahawalpur', 'Faisalabad', 'Gujranwala', 'Multan', 'Okara', 'Sahiwal', 'Sargodha'],
    Sindh: ['Hyderabad', 'Larkana', 'Mirpur Khas', 'Nawabshah', 'Sukkur'],
  },
  BR: {
    'Mato Grosso': ['Lucas do Rio Verde', 'Nova Mutum', 'Primavera do Leste', 'Rondonópolis', 'Sinop', 'Sorriso'],
    Paraná: ['Cascavel', 'Londrina', 'Maringá', 'Ponta Grossa', 'Toledo'],
    'Rio Grande do Sul': ['Cruz Alta', 'Ijuí', 'Passo Fundo', 'Pelotas', 'Santa Maria'],
  },
  AR: {
    'Buenos Aires': ['Azul', 'Balcarce', 'Junín', 'Pergamino', 'Tandil', 'Trenque Lauquen'],
    Córdoba: ['Bell Ville', 'Marcos Juárez', 'Río Cuarto', 'Villa María'],
    'Santa Fe': ['Rafaela', 'Reconquista', 'Rosario', 'Venado Tuerto'],
  },
};

export const POSTAL_BY_CITY: Record<string, Record<string, Record<string, string>>> = {
  "US": {
    "California": {
      "Bakersfield": "93301",
      "Chico": "95926",
      "Fresno": "93650",
      "Merced": "95340",
      "Modesto": "95350",
      "Salinas": "93901",
      "Stockton": "95201",
      "Tulare": "93274",
      "Visalia": "93277"
    },
    "Colorado": {
      "Burlington": "80807",
      "Fort Morgan": "80701",
      "Greeley": "80631",
      "Lamar": "81052",
      "Sterling": "80751",
      "Yuma": "80759"
    },
    "Illinois": {
      "Bloomington": "61701",
      "Champaign": "61820",
      "Decatur": "62521",
      "Galesburg": "61401",
      "Peoria": "61601",
      "Springfield": "62701"
    },
    "Indiana": {
      "Columbus": "47201",
      "Evansville": "47701",
      "Fort Wayne": "46801",
      "Lafayette": "47901",
      "Vincennes": "47591"
    },
    "Iowa": {
      "Ames": "50010",
      "Cedar Rapids": "52401",
      "Des Moines": "50265",
      "Fort Dodge": "50501",
      "Mason City": "50401",
      "Sioux City": "51101",
      "Waterloo": "50701"
    },
    "Kansas": {
      "Colby": "67701",
      "Dodge City": "67801",
      "Garden City": "67846",
      "Great Bend": "67530",
      "Hays": "67060",
      "Holcomb": "67851",
      "Hutchinson": "67501",
      "Liberal": "67901",
      "Manhattan": "66502",
      "Salina": "67401",
      "Topeka": "66601",
      "Ulysses": "67880",
      "Wichita": "67201"
    },
    "Minnesota": {
      "Fargo-Moorhead": "56560",
      "Mankato": "56001",
      "Marshall": "56258",
      "Rochester": "55901",
      "St. Cloud": "56301",
      "Willmar": "56201"
    },
    "Missouri": {
      "Cape Girardeau": "63701",
      "Chillicothe": "64601",
      "Columbia": "65201",
      "Jefferson City": "65101",
      "Kirksville": "63501",
      "Springfield": "65801"
    },
    "Montana": {
      "Billings": "59101",
      "Bozeman": "59715",
      "Great Falls": "59401",
      "Havre": "59501",
      "Miles City": "59301"
    },
    "Nebraska": {
      "Grand Island": "68801",
      "Hastings": "68901",
      "Kearney": "68845",
      "Lincoln": "68501",
      "Norfolk": "68701",
      "North Platte": "69101",
      "Scottsbluff": "69361"
    },
    "North Dakota": {
      "Bismarck": "58501",
      "Devils Lake": "58301",
      "Fargo": "58078",
      "Grand Forks": "58201",
      "Jamestown": "58401",
      "Minot": "58701",
      "Williston": "58801"
    },
    "Ohio": {
      "Bowling Green": "43402",
      "Findlay": "45839",
      "Lima": "44452",
      "Mansfield": "43358",
      "Marion": "43301",
      "Wooster": "44691"
    },
    "Oklahoma": {
      "Altus": "73521",
      "Enid": "73701",
      "Guymon": "73942",
      "Lawton": "73501",
      "Stillwater": "74074",
      "Woodward": "73801"
    },
    "South Dakota": {
      "Aberdeen": "57401",
      "Brookings": "57006",
      "Huron": "57350",
      "Mitchell": "57301",
      "Pierre": "57501",
      "Sioux Falls": "57101",
      "Watertown": "57201"
    },
    "Texas": {
      "Amarillo": "79101",
      "College Station": "77840",
      "Corpus Christi": "78401",
      "Dalhart": "79022",
      "Lubbock": "79401",
      "McAllen": "78501",
      "Plainview": "79072",
      "Waco": "76701"
    },
    "Washington": {
      "Moses Lake": "98837",
      "Pasco": "99301",
      "Pullman": "99163",
      "Spokane": "99201",
      "Walla Walla": "99362",
      "Wenatchee": "98801",
      "Yakima": "98901"
    },
    "Wisconsin": {
      "Eau Claire": "54701",
      "Fond du Lac": "54935",
      "Green Bay": "54301",
      "Janesville": "53545",
      "Madison": "53701",
      "Stevens Point": "54481"
    }
  },
  "IN": {
    "Bihar": {
      "Bhagalpur": "812001",
      "Darbhanga": "846004",
      "Gaya": "804424",
      "Muzaffarpur": "842001",
      "Patna": "800001",
      "Purnia": "812005"
    },
    "Gujarat": {
      "Ahmedabad": "380001",
      "Anand": "360002",
      "Banaskantha": "385560",
      "Junagadh": "362001",
      "Rajkot": "360001",
      "Surat": "394140"
    },
    "Haryana": {
      "Ambala": "133001",
      "Bhiwani": "127021",
      "Hisar": "125001",
      "Karnal": "132001",
      "Kurukshetra": "136118",
      "Rohtak": "124001",
      "Sirsa": "125055"
    },
    "Madhya Pradesh": {
      "Bhopal": "462001",
      "Gwalior": "474001",
      "Indore": "452001",
      "Jabalpur": "482001",
      "Sagar": "455001",
      "Ujjain": "456001"
    },
    "Maharashtra": {
      "Akola": "400055",
      "Amravati": "444601",
      "Aurangabad": "431001",
      "Kolhapur": "415101",
      "Nagpur": "440001",
      "Nashik": "422001",
      "Pune": "410512",
      "Solapur": "413001"
    },
    "Punjab": {
      "Amritsar": "143001",
      "Bathinda": "151001",
      "Firozpur": "142041",
      "Jalandhar": "144001",
      "Jagraon": "142026",
      "Khanna": "141401",
      "Ludhiana": "141001",
      "Moga": "142001",
      "Patiala": "140201",
      "Sangrur": "148001"
    },
    "Rajasthan": {
      "Alwar": "301001",
      "Bikaner": "334001",
      "Hanumangarh": "335063",
      "Jaipur": "302001",
      "Kota": "301706"
    },
    "Uttar Pradesh": {
      "Agra": "203131",
      "Aligarh": "202001",
      "Bareilly": "243001",
      "Gorakhpur": "273001",
      "Kanpur": "201014",
      "Lucknow": "226001",
      "Meerut": "201003",
      "Varanasi": "221001"
    },
    "West Bengal": {
      "Bardhaman": "713129",
      "Hooghly": "700103",
      "Malda": "713145",
      "Murshidabad": "741156",
      "Nadia": "723149",
      "Siliguri": "734001"
    }
  },
  "PH": {
    "Bukidnon": {
      "Don Carlos": "8712",
      "Malaybalay": "8700",
      "Manolo Fortich": "8703",
      "Maramag": "8714",
      "Valencia": "8709"
    },
    "Cagayan": {
      "Aparri": "3515",
      "Gattaran": "3508",
      "Solana": "3503",
      "Tuao": "3528",
      "Tuguegarao": "3500"
    },
    "Cotabato": {
      "Kabacan": "9407",
      "Kidapawan": "9400",
      "Midsayap": "9410"
    },
    "Iloilo": {
      "Barotac Nuevo": "5007",
      "Dumangas": "5006",
      "Iloilo City": "5000",
      "Oton": "5020",
      "Passi": "5037",
      "Pototan": "5008"
    },
    "Isabela": {
      "Alicia": "3306",
      "Cauayan": "3305",
      "Ilagan": "3300",
      "Roxas": "3320",
      "San Mateo": "3318",
      "Santiago": "3311"
    },
    "Negros Occidental": {
      "Bacolod": "6100",
      "Bago": "6101",
      "Kabankalan": "6111",
      "La Carlota": "6130",
      "Sagay": "6122",
      "Victorias": "6119"
    },
    "Nueva Ecija": {
      "Bongabon": "3128",
      "Cabanatuan": "3100",
      "Gapan": "3105",
      "Guimba": "3115",
      "Muñoz": "3119",
      "Palayan": "3132",
      "San Jose": "3121",
      "Talavera": "3114"
    },
    "Pampanga": {
      "Arayat": "2012",
      "Candaba": "2013",
      "Guagua": "2003",
      "Lubao": "2005",
      "Magalang": "2011",
      "San Fernando": "2000"
    },
    "Pangasinan": {
      "Alaminos": "2404",
      "Bayambang": "2423",
      "Dagupan": "2400",
      "Lingayen": "2401",
      "Rosales": "2441",
      "San Carlos": "2420",
      "Urdaneta": "2428"
    },
    "Tarlac": {
      "Capas": "2315",
      "Concepcion": "2316",
      "Gerona": "2302",
      "Paniqui": "2307",
      "Tarlac City": "2300",
      "Victoria": "2313"
    }
  },
  "CA": {
    "Alberta": {
      "Brooks": "T1R",
      "Calgary": "T1Y",
      "Camrose": "T4V",
      "Grande Prairie": "T8V",
      "Lethbridge": "T1H",
      "Medicine Hat": "T1A",
      "Red Deer": "T4E"
    },
    "Manitoba": {
      "Brandon": "R0K",
      "Dauphin": "R7N",
      "Morden": "R6M",
      "Portage la Prairie": "R1N",
      "Steinbach": "R5G",
      "Winnipeg": "R2C"
    },
    "Ontario": {
      "Guelph": "N1C",
      "Kingston": "K7K",
      "London": "N5V",
      "Ottawa": "K1A",
      "Woodstock": "N4S"
    },
    "Saskatchewan": {
      "Melfort": "S0E",
      "Moose Jaw": "S6H",
      "North Battleford": "S9A",
      "Prince Albert": "S6V",
      "Regina": "S4L",
      "Saskatoon": "S7H",
      "Swift Current": "S9H",
      "Yorkton": "S0A"
    }
  },
  "AU": {
    "New South Wales": {
      "Dubbo": "2830",
      "Griffith": "2680",
      "Moree": "2400",
      "Narrabri": "2390",
      "Tamworth": "2340",
      "Wagga Wagga": "2650"
    },
    "Queensland": {
      "Dalby": "4405",
      "Emerald": "4720",
      "Kingaroy": "4610",
      "Roma": "4455",
      "Toowoomba": "4350",
      "Townsville": "4810"
    },
    "South Australia": {
      "Clare": "5034",
      "Keith": "5267",
      "Loxton": "5333",
      "Mount Gambier": "5290",
      "Port Pirie": "5540"
    },
    "Victoria": {
      "Bendigo": "3550",
      "Echuca": "3564",
      "Horsham": "3400",
      "Mildura": "3500",
      "Shepparton": "3630"
    },
    "Western Australia": {
      "Albany": "6330",
      "Esperance": "6450",
      "Geraldton": "6530",
      "Katanning": "6317",
      "Merredin": "6415",
      "Northam": "6401"
    }
  },
  "PK": {
    "Punjab": {
      "Bahawalpur": "63080",
      "Faisalabad": "38000",
      "Gujranwala": "52230",
      "Multan": "48030",
      "Okara": "56300",
      "Sahiwal": "40210",
      "Sargodha": "40100"
    },
    "Sindh": {
      "Hyderabad": "70110",
      "Larkana": "77020",
      "Mirpur Khas": "69000",
      "Nawabshah": "67230",
      "Sukkur": "65200"
    }
  },
  "BR": {
    "Mato Grosso": {
      "Lucas do Rio Verde": "78455-000",
      "Nova Mutum": "78450-000",
      "Primavera do Leste": "78850-000",
      "Rondonópolis": "78700-000",
      "Sinop": "78550-000",
      "Sorriso": "78890-000"
    },
    "Paraná": {
      "Cascavel": "85800-000",
      "Londrina": "86000-000",
      "Maringá": "87000-000",
      "Ponta Grossa": "84000-000",
      "Toledo": "85900-000"
    },
    "Rio Grande do Sul": {
      "Cruz Alta": "98000-000",
      "Ijuí": "98700-000",
      "Passo Fundo": "99000-000",
      "Pelotas": "96000-000",
      "Santa Maria": "93995-000"
    }
  },
  "AR": {
    "Buenos Aires": {
      "Azul": "7112",
      "Balcarce": "1826",
      "Junín": "6000",
      "Pergamino": "2700",
      "Tandil": "7000",
      "Trenque Lauquen": "6400"
    },
    "Córdoba": {
      "Bell Ville": "2550",
      "Marcos Juárez": "2580",
      "Río Cuarto": "5800",
      "Villa María": "5900"
    },
    "Santa Fe": {
      "Rafaela": "2300",
      "Reconquista": "3560",
      "Rosario": "2000",
      "Venado Tuerto": "2600"
    }
  }
};

export function lookupPostalCode(countryCode: string, state: string, city: string): string {
  return POSTAL_BY_CITY[countryCode]?.[state]?.[city] ?? '';
}

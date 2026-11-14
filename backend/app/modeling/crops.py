"""The crop table. Every coefficient comes from a cited source row in data/crop_traits.csv."""

from __future__ import annotations

import csv
from dataclasses import dataclass, field, replace
from functools import lru_cache
from pathlib import Path

TABLE = Path(__file__).parent / "data" / "crop_traits.csv"
SOUTH_ASIA = {"IN", "PK", "BD", "NP", "LK"}
TROPIC_LATITUDE = 23.5
# A second crop goes in this many days after the first is harvested.
TURNAROUND_DAYS = 7
COVER_END_BEFORE_PLANTING_DAYS = 21
FALLOW_EVAPORATION_RANGE = (0.15, 0.40)


@dataclass(frozen=True)
class Phase:
    """One crop grown once: the unit the water model simulates."""

    id: str
    name: str
    category: str
    family: str | None
    nitrogen_fixing: bool
    kc_ini: float | None
    kc_mid: tuple[float, float] | None
    kc_end: tuple[float, float] | None
    root_m: tuple[float, float] | None
    depletion_p: float | None
    ky: float | None
    stages: tuple[int, int, int, int] | None
    plant_doy: int | None
    residue: str
    spring_planted: bool
    equipment: tuple[str, ...]
    cdl_names: tuple[str, ...]
    nass: tuple[str, str, str] | None
    source: str
    plant_spread: tuple[int, int] = (-10, 10)
    calendar_note: str | None = None
    fao_item: str | None = None

    @property
    def season_days(self) -> int | None:
        return sum(self.stages) if self.stages else None

    @property
    def frost_sensitive_days(self) -> int | None:
        """Days from sowing to the start of maturity. FAO-56's last stage is ripening and dry-down, which frost no longer harms in a crop harvested dry."""
        return sum(self.stages[:3]) if self.stages else None

    @property
    def perennial(self) -> bool:
        return self.residue == "living"


@dataclass(frozen=True)
class Crop:
    """What a farmer can put in one rotation year: one phase, or two grown back to back."""

    id: str
    name: str
    category: str
    phases: tuple[Phase, ...]

    @property
    def families(self) -> tuple[str, ...]:
        return tuple(phase.family for phase in self.phases if phase.family)

    @property
    def nitrogen_fixing(self) -> bool:
        return any(phase.nitrogen_fixing for phase in self.phases)

    @property
    def equipment(self) -> tuple[str, ...]:
        return tuple(sorted({item for phase in self.phases for item in phase.equipment}))

    @property
    def root_m_max(self) -> float | None:
        depths = [phase.root_m[1] for phase in self.phases if phase.root_m]
        return max(depths) if depths else None

    @property
    def kc_mid_max(self) -> float | None:
        peaks = [phase.kc_mid[1] for phase in self.phases if phase.kc_mid]
        return max(peaks) if peaks else None


DOUBLE_CROPS = {
    "south_asia": (("rice_wheat", "Rice, then wheat (same year)", ("rice", "winter_wheat")),
                   ("corn_wheat", "Corn, then wheat (same year)", ("corn", "winter_wheat")),
                   ("cotton_wheat", "Cotton, then wheat (same year)", ("cotton", "winter_wheat")),
                   ("pulses_wheat", "Pulses, then wheat (same year)", ("dry_beans", "winter_wheat"))),
    "tropics": (("rice_rice", "Rice twice a year", ("rice", "rice")),
                ("rice_corn", "Rice, then corn (same year)", ("rice", "corn")),
                ("rice_pulses", "Rice, then pulses (same year)", ("rice", "dry_beans"))),
    "us": (("wheat_sorghum", "Winter wheat, then sorghum (same year)", ("winter_wheat", "sorghum")),
           ("wheat_soybean", "Winter wheat, then soybeans (same year)", ("winter_wheat", "soybean"))),
}
# A dry-season second crop in the tropics goes in at the December planting the source table lists.
TROPICS_SECOND_PLANT_DOY = 349
CDL_DOUBLE_NAMES = {"Dbl Crop WinWht/Sorghum": "wheat_sorghum", "Dbl Crop WinWht/Soybeans": "wheat_soybean"}


def _number(text: str) -> float | None:
    return float(text) if text.strip() else None


def _pair(low: str, high: str) -> tuple[float, float] | None:
    a, b = _number(low), _number(high)
    return None if a is None or b is None else (a, b)


@lru_cache
def _rows() -> dict[tuple[str, str], Phase]:
    phases = {}
    with TABLE.open(newline="") as handle:
        for row in csv.DictReader(handle):
            stages = tuple(int(row[key]) for key in ("l_ini", "l_dev", "l_mid", "l_late")) if row["l_ini"] else None
            nass = (row["nass_commodity"], row["nass_class"], row["nass_util"]) if row["nass_commodity"] else None
            phases[(row["region"], row["id"])] = Phase(
                id=row["id"], name=row["name"], category=row["category"], family=row["family"] or None,
                nitrogen_fixing=row["nitrogen_fixing"] == "1", kc_ini=_number(row["kc_ini"]),
                kc_mid=_pair(row["kc_mid_low"], row["kc_mid_high"]), kc_end=_pair(row["kc_end_low"], row["kc_end_high"]),
                root_m=_pair(row["root_low_m"], row["root_high_m"]), depletion_p=_number(row["depletion_p"]), ky=_number(row["ky"]),
                stages=stages, plant_doy=int(row["plant_doy"]) if row["plant_doy"] else None, residue=row["residue"],
                spring_planted=row["spring_planted"] == "1", equipment=tuple(filter(None, row["equipment"].split("|"))),
                cdl_names=tuple(filter(None, row["cdl_names"].split("|"))), nass=nass, source=row["source"], fao_item=row.get("fao_item") or None)
    return phases


def region_for(country_code: str | None, latitude: float, conterminous_us: bool) -> tuple[str, bool]:
    """The crop calendar set to use, and whether it was chosen for this place or is only a fallback."""
    if conterminous_us:
        return "us", True
    if country_code in SOUTH_ASIA:
        return "south_asia", True
    if abs(latitude) < TROPIC_LATITUDE:
        return "tropics", True
    return "us", False


@dataclass
class CropLibrary:
    region: str
    crops: dict[str, Crop] = field(default_factory=dict)

    def get(self, crop_id: str) -> Crop | None:
        return self.crops.get(crop_id)

    def phase(self, phase_id: str) -> Phase | None:
        crop = self.crops.get(phase_id)
        return crop.phases[0] if crop and len(crop.phases) == 1 else None

    def from_cdl(self, name: str) -> str | None:
        if name in CDL_DOUBLE_NAMES and CDL_DOUBLE_NAMES[name] in self.crops:
            return CDL_DOUBLE_NAMES[name]
        for crop in self.crops.values():
            if len(crop.phases) == 1 and name in crop.phases[0].cdl_names:
                return crop.id
        return None

    def with_calendar(self, phase_id: str, *, plant_doy: int, season_days: int | None, spread: tuple[int, int], note: str) -> None:
        """Replace a table calendar with a locally reported one, keeping the table's stage proportions."""
        for crop_id, crop in list(self.crops.items()):
            updated = []
            for phase in crop.phases:
                if phase.id != phase_id or not phase.stages:
                    updated.append(phase)
                    continue
                stages = phase.stages
                if season_days:
                    total = sum(stages)
                    scaled = [max(1, round(length * season_days / total)) for length in stages]
                    scaled[2] += season_days - sum(scaled)
                    stages = tuple(scaled)
                keep_doy = len(crop.phases) == 2 and phase is crop.phases[1] and self.region != "us"
                updated.append(replace(phase, plant_doy=phase.plant_doy if keep_doy else plant_doy, stages=stages, plant_spread=spread, calendar_note=note))
            self.crops[crop_id] = replace(crop, phases=tuple(updated))


def load(region: str) -> CropLibrary:
    rows = _rows()
    library = CropLibrary(region)
    for (row_region, phase_id), phase in rows.items():
        if row_region in (region, "all"):
            library.crops[phase_id] = Crop(phase_id, phase.name, phase.category, (phase,))
    for crop_id, name, (first, second) in DOUBLE_CROPS.get(region, ()):
        a, b = rows.get((region, first)), rows.get((region, second))
        if a is None or b is None:
            continue
        if region == "tropics":
            b = replace(b, plant_doy=TROPICS_SECOND_PLANT_DOY)
        library.crops[crop_id] = Crop(crop_id, name, "cash", (a, b))
    return library


def rooting_class(crop: Crop) -> str | None:
    depth = crop.root_m_max
    if depth is None:
        return None
    return "shallow" if depth < 1.0 else "medium" if depth <= 1.5 else "deep"


def water_demand_class(crop: Crop) -> str | None:
    peak = crop.kc_mid_max
    if peak is None:
        return None
    if len(crop.phases) > 1:
        return "high"
    return "low" if peak < 1.05 else "medium" if peak <= 1.15 else "high"

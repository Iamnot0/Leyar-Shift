"""The current rotation, read from crop history or supplied by the farmer, and the alternatives to compare it with."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from itertools import permutations

from app.modeling.crops import Crop, CropLibrary
from app.modeling.simulate import RotationYear

RECENT_YEARS = 10
MAJORITY_SHARE = 0.5
CLEAN_CYCLE_SHARE = 0.8
MAX_CYCLE = 4
NON_CROP_CLASSES = ("Grass/Pasture", "Developed", "Shrubland", "Wetlands", "Open Water", "Forest", "Barren", "Background", "Perennial Ice")


@dataclass
class Observed:
    """What the crop map shows on the field in one year."""

    year: int
    crop_id: str | None
    share: float
    class_name: str
    n_cells: int


@dataclass
class Baseline:
    years: list[RotationYear]
    source: str
    consistent_share: float | None
    observed: list[Observed]
    clean_cycle: bool

    @property
    def basis(self) -> str | None:
        if self.source != "cdl_derived":
            return None
        return "repeating_cycle" if self.clean_cycle else "recent_years"


@dataclass
class Candidate:
    years: list[RotationYear]
    change_level: str
    note: str

    @property
    def key(self) -> tuple[tuple[str, str | None], ...]:
        return canonical(self.years)


def canonical(years: list[RotationYear]) -> tuple[tuple[str, str | None], ...]:
    """The same rotation started in a different year is the same rotation."""
    items = [(year.crop.id, year.cover.id if year.cover else None) for year in years]
    return min(tuple(items[i:] + items[:i]) for i in range(len(items)))


def _year_name(year: RotationYear) -> str:
    """A year with two crops is named by both, in the order they are grown."""
    phases = year.crop.phases
    same = len({phase.id for phase in phases}) == 1
    name = year.crop.name if same else " then ".join(phase.name.split(" (")[0].lower() for phase in phases)
    return name + (" with a cover crop after harvest" if year.cover is not None else "")


def label(years: list[RotationYear]) -> str:
    names = [_year_name(year) for year in years]
    capital = lambda text: text[0].upper() + text[1:]  # noqa: E731
    if len(names) == 1:
        if names[0].endswith("a year"):
            return capital(names[0])
        return f"{capital(names[0])}{',' if len(years[0].crop.phases) > 1 else ''} every year"
    if any(len(year.crop.phases) > 1 for year in years):
        return capital("; ".join(f"year {index}: {name[0].lower() + name[1:]}" for index, name in enumerate(names, start=1)))
    return ", then ".join([capital(names[0])] + [name[0].lower() + name[1:] for name in names[1:]])


def observe(history: dict[int, dict[int, float]], class_names: dict[int, str], library: CropLibrary, cells_read: dict[int, int] | None = None) -> list[Observed]:
    observed = []
    for year in sorted(history):
        code, share = max(history[year].items(), key=lambda item: item[1])
        name = class_names.get(code, f"class {code}")
        crop_id = library.from_cdl(name) if share >= MAJORITY_SHARE else None
        observed.append(Observed(year, crop_id, share, name, (cells_read or {}).get(year, 0)))
    return observed


def detect_baseline(history: dict[int, dict[int, float]], class_names: dict[int, str], library: CropLibrary,
                    cells_read: dict[int, int] | None = None) -> Baseline | None:
    """The shortest repeating sequence in the recent crop history, or the most recent years if nothing repeats cleanly."""
    observed = observe(history, class_names, library, cells_read)
    recent = [row.crop_id for row in observed[-RECENT_YEARS:]]
    known = [crop_id for crop_id in recent if crop_id]
    if len(known) < 3:
        return None
    best: tuple[float, int, list[str]] | None = None
    for cycle in range(1, MAX_CYCLE + 1):
        pattern = recent[-cycle:]
        if any(crop_id is None for crop_id in pattern):
            continue
        matches = [recent[-1 - back] == pattern[-1 - (back % cycle)] for back in range(len(recent)) if recent[-1 - back] is not None]
        share = sum(matches) / len(matches)
        if share >= CLEAN_CYCLE_SHARE:
            best = (share, cycle, pattern)
            break
        if best is None or share > best[0]:
            best = (share, cycle, pattern)
    if best is None:
        common = Counter(known).most_common(1)[0][0]
        best = (known.count(common) / len(known), 1, [common])
    share, _, pattern = best
    years = [RotationYear(library.crops[crop_id]) for crop_id in pattern]
    return Baseline(years, "cdl_derived", share, observed, share >= CLEAN_CYCLE_SHARE)


def from_farmer(entered: list[dict], library: CropLibrary) -> tuple[list[RotationYear] | None, str | None]:
    years = []
    for entry in entered:
        crop = library.get(entry["crop_id"])
        if crop is None or crop.category == "cover":
            return None, entry["crop_id"]
        cover = None
        if entry.get("cover_crop_id"):
            cover_crop = library.get(entry["cover_crop_id"])
            if cover_crop is None or cover_crop.category != "cover":
                return None, entry["cover_crop_id"]
            cover = cover_crop.phases[0]
        years.append(RotationYear(crop, cover))
    return years, None


def longest_family_run(years: list[RotationYear]) -> int | None:
    """Years in a row under one crop family, counting around the end of the cycle. Capped at 4, which also means never broken."""
    sets = [frozenset(year.crop.families) for year in years]
    if not any(sets):
        return None
    # A fallow year, or a year with two families, breaks the run.
    single = [next(iter(families)) if len(families) == 1 else None for families in sets]
    if all(family is not None and family == single[0] for family in single):
        return 4
    longest = current = 0
    previous: str | None = None
    for family in single + single:
        current = 0 if family is None else current + 1 if family == previous else 1
        previous = family
        longest = max(longest, current)
    return max(1, min(longest, 4))


def build_candidates(baseline: list[RotationYear], suitable: list[Crop], cover, *, allow_fallow: bool, require_forage: bool) -> list[Candidate]:
    """Low-change options keep the farmer's crops. High-change options are new two- and three-year sequences."""
    base_key = canonical(baseline)
    base_ids = {year.crop.id for year in baseline}
    mains = [crop for crop in suitable if crop.category in ("cash", "forage") or (allow_fallow and crop.category == "fallow")]
    found: dict[tuple, Candidate] = {}

    def add(years: list[RotationYear], level: str, note: str) -> None:
        if not years or all(year.crop.category == "fallow" for year in years):
            return
        if require_forage and not any(year.crop.category == "forage" for year in years):
            return
        key = canonical(years)
        if key != base_key and key not in found:
            found[key] = Candidate(years, level, note)

    if cover is not None and any(year.cover is None and year.crop.category != "fallow" for year in baseline):
        add([RotationYear(year.crop, cover if year.crop.category != "fallow" and not year.crop.phases[0].perennial else year.cover) for year in baseline],
            "low", "Keeps your crops and adds a cover crop after harvest.")
    for crop in mains:
        if crop.id in base_ids:
            continue
        if len(baseline) < MAX_CYCLE:
            add(baseline + [RotationYear(crop)], "low", f"Keeps your crops and adds a year of {crop.name.lower()}.")
        for position in range(len(baseline)):
            if len(baseline) > 1:
                swapped = list(baseline)
                swapped[position] = RotationYear(crop)
                add(swapped, "low", f"Swaps one year for {crop.name.lower()}.")
    crops_only = [crop for crop in mains if crop.category != "fallow"]
    for size in (2, 3):
        for combo in permutations(crops_only if size == 2 else crops_only[:5], size):
            years = [RotationYear(crop) for crop in combo]
            shared = len({crop.id for crop in combo} & base_ids)
            add(years, "low" if shared == len(base_ids) and len(combo) == len(base_ids) + 1 else "high", "A different sequence of crops suited to this field.")
    if not found and len(crops_only) == 1:
        add([RotationYear(crops_only[0])], "high", "The only other crop suited to this field.")
    return list(found.values())


def crops_per_year(years: list[RotationYear]) -> float:
    """Crops grown per year, averaged over the cycle. A fallow year counts as none."""
    return sum(1 for year in years for phase in year.crop.phases if phase.stages or phase.perennial) / len(years)

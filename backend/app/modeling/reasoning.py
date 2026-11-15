"""How a finished analysis reached its result, rebuilt step by step from the analysis document.

The engine computes every number. A language model may only word the ranking facts as a summary, and its reply
is shown only when every number in it is one of those facts and it introduces no advice, ratio or crop of its own.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import threading
from collections.abc import Callable
from typing import Any

import httpx

from app.core import config
from app.core.config import Settings
from app.core.records import Records
from app.core.provenance import ACCESS_LABELS, CROP_FIT_CHECK_LABELS, CROP_FIT_STATUS_LABELS, NULL_LABELS, PRIORITY_LABELS

ANALYSIS_ID = re.compile(r"[0-9a-f]{32}")
KEY_NAME = "OPENROUTER_API_KEY"
ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
BRIEF_STEPS = ("runs", "weights", "ranking")
MAX_WORDS = 90
PROMPT = (
    "You write a short summary of a crop-rotation comparison for a farmer, using only the facts you are given. "
    "Write plain sentences, under 70 words in all. Copy every number exactly as it is written in the facts, in digits, with its unit. "
    "Do not work out new numbers, differences or ratios. Do not give advice or tell the farmer what to do. "
    "Name only rotations and crops that appear in the facts. Plain text only, no lists or headings."
)

# Takes the instructions and the facts, returns the model's reply. Raises on any transport failure.
Complete = Callable[[str, str], str]

ACCESS = {tier.value: label.lower() for tier, (label, _) in ACCESS_LABELS.items()}
NULLS = {reason.value: (label, description) for reason, (label, description) in NULL_LABELS.items()}
PRIORITIES = {priority: label for priority, label, _ in PRIORITY_LABELS}
CHECKS = {check: label for check, label, _ in CROP_FIT_CHECK_LABELS}
STATUSES = {status: label for status, label, _ in CROP_FIT_STATUS_LABELS}
UNITS = {"mm/yr": "mm a year", "days/yr": "days a year", "weeks/yr": "weeks a year", "mm/m": "mm in each metre of soil",
         "percent": "%", "degC": "°C", "index": ""}

NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
WORD_NUMBERS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "hundred": 100, "thousand": 1000, "million": 1_000_000, "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
    "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10,
}
WORD_NUMBER = re.compile(r"\b(" + "|".join(WORD_NUMBERS) + r")\b", re.IGNORECASE)
NEXT_WORD = re.compile(r"\s?(%|[^\W\d_]+)")
UNIT_WORDS = {"%", "mm", "day", "week", "ha", "year", "run", "square", "m", "out"}
UNIT_ALIASES = {"percent": "%", "hectare": "ha", "metre": "m", "meter": "m"}
RATIO = re.compile(r"\b(twice|double[ds]?|triple[ds]?|half|halve[ds]?|quarters?|times)\b", re.IGNORECASE)
ADVICE = re.compile(r"\b(should|must|ought|recommend\w*|advis\w*|suggest\w*|consider\w*|urge\w*|needs? to|make sure|be sure|irrigat\w*|"
                    r"fertili[sz]\w*|spray\w*|pesticides?|herbicides?|insur\w*|sell|buy|invest\w*)\b", re.IGNORECASE)
IMPERATIVE = re.compile(r"(?:^|[.!?]\s+)(plant|grow|switch|add|avoid|choose|go|talk|check|ask|start|stop|try|apply|change|stick)\b", re.IGNORECASE)
CROP = re.compile(r"\b(alfalfa|barley|bean|canola|chickpea|clover|corn|cotton|lentil|maize|millet|oat|pea|peanut|potato|pulse|rapeseed|"
                  r"rice|rye|sorghum|soybean|sugarcane|sunflower|triticale|vetch|wheat)(?:e?s)?\b", re.IGNORECASE)

_locks: dict[str, threading.Lock] = {}


def build(analysis: dict[str, Any], settings: Settings, complete: Complete | None = None) -> dict[str, Any]:
    """The engine's steps for one finished analysis, and a summary of its ranking."""
    if not ANALYSIS_ID.fullmatch(analysis["analysis_id"]):
        raise ValueError("Not an analysis id")
    cache = (settings.records, f"summaries/{analysis['analysis_id']}")
    ranked = sorted(analysis["rotations"], key=lambda rotation: (rotation["overall"]["rank"] is None, rotation["overall"]["rank"] or 0))
    steps = [_field(analysis), _conditions(analysis), _crop_fit(analysis), _runs(analysis), _scores(ranked),
             _weights(analysis), _ranking(analysis, ranked)]
    brief = [_line(fact) for step in steps if step["id"] in BRIEF_STEPS for fact in step["facts"]]
    return {"analysis_id": analysis["analysis_id"], "steps": steps, "summary": _summary(analysis, ranked, brief, cache, settings, complete)}


# ---------------------------------------------------------------- the steps


def _step(step_id: str, title: str, method: str, facts: list[dict]) -> dict:
    return {"id": step_id, "title": title, "method": method, "facts": facts}


def _fact(label: str, text: str, source: str, value: float | None = None, datasets: list[str] | None = None, group: str | None = None) -> dict:
    return {"group": group, "label": label, "text": text, "value": value, "source": source, "dataset_ids": list(datasets or [])}


def _field(analysis: dict) -> dict:
    field, grid = analysis["field"], analysis["field"]["grid"]
    facts = [
        _fact("Field area", f"{field['area_ha']:.1f} ha", "field.area_ha", field["area_ha"]),
        _fact("Grid", f"{grid['n_cells']:,} squares of {_num(grid['cell_size_m'])} m", "field.grid.n_cells", grid["n_cells"]),
    ]
    for dataset in sorted(analysis["datasets"], key=lambda dataset: dataset["status"] != "available"):
        if dataset["status"] == "available":
            tier = f" ({ACCESS[dataset['access_tier']]})" if dataset["access_tier"] else ""
            text, group = f"{dataset['role']}{tier}", "Used"
        else:
            # The reason in full; the short status label belongs on the sources card, not in a sentence.
            _, description = NULLS.get(dataset["null_reason"], ("Not used", ""))
            text, group = dataset["message"] or description, "Not used"
        facts.append(_fact(dataset["name"], text, f"datasets[id={dataset['id']}].status", None, [dataset["id"]], group))
    return _step("field", "Read your field and the data sources",
                 "The boundary is laid on a grid of squares, and every source is asked whether it covers this place. "
                 "Only sources with data for this field are used.", facts)


def _conditions(analysis: dict) -> dict:
    facts = [_fact(f"Kind of year: {name}", f"{analysis['scenario'][key]['label']}. {analysis['scenario'][key]['definition']}", f"scenario.{key}.definition")
             for key, name in (("rainfall", "rain"), ("temperature", "heat"))]
    for item in analysis["field_evidence"]:
        quantity = item["quantity"]
        text = item["summary"] if quantity["value"] is not None else quantity["null_explanation"] or item["summary"]
        facts.append(_fact(item["title"], text, f"field_evidence[id={item['id']}].quantity.value", quantity["value"], quantity["dataset_ids"]))
    return _step("conditions", "Measured the field's conditions",
                 "Rain, heat, frost, soil water and slope come from the sources in use. They hold whatever is grown.", facts)


def _crop_fit(analysis: dict) -> dict:
    facts, seen = [], set()
    for rotation in analysis["rotations"]:
        for fit in rotation["crop_fit"]:
            if fit["crop_id"] in seen:
                continue
            seen.add(fit["crop_id"])
            for check in fit["checks"]:
                quantity = check["quantity"]
                source = f"rotations[id={rotation['id']}].crop_fit[crop_id={fit['crop_id']}].checks[check={check['check']}].quantity.value"
                facts.append(_fact(CHECKS[check["check"]], f"{STATUSES[check['status']]}. {check['text']}", source, quantity["value"],
                                   quantity["dataset_ids"], fit["crop_name"]))
    return _step("crop_fit", "Checked each crop against the field",
                 "Each crop is checked for season length, heat, frost and the water supply you gave. "
                 "A crop in more than one rotation is shown once, as grown in the first rotation that has it.", facts)


def _runs(analysis: dict) -> dict:
    uncertainty, record = analysis["uncertainty"], analysis["scenario"]["rainfall"]["quantity"]
    facts = []
    if record and record["period"]:
        years = f", {record['n_valid_obs']} years" if record["n_valid_obs"] is not None else ""
        facts.append(_fact("Weather record", f"{record['period']['start'][:4]} to {record['period']['end'][:4]}{years}",
                           "scenario.rainfall.quantity.period", None, record["dataset_ids"]))
    facts += [
        _fact("Weather years tried", f"{uncertainty['n_runs']} weather years, the same for every rotation", "uncertainty.n_runs", uncertainty["n_runs"]),
        _fact("How each one is drawn", uncertainty["method"], "uncertainty.method"),
    ]
    facts += [_fact(driver["label"], f"{_percent(driver['share'])} of the spread in the overall score", f"uncertainty.drivers[id={driver['id']}].share",
                    driver["share"], group="What moves the overall score")
              for driver in uncertainty["drivers"] if driver["share"] is not None]
    return _step("runs", "Ran every rotation through the same weather",
                 "Each weather year steps a daily soil water budget (FAO-56) through one year drawn from the weather record. "
                 "Every rotation gets the same weather years, so they are compared like for like.", facts)


def _scores(ranked: list[dict]) -> dict:
    facts = []
    for rotation in ranked:
        for score in sorted(rotation["scores"], key=lambda score: -score["weight"]):
            facts.append(_fact(_measure(score), _score_text(score), f"rotations[id={rotation['id']}].scores[id={score['id']}].value", score["value"],
                               _score_datasets(score), _name(rotation)))
    return _step("scores", "Scored each rotation",
                 "Each measure becomes a score out of 100, where higher is always better. The middle score of all the weather years is shown, "
                 "with the physical amount behind it.", facts)


def _weights(analysis: dict) -> dict:
    unscored = {score["id"] for rotation in analysis["rotations"] for score in rotation["scores"] if score["value"] is None}
    facts = []
    for weight in sorted(analysis["weights"], key=lambda weight: (weight["rank"] is None, weight["rank"] or 0)):
        label = PRIORITIES[weight["priority"]]
        if weight["rank"] is None:
            text = "Not ranked by you, so it does not count"
        else:
            label = f"{weight['rank']}. {label}"
            text = f"{_percent(weight['weight'])} of the overall score"
            if weight["score_id"] in unscored:
                text += ", left out because it could not be scored for every rotation"
        facts.append(_fact(label, text, f"weights[priority={weight['priority']}].weight", weight["weight"]))
    return _step("weights", "Turned your ranking into weights",
                 "Your first priority counts most and each later one less. "
                 "A priority that could not be scored for every rotation is left out of the ranking.", facts)


def _ranking(analysis: dict, ranked: list[dict]) -> dict:
    facts = []
    for rotation in ranked:
        overall, group = rotation["overall"], _name(rotation)
        source = f"rotations[id={rotation['id']}].overall"
        if overall["value"] is None:
            facts.append(_fact("Not ranked", overall["null_explanation"] or "No overall score.", f"{source}.null_explanation", group=group))
            continue
        spread = f", {_whole(overall['low'])} to {_whole(overall['high'])} in most weather years" if overall["low"] is not None and overall["high"] is not None else ""
        facts.append(_fact(f"Rank {overall['rank']}", f"{_score(overall['value'])}{spread}", f"{source}.value", overall["value"], group=group))
        stability = overall["rank_stability"]
        if stability["share_ranked_first"] is not None:
            facts.append(_fact("Came out first in", f"{_percent(stability['share_ranked_first'])} of the {stability['n_runs']} weather years",
                               f"{source}.rank_stability.share_ranked_first", stability["share_ranked_first"], group=group))
    best, current = _best(ranked), _current(analysis)
    if best:
        close_call = analysis.get("close_call")
        facts.append(_fact("Close call", close_call["text"], "close_call.text") if close_call
                     else _fact("Close call", "No. The first-ranked rotation is clearly ahead of every other.", "close_call"))
    if analysis.get("ranking_note"):
        facts.append(_fact("Left out", analysis["ranking_note"], "ranking_note"))
    if best and best["id"] != current["id"]:
        labels = {score["id"]: (_measure(score), score["weight"]) for score in best["scores"]}
        for tradeoff in sorted(best["tradeoffs"], key=lambda tradeoff: -labels[tradeoff["score_id"]][1]):
            facts.append(_fact(labels[tradeoff["score_id"]][0], tradeoff["text"],
                               f"rotations[id={best['id']}].tradeoffs[score_id={tradeoff['score_id']}].share_of_runs_better",
                               tradeoff["share_of_runs_better"], group=f"{best["label"]} against what you grow now"))
    return _step("ranking", "Ranked the rotations across the weather years",
                 "In each weather year a rotation's overall score is the weighted mean of its scores. Rotations are ranked by their middle overall score, "
                 "and the share of weather years each one came out first in shows how settled the ranking is.", facts)


# ---------------------------------------------------------------- the summary


def _summary(analysis: dict, ranked: list[dict], brief: list[str], cache: tuple[Records, str], settings: Settings, complete: Complete | None) -> dict:
    engine_text = _engine_summary(analysis, ranked)
    if complete is None:
        key = settings.key(KEY_NAME) if settings.fetch_mode == "live" else None
        if not key:
            return _summary_doc(engine_text, "not_configured", None, None, [])
        complete = _openrouter(key)
    try:
        reply = _reply(cache, brief, complete)
    except httpx.TimeoutException:
        return _summary_doc(engine_text, "failed", config.SUMMARY_MODEL, f"The model did not answer within {config.SUMMARY_TIMEOUT_S:g} seconds.", brief)
    except httpx.HTTPStatusError:
        return _summary_doc(engine_text, "failed", config.SUMMARY_MODEL, "The model service refused the request.", brief)
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        return _summary_doc(engine_text, "failed", config.SUMMARY_MODEL, "The model's answer could not be read.", brief)
    problem = check_reply(reply, brief)
    if problem:
        return _summary_doc(engine_text, "rejected", config.SUMMARY_MODEL, problem, brief)
    return _summary_doc(reply, "accepted", config.SUMMARY_MODEL, None, brief)


def _summary_doc(text: str, status: str, model: str | None, note: str | None, brief: list[str]) -> dict:
    return {"text": text, "status": status, "model": model, "status_note": note, "facts_given": brief}


def _engine_summary(analysis: dict, ranked: list[dict]) -> str:
    """The summary from the same facts the model is given, rounded the same way."""
    best, current = _best(ranked), _current(analysis)
    if best is None:
        return current["overall"]["null_explanation"] or "The rotations could not be ranked."
    overall = best["overall"]
    if best["id"] == current["id"]:
        parts = [f"What you grow now, {_lower(best["label"])}, comes out first at {_score(overall['value'])}."]
    else:
        against = f", against {_whole(current['overall']['value'])} for what you grow now" if current["overall"]["value"] is not None else ""
        parts = [f"{best["label"]} comes out first at {_score(overall['value'])}{against}."]
    stability = overall["rank_stability"]
    if stability["share_ranked_first"] is not None:
        parts.append(f"It came out first in {_percent(stability['share_ranked_first'])} of the {stability['n_runs']} weather years.")
    top = next((weight for weight in analysis["weights"] if weight["rank"] == 1), None)
    if top:
        parts.append(f"Your first priority, {_lower(PRIORITIES[top['priority']])}, carries {_percent(top['weight'])} of the overall score.")
    if analysis.get("close_call"):
        parts.append(analysis["close_call"]["text"])
    if analysis.get("ranking_note"):
        parts.append(analysis["ranking_note"])
    return " ".join(parts)


def _reply(cache: tuple[Records, str], brief: list[str], complete: Complete) -> str:
    """The model's reply, asked once per analysis and set of facts and kept as a record."""
    records, key = cache
    digest = hashlib.sha256(json.dumps([config.SUMMARY_MODEL, PROMPT, brief]).encode()).hexdigest()
    with _locks.setdefault(key, threading.Lock()):
        kept = records.get(key)
        if isinstance(kept, dict) and kept.get("digest") == digest:
            return kept["reply"]
        reply = complete(PROMPT, "Facts:\n" + "\n".join(f"- {line}" for line in brief))
        records.put(key, {"digest": digest, "model": config.SUMMARY_MODEL, "reply": reply})
        return reply


def _openrouter(key: str) -> Complete:
    def complete(instructions: str, facts: str) -> str:
        response = httpx.post(ENDPOINT, headers={"Authorization": f"Bearer {key}"}, timeout=config.SUMMARY_TIMEOUT_S, json={
            "model": config.SUMMARY_MODEL, "temperature": 0, "max_tokens": 220,
            "messages": [{"role": "system", "content": instructions}, {"role": "user", "content": facts}],
        })
        response.raise_for_status()
        return (response.json()["choices"][0]["message"]["content"] or "").strip()

    return complete


def check_reply(reply: str, brief: list[str]) -> str | None:
    """Why the reply cannot stand in for the facts, or None when every number and claim in it is one of them."""
    facts = "\n".join(brief)
    words = len(reply.split())
    if words == 0:
        return "It wrote no summary."
    if words > MAX_WORDS:
        return f"It wrote {words} words, more than the summary allows."
    known = _numbers(facts)
    values, pairs = {value for value, _, _ in known}, {(value, unit) for value, unit, _ in known if unit}
    for value, unit, token in _numbers(reply):
        if value not in values:
            return f"It gave the number {token}, which is not in the results."
        if unit and (value, unit) not in pairs:
            return f"It gave {token} as {unit}, which does not match the results."
    if word := _new_word(RATIO, reply, facts):
        return f"It compared numbers with the word “{word}”, which the results do not support."
    imperative = IMPERATIVE.search(reply)
    if word := _new_word(ADVICE, reply, facts) or (imperative and imperative.group(1)):
        return f"It gave advice (“{word}”) that the results do not support."
    if word := _new_word(CROP, reply, facts):
        return f"It named {word}, which is not in this comparison."
    return None


def _numbers(text: str) -> list[tuple[float, str | None, str]]:
    found = [(float(match.group().replace(",", "")), _unit_after(text, match.end()), match.group()) for match in NUMBER.finditer(text)]
    found += [(float(WORD_NUMBERS[match.group().lower()]), _unit_after(text, match.end()), match.group()) for match in WORD_NUMBER.finditer(text)]
    return found


def _unit_after(text: str, at: int) -> str | None:
    match = NEXT_WORD.match(text, at)
    if not match:
        return None
    word = match.group(1).lower()
    singular = word.removesuffix("s") if len(word) > 2 else word
    unit = UNIT_ALIASES.get(singular, singular)
    return unit if unit in UNIT_WORDS else None


def _new_word(pattern: re.Pattern[str], reply: str, facts: str) -> str | None:
    """The first word the pattern finds in the reply that the facts do not use themselves."""
    known = {match.group(1).lower() for match in pattern.finditer(facts)}
    return next((match.group() for match in pattern.finditer(reply) if match.group(1).lower() not in known), None)


# ---------------------------------------------------------------- words and numbers


def _line(fact: dict) -> str:
    return f"{fact['group']} / {fact['label']}: {fact['text']}" if fact["group"] else f"{fact['label']}: {fact['text']}"


def _best(ranked: list[dict]) -> dict | None:
    return next((rotation for rotation in ranked if rotation["overall"]["rank"] == 1), None)


def _current(analysis: dict) -> dict:
    return next((rotation for rotation in analysis["rotations"] if rotation["role"] == "current"), analysis["rotations"][0])


def _name(rotation: dict) -> str:
    return f"{rotation['label']} (what you grow now)" if rotation["role"] == "current" else rotation["label"]


def _lower(text: str) -> str:
    return text[:1].lower() + text[1:]


def _whole(value: float) -> int:
    # Half up, as the interface rounds, so the same value never shows as two numbers.
    return math.floor(value + 0.5)


def _num(value: float) -> str:
    if abs(value) >= 100 or float(value).is_integer():
        return f"{_whole(value):,}"
    return f"{value:.1f}".removesuffix(".0") if abs(value) >= 1 else f"{value:.2f}"


def _percent(share: float) -> str:
    return f"{_whole(share * 100)}%"


def _score(value: float) -> str:
    return f"{_whole(value)} out of 100"


def _amount(value: float, unit: str) -> str:
    if unit.endswith("/ha/yr"):
        return f"{_num(value)} {unit.split('/')[0]} a hectare a year"
    if unit == "fraction":
        return _percent(value)
    words = UNITS.get(unit, unit)
    return f"{_num(value)}%" if words == "%" else f"{_num(value)} {words}".rstrip()


def _measure(score: dict) -> str:
    return score["physical_label"] or score["label"]


def _score_text(score: dict) -> str:
    if score["value"] is None:
        return f"Not scored. {score['null_explanation']}"
    physical = score["physical"]
    amount = f" ({_amount(physical['value'], physical['unit'])})" if physical and physical["value"] is not None else ""
    return f"{_score(score['value'])}{amount}"


def _score_datasets(score: dict) -> list[str]:
    quantities = [score["physical"]] if score["physical"] else []
    quantities += [component["quantity"] for component in score["components"]]
    return list(dict.fromkeys(dataset for quantity in quantities for dataset in quantity["dataset_ids"]))

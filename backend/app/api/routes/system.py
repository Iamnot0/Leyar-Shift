"""Liveness and the vocabulary every client label comes from."""

from __future__ import annotations

from fastapi import APIRouter

from app.core import config, provenance
from app.modeling.report import SCORE_LABELS, SCORE_PRIORITY

router = APIRouter(prefix="/v1")


def _labels(rows) -> list[dict[str, str]]:
    return [{"id": str(row[0]), "label": row[1], "description": row[2]} for row in rows]


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "contract_version": config.CONTRACT_VERSION}


@router.get("/meta")
def meta() -> dict:
    scenario = lambda table: [{"id": key, "label": spec["label"], "description": spec["definition"]} for key, spec in table.items()]  # noqa: E731
    return {
        "contract_version": config.CONTRACT_VERSION,
        "disclaimer": provenance.DISCLAIMER,
        "interval": {"id": config.INTERVAL[0], "description": f"The range from the 10th to the 90th percentile of {config.UNCERTAINTY_RUNS} runs: 8 runs in 10 fall inside it."},
        "evidence_kinds": [{"id": kind.value, "label": label, "description": text} for kind, (label, text) in provenance.EVIDENCE_LABELS.items()],
        "access_tiers": [{"id": tier.value, "label": label, "description": text} for tier, (label, text) in provenance.ACCESS_LABELS.items()],
        "null_reasons": [{"id": reason.value, "label": label, "description": text} for reason, (label, text) in provenance.NULL_LABELS.items()],
        "needs_local_judgment": {"id": provenance.NEEDS_LOCAL_JUDGMENT[0], "label": provenance.NEEDS_LOCAL_JUDGMENT[1], "description": provenance.NEEDS_LOCAL_JUDGMENT[2]},
        "scores": [{"id": score_id, "label": label, "description": description, "composite": composite, "physical_label": physical_label,
                    "physical_unit": unit, "physical_higher_is_better": better, "priority": SCORE_PRIORITY[score_id]}
                   for score_id, (label, physical_label, unit, better, composite, description) in SCORE_LABELS.items()],
        "priorities": _labels(provenance.PRIORITY_LABELS),
        "zone_hazards": _labels(provenance.ZONE_HAZARD_LABELS),
        "calendar_hazards": _labels(provenance.CALENDAR_HAZARD_LABELS),
        "risk_levels": _labels(provenance.RISK_LEVEL_LABELS),
        "rainfall_scenarios": scenario(config.RAINFALL_SCENARIOS),
        "temperature_scenarios": scenario(config.TEMPERATURE_SCENARIOS),
        "cover_states": _labels(provenance.COVER_STATE_LABELS),
        "job_stages": [{"id": stage, "label": label, "description": label + "."} for stage, label in provenance.JOB_STAGES],
        "equipment": _labels(provenance.EQUIPMENT_LABELS),
        "tradeoff_directions": _labels(provenance.TRADEOFF_LABELS),
        "crop_fit_statuses": _labels(provenance.CROP_FIT_STATUS_LABELS),
        "crop_fit_checks": _labels(provenance.CROP_FIT_CHECK_LABELS),
        "layer_kinds": _labels(provenance.LAYER_KIND_LABELS),
        "detection_bases": _labels(provenance.DETECTION_BASIS_LABELS),
        "tradeoff_rule": {
            "better_share_min": config.TRADEOFF_BETTER_SHARE, "worse_share_max": config.TRADEOFF_WORSE_SHARE,
            "similar_score_delta_max": config.TRADEOFF_SIMILAR_DELTA,
            "description": (f"Both rotations face the same weather, soil and crop draws in each of {config.UNCERTAINTY_RUNS} runs. The share is the runs in which the "
                            f"rotation scored strictly higher; level runs are not counted as wins. Better: at least {config.TRADEOFF_BETTER_SHARE:.0%} of runs. "
                            f"Worse: {config.TRADEOFF_WORSE_SHARE:.0%} or fewer. About the same: the typical difference is under {config.TRADEOFF_SIMILAR_DELTA:g} points. "
                            "Otherwise it is too close to call."),
        },
    }

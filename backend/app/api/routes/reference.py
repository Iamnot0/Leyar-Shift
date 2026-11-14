"""Coverage, the crop list and map context layers."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import get_context, problem_from
from app.modeling import analysis, briefing
from app.modeling.engine import AnalysisError
from app.schemas import models

router = APIRouter(prefix="/v1")


@router.post("/coverage")
def coverage(body: models.CoverageRequest):
    try:
        return analysis.coverage(body.model_dump(mode="json")["geometry"], get_context())
    except AnalysisError as error:
        return problem_from(error)


@router.post("/crop-history")
def crop_history(body: models.CoverageRequest):
    try:
        return analysis.crop_history(body.model_dump(mode="json")["geometry"], get_context())
    except AnalysisError as error:
        return problem_from(error)


@router.get("/crops")
def crops(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)) -> dict:
    return analysis.crop_list(lat, lon, get_context())


@router.get("/layers")
def layers(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)) -> dict:
    return analysis.layers(lat, lon, get_context())


@router.get("/outlook")
def outlook(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)) -> dict:
    return analysis.outlook(lat, lon, get_context())


@router.get("/briefing")
def field_briefing(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)) -> dict:
    return briefing.build(lat, lon, get_context())

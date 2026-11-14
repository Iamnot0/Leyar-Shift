"""Analysis jobs, their zone layers and how each result was reached."""

from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse

from app.api.deps import get_context, problem, problem_from
from app.api.jobs import JobStore
from app.core.config import get_settings
from app.modeling import analysis, reasoning
from app.modeling.engine import AnalysisError
from app.schemas import models

router = APIRouter(prefix="/v1")


@lru_cache
def get_store() -> JobStore:
    settings = get_settings()
    return JobStore(settings.records, settings.inline_jobs)


@router.post("/analyses", status_code=202)
def create_analysis(body: models.AnalysisRequest, response: Response):
    request = body.model_dump(mode="json")
    ctx = get_context()
    try:
        analysis.check_request(request, ctx)
    except AnalysisError as error:
        return problem_from(error)
    job = get_store().submit(request, ctx)
    return JSONResponse(job, status_code=202, headers={"Location": f"/v1/analyses/{job['analysis_id']}"})


@router.get("/analyses/{analysis_id}")
def get_analysis(analysis_id: str):
    job = get_store().read(analysis_id) if analysis_id.isalnum() else None
    if job is None:
        return problem(404, "not_found", "No such analysis", "No analysis has this id. Start one with POST /v1/analyses.")
    return job


@router.get("/analyses/{analysis_id}/zones")
def get_zones(analysis_id: str):
    store = get_store()
    job = store.read(analysis_id) if analysis_id.isalnum() else None
    if job is None:
        return problem(404, "not_found", "No such analysis", "No analysis has this id. Start one with POST /v1/analyses.")
    zones = store.zones(analysis_id)
    if job["status"] != "done" or zones is None:
        return problem(409, "not_finished", "The analysis is not finished", f"This analysis is {job['status']}. Zones exist once it is done.")
    return zones


@router.get("/analyses/{analysis_id}/reasoning")
def get_reasoning(analysis_id: str):
    job = get_store().read(analysis_id) if reasoning.ANALYSIS_ID.fullmatch(analysis_id) else None
    if job is None:
        return problem(404, "not_found", "No such analysis", "No analysis has this id. Start one with POST /v1/analyses.")
    if job["status"] != "done" or job["result"] is None:
        state = "ended with an error" if job["status"] == "error" else f"is {job['status']}"
        return problem(409, "not_finished", "The analysis is not finished", f"This analysis {state}. Its steps exist once it is done.")
    return reasoning.build(job["result"], get_settings())

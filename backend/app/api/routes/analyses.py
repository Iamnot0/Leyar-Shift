"""Analysis jobs, their zone layers and how each result was reached."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from functools import lru_cache

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse

from app.api.deps import get_context, problem, problem_from
from app.api.jobs import JobStore
from app.core import config
from app.core.config import get_settings
from app.fusion.grid import FieldError, read_field
from app.modeling import analysis, reasoning
from app.modeling.engine import AnalysisError
from app.schemas import models

router = APIRouter(prefix="/v1")


@lru_cache
def get_store() -> JobStore:
    settings = get_settings()
    return JobStore(settings.records, settings.inline_jobs)


def field_longitude(geometry: dict) -> float | None:
    """Where the field is decides its date; a geometry that cannot be read is refused later with the reason."""
    try:
        return read_field(geometry).centroid.x
    except FieldError:
        return None


@router.post("/analyses", status_code=202)
async def create_analysis(body: models.AnalysisRequest, response: Response):
    request = body.model_dump(mode="json")
    ctx = get_context(field_longitude(request["field"]["geometry"]))
    try:
        await asyncio.to_thread(analysis.check_request, request, ctx)
    except AnalysisError as error:
        return problem_from(error)
    job = await asyncio.to_thread(get_store().submit, request, ctx, after_reply=_after_reply())
    return JSONResponse(job, status_code=202, headers={"Location": f"/v1/analyses/{job['analysis_id']}"})


def _after_reply() -> Callable[[Callable[[], None]], None] | None:
    """On Vercel, the platform keeps the function alive for work handed to it after the reply. Elsewhere there is no such hand-off."""
    if not get_settings().inline_jobs:
        return None
    try:
        from vercel.cache.context import get_context as platform
    except ImportError:
        return None
    keep_alive = platform().wait_until
    if keep_alive is None:
        return None
    loop = asyncio.get_running_loop()
    # The hand-off belongs to the request's own event loop, so a worker thread schedules it there.
    return lambda work: loop.call_soon_threadsafe(keep_alive, asyncio.to_thread(work))


def finished(job: dict) -> bool:
    """A finished result never changes for this engine, unless a source failed and is worth asking again."""
    return job["status"] == "done" and not any(row["retryable"] for row in job["result"]["datasets"])


def _kept(body: dict, job: dict) -> JSONResponse:
    return JSONResponse(body, headers={"Cache-Control": config.CACHE_FINISHED} if finished(job) else {"Cache-Control": "no-store"})


@router.get("/analyses/{analysis_id}")
def get_analysis(analysis_id: str):
    job = get_store().read(analysis_id) if analysis_id.isalnum() else None
    if job is None:
        return problem(404, "not_found", "No such analysis", "No analysis has this id. Start one with POST /v1/analyses.")
    return _kept(job, job)


@router.get("/analyses/{analysis_id}/zones")
def get_zones(analysis_id: str):
    store = get_store()
    job = store.read(analysis_id) if analysis_id.isalnum() else None
    if job is None:
        return problem(404, "not_found", "No such analysis", "No analysis has this id. Start one with POST /v1/analyses.")
    zones = store.zones(analysis_id)
    if job["status"] != "done" or zones is None:
        return problem(409, "not_finished", "The analysis is not finished", f"This analysis is {job['status']}. Zones exist once it is done.")
    return _kept(zones, job)


@router.get("/analyses/{analysis_id}/reasoning")
def get_reasoning(analysis_id: str):
    job = get_store().read(analysis_id) if reasoning.ANALYSIS_ID.fullmatch(analysis_id) else None
    if job is None:
        return problem(404, "not_found", "No such analysis", "No analysis has this id. Start one with POST /v1/analyses.")
    if job["status"] != "done" or job["result"] is None:
        state = "ended with an error" if job["status"] == "error" else f"is {job['status']}"
        return problem(409, "not_finished", "The analysis is not finished", f"This analysis {state}. Its steps exist once it is done.")
    body = reasoning.build(job["result"], get_settings())
    # A model that did not answer this time may answer later, so that summary is not kept.
    return _kept(body, job) if body["summary"]["status"] != "failed" else JSONResponse(body, headers={"Cache-Control": "no-store"})

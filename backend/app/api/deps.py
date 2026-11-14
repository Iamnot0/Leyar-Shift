"""Shared request context and RFC 9457 problem responses."""

from __future__ import annotations

import os
from datetime import date
from functools import lru_cache
from typing import Any

from fastapi.responses import JSONResponse

from app.adapters.base import Fetcher
from app.core.clock import local_today
from app.core.config import get_settings
from app.modeling.engine import AnalysisError, Context

PROBLEM_JSON = "application/problem+json"


@lru_cache
def get_fetcher() -> Fetcher:
    settings = get_settings()
    return Fetcher(settings.http_cache_dir, mode=settings.fetch_mode)


def get_context(lon: float | None = None) -> Context:
    # A pinned date makes replayed runs reproducible; live runs use today where the field is.
    pinned = os.environ.get("FIELDSHIFT_TODAY")
    return Context(get_settings(), get_fetcher(), date.fromisoformat(pinned) if pinned else local_today(lon))


def problem(status: int, error_type: str, title: str, detail: str, errors: list[dict[str, str]] | None = None) -> JSONResponse:
    body: dict[str, Any] = {"type": error_type, "title": title, "status": status, "detail": detail}
    if errors:
        body["errors"] = errors
    return JSONResponse(body, status_code=status, media_type=PROBLEM_JSON)


def problem_from(error: AnalysisError) -> JSONResponse:
    return problem(error.status, error.error_type, error.title, error.detail)

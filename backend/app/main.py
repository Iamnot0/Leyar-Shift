"""Leyar Shift rotation API. Start with: uv run uvicorn app.main:app --port 8000"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any

import yaml
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException

from app.api.deps import get_fetcher, problem
from app.api.routes import analyses, reference, system
from app.core import config
from app.core.config import get_settings


@lru_cache
def contract() -> dict[str, Any]:
    return yaml.safe_load(get_settings().contract_path.read_text())


@asynccontextmanager
async def _lifespan(_: FastAPI):
    yield
    get_fetcher().close()


FREE_PATHS = ("/v1/health", "/v1/meta", "/openapi.json")


def _limit_requests(app: FastAPI, per_minute: int, behind_proxy: bool) -> None:
    """Cap what one client may ask of the routes that fetch or compute. Polling a job is never counted."""
    recent: dict[str, deque[float]] = defaultdict(deque)
    lock = threading.Lock()

    @app.middleware("http")
    async def rate_limit(request: Request, call_next):
        path = request.url.path
        polling = request.method == "GET" and path.startswith("/v1/analyses/")
        if per_minute > 0 and request.method in ("GET", "POST") and path.startswith("/v1/") and path not in FREE_PATHS and not polling:
            # Behind Vercel the peer is its proxy; the visitor is the first address Vercel forwards.
            forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip() if behind_proxy else ""
            client, now = forwarded or (request.client.host if request.client else "unknown"), time.monotonic()
            with lock:
                window = recent[client]
                while window and now - window[0] >= 60.0:
                    window.popleft()
                if len(window) >= per_minute:
                    wait = max(1, round(60.0 - (now - window[0])))
                    response = problem(429, "rate_limited", "Too many requests", f"This is more than {per_minute} requests in a minute. Try again in {wait} seconds.")
                    response.headers["Retry-After"] = str(wait)
                    return response
                window.append(now)
        return await call_next(request)


def create_app() -> FastAPI:
    app = FastAPI(title="Leyar Shift Rotation API", version=config.CONTRACT_VERSION, lifespan=_lifespan)
    # The published contract is the API description; it is served as written, never regenerated from code.
    app.openapi = contract  # type: ignore[method-assign]
    _limit_requests(app, get_settings().rate_limit_per_minute, get_settings().behind_proxy)
    app.add_middleware(CORSMiddleware, allow_origins=list(get_settings().cors_origins), allow_methods=["GET", "POST"], allow_headers=["*"],
                       expose_headers=["Location"])
    for module in (system, reference, analyses):
        app.include_router(module.router)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, error: RequestValidationError):
        errors = [{"field": "/" + "/".join(str(part) for part in item["loc"] if part != "body"), "message": item["msg"]} for item in error.errors()]
        return problem(422, "invalid_request", "The request is not valid", f"{len(errors)} field{'s are' if len(errors) != 1 else ' is'} missing or wrong.", errors)

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, error: HTTPException):
        return problem(error.status_code, "not_found" if error.status_code == 404 else "http_error", str(error.detail), str(error.detail))

    return app


app = create_app()

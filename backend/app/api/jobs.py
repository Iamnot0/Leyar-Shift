"""Analysis jobs, kept as records. A job's id is a hash of its request, so the same request is the same job."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from pydantic import ValidationError

from app.adapters.base import now_iso
from app.core.records import Records
from app.core.provenance import JOB_STAGES
from app.modeling import analysis
from app.modeling.engine import AnalysisError, Context
from app.schemas import models

log = logging.getLogger("fieldshift.jobs")
STAGE_LABELS = dict(JOB_STAGES)


class JobStore:
    def __init__(self, records: Records, inline: bool, workers: int = 2) -> None:
        self.records = records
        self.inline = inline
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="analysis")
        self._lock = threading.Lock()
        self._running: set[str] = set()

    def read(self, job_id: str) -> dict[str, Any] | None:
        return self.records.get(f"jobs/{job_id}")

    def zones(self, job_id: str) -> dict[str, Any] | None:
        return self.records.get(f"zones/{job_id}")

    def request(self, job_id: str) -> dict[str, Any] | None:
        return self.records.get(f"requests/{job_id}")

    def _update(self, job: dict[str, Any], **changes: Any) -> None:
        job.update(changes, updated_at=now_iso())
        self.records.put(f"jobs/{job['analysis_id']}", job)

    def _keep_request(self, job_id: str, request: dict[str, Any]) -> None:
        """A job that ends in an error has no result to carry its request, so the request is kept beside it to explain the failure."""
        self.records.put(f"requests/{job_id}", request)

    def submit(self, request: dict[str, Any], ctx: Context, *, after_reply: Callable[[Callable[[], None]], None] | None = None) -> dict[str, Any]:
        """Starts or finds the job. With `after_reply`, the work runs once the reply has gone, so each stage can be read while it runs."""
        job_id = analysis.analysis_id(request)
        with self._lock:
            existing = self.read(job_id)
            # A stored result that is missing a source worth retrying is run again; the fetch cache makes that quick.
            finished = existing is not None and existing["status"] == "done" and not any(row["retryable"] for row in existing["result"]["datasets"])
            if existing is not None and (finished or job_id in self._running):
                return existing
            created = now_iso()
            job = {"analysis_id": job_id, "status": "queued", "stage": None, "stage_label": None, "created_at": created,
                   "updated_at": created, "error": None, "result": None}
            self.records.put(f"jobs/{job_id}", job)
            self._running.add(job_id)
        if after_reply is not None:
            after_reply(lambda: self._run(job, request, ctx))
        elif self.inline:
            self._run(job, request, ctx)
        else:
            self._pool.submit(self._run, job, request, ctx)
        return job

    def _run(self, job: dict[str, Any], request: dict[str, Any], ctx: Context) -> None:
        job_id = job["analysis_id"]
        try:
            self._update(job, status="running")
            result, zones = analysis.analyze(request, ctx, lambda stage: self._update(job, stage=stage, stage_label=STAGE_LABELS.get(stage)))
            # Nothing leaves the engine that the contract does not allow.
            models.Analysis.model_validate(result)
            models.ZoneLayers.model_validate(zones)
            self.records.put(f"zones/{job_id}", zones)
            self._update(job, status="done", stage=None, stage_label=None, result=result)
        except AnalysisError as error:
            self._keep_request(job_id, request)
            self._update(job, status="error", error={"type": error.error_type, "title": error.title, "status": error.status, "detail": error.detail})
        except ValidationError as error:
            log.exception("analysis %s produced a result outside the contract", job_id)
            self._keep_request(job_id, request)
            self._update(job, status="error", error={"type": "internal", "title": "The result did not match the contract", "status": 500,
                                                     "detail": f"{error.error_count()} fields in the result are outside the contract. Nothing was returned."})
        except Exception:  # noqa: BLE001 - a job must always end in a recorded state
            log.exception("analysis %s failed", job_id)
            self._keep_request(job_id, request)
            # The exception stays in the server log: its text can carry upstream addresses.
            self._update(job, status="error", error={"type": "internal", "title": "The analysis stopped unexpectedly", "status": 500,
                                                     "detail": f"Something went wrong on our side. Try again; if it happens again, quote reference {job_id}."})
        finally:
            with self._lock:
                self._running.discard(job_id)

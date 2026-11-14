"""Shared plumbing for source adapters: cached HTTP, cached arrays and the per-dataset status.

An adapter never raises past its boundary. A failure becomes a SourceState the engine can report.
"""

from __future__ import annotations

import hashlib
import re
import io
import json
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

import httpx
import numpy as np

from app.core.provenance import DATASETS, NOT_CONFIGURED_MESSAGES, NullReason

USER_AGENT = "field-shift/0.2 (crop rotation decision support)"
SECRET_PARAMS = {"key", "api_key", "token"}
RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_RETRY_WAIT_S = 20.0
NEGATIVE_TTL_DAYS = {400: 30.0, 404: 1.0, 410: 30.0}


_QUERY = re.compile(r"(https?://[^\s?#'\"]+)\?[^\s'\"]*")
_SECRET_VALUE = re.compile(r"(?i)\b(key|api_key|apikey|token|access_token|password|secret)=[^&\s'\"]+")


def scrub(text: str) -> str:
    """Drops query strings and secret-looking values from a message that may be shown to users."""
    return _SECRET_VALUE.sub(r"\1=<hidden>", _QUERY.sub(r"\1", text))


class FetchError(Exception):
    """The source did not give a usable answer."""


class _HttpClientError(FetchError):
    """Non-retryable 4xx response whose negative result may be cached briefly."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass
class SourceState:
    """What one dataset contributed to an analysis, or why it did not."""

    dataset_id: str
    status: str = "available"
    null_reason: NullReason | None = None
    message: str | None = None
    as_of: str | None = None
    period: tuple[str, str] | None = None
    footprint: dict[str, Any] | None = None

    @classmethod
    def ok(cls, dataset_id: str, *, as_of: str | None = None, period: tuple[str, str] | None = None,
           footprint: dict[str, Any] | None = None, message: str | None = None) -> "SourceState":
        return cls(dataset_id, "available", None, message, as_of, period, footprint)

    @classmethod
    def failed(cls, dataset_id: str, error: Exception | str) -> "SourceState":
        name = DATASETS[dataset_id].name
        return cls(dataset_id, "failed", NullReason.FETCH_FAILED, f"{name} did not answer ({str(error)[:120]}). Other results are unaffected.")

    @classmethod
    def out_of_coverage(cls, dataset_id: str, message: str) -> "SourceState":
        return cls(dataset_id, "unavailable", NullReason.OUT_OF_COVERAGE, message)

    @classmethod
    def not_configured(cls, dataset_id: str, message: str | None = None) -> "SourceState":
        return cls(dataset_id, "unavailable", NullReason.NOT_CONFIGURED, message or NOT_CONFIGURED_MESSAGES[dataset_id])

    @classmethod
    def insufficient(cls, dataset_id: str, message: str) -> "SourceState":
        return cls(dataset_id, "unavailable", NullReason.INSUFFICIENT, message)

    @property
    def available(self) -> bool:
        return self.status == "available"


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass
class Allowance:
    """A cap on real requests to one metered source per month or day. Kept on disk, so a restart does not reset it."""

    folder: Path
    source: str
    limit: int
    period: str
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def take(self) -> bool:
        """Count one request against the allowance. False when it is used up."""
        stamp = datetime.now(UTC).strftime("%Y-%m" if self.period == "month" else "%Y-%m-%d")
        path = self.folder / f"{self.source}-{stamp}.json"
        with self._lock:
            used = json.loads(path.read_text())["used"] if path.exists() else 0
            if used >= self.limit:
                return False
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"used": used + 1, "limit": self.limit}))
            return True


@dataclass
class Fetcher:
    """HTTP client with an on-disk cache. In replay mode it only reads recordings and never touches the network."""

    cache_dir: Path
    mode: str = "live"
    timeout: float = 90.0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _client: httpx.Client | None = field(default=None, init=False, repr=False)

    def _http_client(self) -> httpx.Client:
        with self._lock:
            if self._client is None:
                self._client = httpx.Client(
                    follow_redirects=True,
                    limits=httpx.Limits(max_connections=64, max_keepalive_connections=32, keepalive_expiry=30.0),
                )
            return self._client

    def close(self) -> None:
        with self._lock:
            if self._client is not None:
                self._client.close()
                self._client = None

    def _paths(self, source: str, signature: str) -> tuple[Path, Path]:
        digest = hashlib.sha256(signature.encode()).hexdigest()[:24]
        folder = self.cache_dir / source
        return folder / f"{digest}.bin", folder / f"{digest}.json"

    def request(self, source: str, method: str, url: str, *, params: dict[str, Any] | None = None,
                json_body: Any = None, headers: dict[str, str] | None = None, max_age_days: float | None = 30.0,
                timeout: float | None = None, attempts: int = 4, allowance: Allowance | None = None) -> bytes:
        public_params = {k: v for k, v in sorted((params or {}).items()) if k not in SECRET_PARAMS}
        signature = json.dumps([method, url, public_params, json_body], sort_keys=True, default=str)
        body_path, meta_path = self._paths(source, signature)
        err_path = body_path.with_suffix(".err.json")
        if body_path.exists():
            fresh = max_age_days is None or (time.time() - body_path.stat().st_mtime) < max_age_days * 86400
            if fresh or self.mode == "replay":
                return body_path.read_bytes()
        if self.mode == "replay":
            raise FetchError(f"no recording for {source}: {url}")
        if err_path.exists():
            try:
                err = json.loads(err_path.read_text())
                ttl = min(max_age_days, float(err.get("ttl_days", 1.0))) if max_age_days is not None else float(err.get("ttl_days", 1.0))
                if (time.time() - err_path.stat().st_mtime) < ttl * 86400:
                    raise FetchError(err["message"])
            except (ValueError, KeyError, OSError):
                pass
        if allowance is not None and not allowance.take():
            raise FetchError(f"this {allowance.period}'s allowance of {allowance.limit} requests is used up")
        try:
            content = self._fetch(method, url, params, json_body, headers, timeout=timeout, attempts=attempts)
        except _HttpClientError as error:
            if error.status_code in NEGATIVE_TTL_DAYS:
                with self._lock:
                    err_path.parent.mkdir(parents=True, exist_ok=True)
                    tmp = err_path.with_suffix(f".{os.getpid()}.tmp")
                    tmp.write_text(json.dumps({"status": error.status_code, "ttl_days": NEGATIVE_TTL_DAYS[error.status_code], "message": str(error)}))
                    tmp.replace(err_path)
            raise
        self._store(body_path, meta_path, content, {"source": source, "method": method, "url": url, "params": public_params,
                                                    "body": json_body, "fetched_at": now_iso(), "bytes": len(content)})
        return content

    def get_json(self, source: str, url: str, **kwargs: Any) -> Any:
        return _decode_json(self.request(source, "GET", url, **kwargs), url)

    def post_json(self, source: str, url: str, **kwargs: Any) -> Any:
        return _decode_json(self.request(source, "POST", url, **kwargs), url)

    def fetched_at(self, source: str, method: str, url: str, *, params: dict[str, Any] | None = None, json_body: Any = None) -> str | None:
        public_params = {k: v for k, v in sorted((params or {}).items()) if k not in SECRET_PARAMS}
        _, meta_path = self._paths(source, json.dumps([method, url, public_params, json_body], sort_keys=True, default=str))
        if meta_path.exists():
            return json.loads(meta_path.read_text()).get("fetched_at")
        return None

    def latest(self, source: str) -> str | None:
        """When this source was last fetched, from the cache itself, so a replayed run reports the recording's date."""
        stamps = []
        for path in (self.cache_dir / source).glob("*.json"):
            try:
                stamps.append(json.loads(path.read_text())["fetched_at"])
            except (ValueError, KeyError, OSError):
                continue
        return max(stamps) if stamps else None

    def _fetch(self, method: str, url: str, params: dict[str, Any] | None, json_body: Any, headers: dict[str, str] | None,
               *, timeout: float | None = None, attempts: int = 4) -> bytes:
        last_error: Exception | None = None
        client = self._http_client()
        for attempt in range(attempts):
            try:
                response = client.request(method, url, params=params, json=json_body, timeout=timeout or self.timeout,
                                          headers={"User-Agent": USER_AGENT, **(headers or {})})
                if response.status_code in RETRY_STATUS:
                    last_error = FetchError(f"HTTP {response.status_code}")
                    # A busy server says how long to stay away; without that, back off a little more each time.
                    asked = response.headers.get("Retry-After", "")
                    time.sleep(min(float(asked), MAX_RETRY_WAIT_S) if asked.isdigit() else 2.0 * (attempt + 1))
                    continue
                if response.status_code >= 400:
                    msg = scrub(f"HTTP {response.status_code}: {response.text[:160]}")
                    raise _HttpClientError(response.status_code, msg) if response.status_code < 500 else FetchError(msg)
                return response.content
            except httpx.HTTPError as error:
                last_error = error
                time.sleep(1.5 * (attempt + 1))
        raise FetchError(scrub(f"{type(last_error).__name__}: {last_error}"))

    def _store(self, body_path: Path, meta_path: Path, content: bytes, meta: dict[str, Any]) -> None:
        with self._lock:
            body_path.parent.mkdir(parents=True, exist_ok=True)
            for path, data in ((body_path, content), (meta_path, json.dumps(meta, indent=1).encode())):
                temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
                temporary.write_bytes(data)
                temporary.replace(path)
            body_path.with_suffix(".err.json").unlink(missing_ok=True)

    def download(self, url: str, *, params: dict[str, Any] | None = None, timeout: float | None = None, attempts: int = 3) -> bytes:
        """One live request with no cache of its own, for callers that cache what they make of the answer."""
        if self.mode == "replay":
            raise FetchError(f"no network in replay mode: {url}")
        return self._fetch("GET", url, params, None, None, timeout=timeout, attempts=attempts)

    def arrays(self, source: str, signature: Any, producer: Callable[[], dict[str, np.ndarray]]) -> dict[str, np.ndarray]:
        """Cache the arrays a raster read produced, so replay needs no network and no remote file."""
        body_path, meta_path = self._paths(source, json.dumps(["arrays", signature], sort_keys=True, default=str))
        body_path = body_path.with_suffix(".npz")
        if body_path.exists():
            with np.load(body_path, allow_pickle=False) as stored:
                return {name: stored[name] for name in stored.files}
        if self.mode == "replay":
            raise FetchError(f"no recording for {source} arrays: {signature}")
        produced = producer()
        buffer = io.BytesIO()
        np.savez_compressed(buffer, **produced)
        self._store(body_path, meta_path, buffer.getvalue(), {"source": source, "signature": signature, "fetched_at": now_iso()})
        return produced


def _decode_json(content: bytes, url: str) -> Any:
    try:
        return json.loads(content)
    except ValueError as error:
        raise FetchError(f"not JSON from {url}: {content[:80]!r}") from error

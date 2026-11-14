"""Small JSON records kept between requests: analysis jobs, AI summaries and request counters.

On one long-lived server they are files under var/records. On Vercel each request may reach a different instance with its own
disk, so they live in Vercel's Runtime Cache, which every instance in a region shares.
"""

from __future__ import annotations

import json
import os
import re
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

KEY = re.compile(r"[a-z]+/[a-z0-9][a-z0-9.-]{0,127}")
# Long enough for a judge to come back to a result; a record that has expired is simply worked out again.
RUNTIME_TTL_S = 30 * 24 * 3600


class Records(Protocol):
    def get(self, key: str) -> Any | None: ...

    def put(self, key: str, value: Any) -> None: ...


def _checked(key: str) -> str:
    if not KEY.fullmatch(key):
        raise ValueError(f"Not a record key: {key!r}")
    return key


class DiskRecords:
    def __init__(self, folder: Path) -> None:
        self.folder = folder.resolve()

    def _path(self, key: str) -> Path:
        path = (self.folder / f"{_checked(key)}.json").resolve()
        if not path.is_relative_to(self.folder):
            raise ValueError("A record path leaves its folder")
        return path

    def get(self, key: str) -> Any | None:
        path = self._path(key)
        return json.loads(path.read_text()) if path.exists() else None

    def put(self, key: str, value: Any) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        temporary.write_text(json.dumps(value))
        temporary.replace(path)


class RuntimeRecords:
    def __init__(self) -> None:
        from vercel.functions import RuntimeCache

        self._cache = RuntimeCache(namespace="leyar-shift")

    def get(self, key: str) -> Any | None:
        return self._cache.get(_checked(key))

    def put(self, key: str, value: Any) -> None:
        self._cache.set(_checked(key), value, {"ttl": RUNTIME_TTL_S})


@lru_cache
def records(store: str, var_dir: Path) -> Records:
    return RuntimeRecords() if store == "vercel" else DiskRecords(var_dir / "records")

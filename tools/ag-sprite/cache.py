"""Content-hash frame cache to avoid redundant generation API calls.

Cache key = SHA-256(prompt_text + tpose_file_hash). Cached frames live
in .ag-sprite-cache/ at the project root.
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

log = logging.getLogger(__name__)

_DEFAULT_CACHE_DIR = Path(".ag-sprite-cache")


class FrameCache:
    """Simple file-system cache keyed by content hash."""

    def __init__(self, cache_dir: Path | None = None):
        self._dir = cache_dir or _DEFAULT_CACHE_DIR
        self._dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Key computation
    # ------------------------------------------------------------------

    @staticmethod
    def file_hash(path: Path) -> str:
        """SHA-256 hex digest of a file's contents."""
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()

    @staticmethod
    def cache_key(prompt: str, tpose_hash: str) -> str:
        """Derive a cache key from the prompt text and tpose file hash."""
        h = hashlib.sha256()
        h.update(prompt.encode("utf-8"))
        h.update(tpose_hash.encode("utf-8"))
        return h.hexdigest()

    # ------------------------------------------------------------------
    # Read / write
    # ------------------------------------------------------------------

    def _path_for(self, key: str) -> Path:
        return self._dir / f"{key}.png"

    def get(self, key: str) -> bytes | None:
        """Return cached PNG bytes, or None if not cached."""
        p = self._path_for(key)
        if p.exists() and p.stat().st_size > 0:
            log.debug("Cache hit: %s", key[:12])
            return p.read_bytes()
        return None

    def put(self, key: str, data: bytes) -> Path:
        """Write PNG bytes to cache. Returns the cache file path."""
        p = self._path_for(key)
        p.write_bytes(data)
        log.debug("Cached: %s (%d bytes)", key[:12], len(data))
        return p

    def has(self, key: str) -> bool:
        """Check if a key exists in the cache."""
        p = self._path_for(key)
        return p.exists() and p.stat().st_size > 0

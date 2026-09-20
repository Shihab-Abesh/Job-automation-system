from __future__ import annotations

import logging
from typing import Any

from ..fetcher import Fetcher
from ..models import Job, SourceRef

log = logging.getLogger("careerpilot.source")


class Source:
    """One place jobs come from."""

    id: str = "base"
    label: str = "Base"
    #  Set False for sources that need the user's own credentials or consent.
    enabled_by_default: bool = False

    def __init__(self, fetcher: Fetcher, config: dict[str, Any] | None = None):
        self.fetcher = fetcher
        self.config = config or {}
        self.errors: list[str] = []
        # How many postings the site actually served, before relevance and age filters.
        # None means the source does not track it. Zero from a site that normally lists
        # jobs is the sign of a block or a redesign, which the health check watches for.
        self.raw_count: int | None = None

    def collect(self, queries: list[str]) -> list[Job]:
        raise NotImplementedError

    # helpers ---------------------------------------------------------------
    def make_job(self, **kw: Any) -> Job:
        kw.setdefault("source", self.label)
        job = Job(**kw)
        job.discoveredBy = self.id
        job.sources = [SourceRef(source=job.source or self.label, url=job.url)]
        return job

    def note_error(self, msg: str) -> None:
        log.warning("[%s] %s", self.id, msg)
        self.errors.append(msg)

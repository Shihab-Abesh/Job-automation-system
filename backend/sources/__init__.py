"""Source registry. Add a class, decorate it, and it becomes configurable."""
from __future__ import annotations

from typing import Type

from .base import Source

REGISTRY: dict[str, Type[Source]] = {}


def register(cls: Type[Source]) -> Type[Source]:
    REGISTRY[cls.id] = cls
    return cls


from . import bdjobs, bdrecruit, careers_page, email_alerts, jsonld_jobs, local, rss_feed  # noqa: E402,F401

__all__ = ["REGISTRY", "register", "Source"]

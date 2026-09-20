"""Helpers for sources that read a whole board and then have to decide what is relevant."""
from __future__ import annotations

import re

from ..normalize import normalize_title

_PAY_HINT = re.compile(r"salary|remuneration|compensation|\btk\b|\btaka\b|\bbdt\b|৳|negotiab", re.I)


def pay_text(description: str) -> str:
    """Only the lines that talk about pay, so a "2019-2023" year range in the body
    of a posting cannot be mistaken for a salary."""
    lines = [ln[:300] for ln in description.split("\n") if _PAY_HINT.search(ln)]
    return " ".join(lines[:3])


def is_relevant(title: str, queries: list[str]) -> bool:
    """True when every word of at least one search query appears in the title.

    Both sides go through the same normaliser the deduper uses, so "SQA Engineer"
    satisfies "software quality assurance" and "MTO" satisfies "management trainee".

    The exact words are tried first because the normaliser's seniority stripping would
    reduce "management trainee" to just "management" and match half the board. The
    stripped form is only a fallback, and only for queries that still have two or more
    words, which is what lets "junior data analyst" find "Data Operations Analyst".
    """
    exact = set(normalize_title(title).split())
    loose = set(normalize_title(title, drop_seniority=True).split())
    for query in queries:
        need = set(normalize_title(query).split())
        if need and need <= exact:
            return True
        need_loose = set(normalize_title(query, drop_seniority=True).split())
        if len(need_loose) >= 2 and need_loose <= loose:
            return True
    return False

"""Local files: fixtures for testing, and a drop box for postings you paste in.

Anything you save as JSON in the watch folder gets treated like any other
source, so a job a friend forwards you goes through the same scoring and the
same approval gate as one the scrapers found.

Accepted shape: a single object, or a list, with at least title and company.
"""
from __future__ import annotations

import json
from pathlib import Path

from ..models import Job
from ..normalize import clean_ws, infer_category, parse_date, parse_salary
from . import register
from .base import Source


@register
class LocalSource(Source):
    id = "local"
    label = "Manual entry"
    enabled_by_default = True

    def collect(self, queries: list[str]) -> list[Job]:
        jobs: list[Job] = []
        for folder in self.config.get("folders", ["inbox"]):
            for path in sorted(Path(folder).glob("*.json")):
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError) as exc:
                    self.note_error(f"{path}: {exc}")
                    continue
                items = data if isinstance(data, list) else data.get("jobs", [data])
                for item in items:
                    job = self._build(item, path.stem)
                    if job:
                        jobs.append(job)
        return jobs

    def _build(self, item: dict, origin: str) -> Job | None:
        title = clean_ws(item.get("title", ""))
        company = clean_ws(item.get("company", ""))
        if not title or not company:
            self.note_error(f"{origin}: entry missing title or company, skipped")
            return None
        desc = clean_ws(item.get("description", ""))
        lo, hi, stext = parse_salary(item.get("salary") or f"{title} {desc[:2000]}")
        return self.make_job(
            title=title,
            company=company,
            description=desc,
            location=clean_ws(item.get("location", "")) or "Dhaka, Bangladesh",
            url=item.get("url", ""),
            source=item.get("source") or self.label,
            category=item.get("category") or infer_category(title, desc),
            deadline=parse_date(item.get("deadline")),
            postedAt=parse_date(item.get("postedAt")),
            salaryMin=item.get("salaryMin", lo),
            salaryMax=item.get("salaryMax", hi),
            salaryText=item.get("salaryText", stext),
            employmentType=clean_ws(item.get("employmentType", "")),
            experienceText=clean_ws(item.get("experience", "")),
        )

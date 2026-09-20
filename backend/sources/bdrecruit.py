"""BDRecruit (bdrecruit.net), read through its public WordPress REST API.

The site is WordPress with a job-board plugin, and WordPress publishes every job
as structured JSON at /wp-json/wp/v2/job_listing. That endpoint is meant to be
read by software and robots.txt allows it. It returns the deadline, location,
experience and company as fields, so unlike a scraped board there are no CSS
selectors to keep alive when the site is redesigned.

Only job postings are requested. The same API also lists candidate (job seeker)
profiles; those are other people's personal data and are never fetched.
"""
from __future__ import annotations

import html
import json
import logging
import re
from typing import Any

from ..models import Job
from ..normalize import clean_ws, infer_category, parse_salary, strip_html
from . import register
from .base import Source
from .common import is_relevant, pay_text  # noqa: F401  (is_relevant is re-exported for callers and tests)

log = logging.getLogger("careerpilot.bdrecruit")

DEFAULT_API = "https://bdrecruit.net/wp-json/wp/v2/job_listing"
FIELDS = "id,date,link,title,content,metas"
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_NO_VALUE = {"", "-", "not mentioned", "n/a", "none"}


def _names(value: Any) -> str:
    """The plugin stores terms as {"418": "Contract"}; tolerate lists and plain strings."""
    if isinstance(value, dict):
        items = list(value.values())
    elif isinstance(value, list):
        items = value
    else:
        items = [value] if value else []
    return ", ".join(clean_ws(html.unescape(str(v))) for v in items if v)


def _value(metas: dict[str, Any], key: str) -> str:
    text = clean_ws(html.unescape(str(metas.get(key) or "")))
    return "" if text.lower() in _NO_VALUE else text


def split_title(raw_title: str, metas: dict[str, Any], link: str = "") -> tuple[str, str]:
    """Titles are published as "Role | Company"; some roles contain a "|" of their own."""
    text = clean_ws(html.unescape(raw_title))
    if " | " in text:
        head, _, tail = text.rpartition(" | ")
        return clean_ws(head), clean_ws(tail)
    for key, val in metas.items():
        if key.startswith("custom-text-") and isinstance(val, str) and val.strip():
            return text, clean_ws(val)
    match = re.search(r"/jobs-in-bd/([^/]+)/", link)
    return text, match.group(1).replace("-", " ").title() if match else ""


@register
class BDRecruitSource(Source):
    id = "bdrecruit"
    label = "BDRecruit"
    enabled_by_default = True

    def collect(self, queries: list[str]) -> list[Job]:
        api = self.config.get("api_url") or DEFAULT_API
        per_page = max(1, min(int(self.config.get("per_page", 100)), 100))
        max_pages = max(1, int(self.config.get("max_pages", 3)))
        filter_by_queries = str(self.config.get("relevance", "queries")).lower() != "all" and bool(queries)

        jobs: list[Job] = []
        seen = 0
        for page in range(1, max_pages + 1):
            url = f"{api}?per_page={per_page}&page={page}&orderby=date&order=desc&_fields={FIELDS}"
            try:
                body = self.fetcher.get(url)
            except Exception as exc:                      # robots.txt said no, or the network failed
                self.note_error(f"{self.label}: {exc}")
                break
            if not body:
                if page == 1:
                    self.note_error(f"{self.label}: empty or refused response")
                break
            try:
                items = json.loads(body)
            except json.JSONDecodeError as exc:
                self.note_error(f"{self.label}: response was not JSON ({exc})")
                break
            if not isinstance(items, list):
                self.note_error(f"{self.label}: unexpected response shape")
                break

            for item in items:
                job = self._build(item)
                if job is None:
                    continue
                seen += 1
                if filter_by_queries and not is_relevant(job.title, queries):
                    continue
                jobs.append(job)
            if len(items) < per_page:
                break

        log.info("%s: kept %s of %s postings that matched your search queries", self.label, len(jobs), seen)
        return jobs

    def _build(self, item: dict[str, Any]) -> Job | None:
        metas = item.get("metas") or {}
        link = item.get("link") or ""
        title, company = split_title((item.get("title") or {}).get("rendered", ""), metas, link)
        if not title or not link:
            return None

        desc = strip_html((item.get("content") or {}).get("rendered", ""))
        lo, hi, stext = parse_salary(f"{_value(metas, '_job_salary')} {pay_text(desc)}")
        expiry = _value(metas, "_job_expiry_date")
        location = _names(metas.get("_job_location")) or _value(metas, "_job_address") or "Bangladesh"

        return self.make_job(
            title=title,
            company=company or "Unknown company",
            description=desc,
            location=location,
            url=link,
            source=self.label,
            category=infer_category(title, desc),
            postedAt=(item.get("date") or "")[:10] or None,
            deadline=expiry if _ISO_DATE.match(expiry) else None,
            salaryMin=lo, salaryMax=hi, salaryText=stext,
            employmentType=_names(metas.get("_job_type")),
            experienceText=_value(metas, "_job_experience"),
        )

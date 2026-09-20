"""Job boards that publish schema.org JobPosting data (JSON-LD) inside their pages.

Sites add this markup so Google Jobs can read them, which makes it the one
machine-readable format that many unrelated boards share. One reader therefore
covers all of them: point it at a listing or search page and it extracts every
JobPosting on it. Adding a board is a config entry, not new code, and there are
no CSS selectors to keep alive when a site is redesigned.

A posting with no URL of its own is skipped rather than given the listing page's
address, because a link that does not lead to that job is worse than no job.
"""
from __future__ import annotations

import html
import json
import logging
import re
from datetime import date, timedelta
from typing import Any, Iterator
from urllib.parse import quote_plus, urljoin

from ..models import Job
from ..normalize import clean_ws, infer_category, parse_salary, strip_html
from . import register
from .base import Source
from .common import is_relevant, pay_text

log = logging.getLogger("careerpilot.jsonld")

_LD_BLOCK = re.compile(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S | re.I)
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")
_EMPLOYMENT = {
    "FULL_TIME": "Full time", "PART_TIME": "Part time", "CONTRACTOR": "Contract",
    "TEMPORARY": "Temporary", "INTERN": "Internship", "VOLUNTEER": "Volunteer",
}
_MONTHLY_DIVISOR = {"MONTH": 1, "YEAR": 12}
_PLACEHOLDERS = {"", "-", "n/a", "na", "none", "null", "not specified", "unspecified", "not mentioned"}


def _walk(node: Any) -> Iterator[dict]:
    """Yield every JobPosting in a parsed JSON-LD document, in page order."""
    if isinstance(node, list):
        for item in node:
            yield from _walk(item)
    elif isinstance(node, dict):
        kinds = node.get("@type")
        if "JobPosting" in (kinds if isinstance(kinds, list) else [kinds]):
            yield node
        else:                                    # containers: ItemList, @graph, a wrapper page
            for value in node.values():
                if isinstance(value, (dict, list)):
                    yield from _walk(value)


def extract_postings(page_html: str) -> list[dict]:
    postings: list[dict] = []
    for block in _LD_BLOCK.findall(page_html or ""):
        try:
            postings.extend(_walk(json.loads(block)))
        except json.JSONDecodeError:
            continue                              # one malformed block must not lose the others
    return postings


def _text(value: Any) -> str:
    return clean_ws(html.unescape(str(value or "")))


def _line(value: Any) -> str:
    """Titles, companies and places are one line. Some sites leak button text and line
    breaks into these fields ("Designer\\nOnsite\\n/\\nFull Time\\nApply")."""
    return " ".join(_text(value).split())


def _description(raw: Any) -> str:
    text = str(raw or "").strip()
    if len(text) > 1 and text[0] == text[-1] == '"':    # some sites JSON-encode the string twice
        try:
            text = json.loads(text)
        except json.JSONDecodeError:
            pass
    return strip_html(text)


def _company(org: Any) -> str:
    return _line(org.get("name")) if isinstance(org, dict) else _line(org)


def _url(value: Any, base: str) -> str:
    if not isinstance(value, str) or not value.strip():
        return ""
    full = urljoin(base, value.strip())
    return full if full.startswith(("http://", "https://")) else ""


def _date(value: Any) -> str | None:
    match = _ISO_DATE.match(str(value or ""))
    return match.group(0) if match else None


def _location(posting: dict, default: str) -> str:
    node = posting.get("jobLocation")
    if isinstance(node, str):
        stripped = node.strip()
        if stripped[:1] in "{[":
            try:
                node = json.loads(stripped)
            except json.JSONDecodeError:
                node = stripped
        else:
            node = stripped
    if isinstance(node, list):
        node = node[0] if node else {}
    parts: list[str] = []
    if isinstance(node, str):
        parts = [_line(node)]
    elif isinstance(node, dict):
        address = node.get("address", node)
        if isinstance(address, str):
            parts = [_line(address)]
        elif isinstance(address, dict):
            for key in ("streetAddress", "addressLocality", "addressRegion"):
                value = _line(address.get(key))
                if value.lower() in _PLACEHOLDERS:          # "Not specified, Dhaka" helps nobody
                    continue
                if not any(value.lower() in p.lower() for p in parts):
                    parts.append(value)
    place = ", ".join(p for p in parts if p) or default
    if str(posting.get("jobLocationType") or "").upper() == "TELECOMMUTE":
        place = "Remote" + (f", {place}" if place else "")
    return place


def _employment(raw: Any) -> str:
    values = raw if isinstance(raw, list) else [raw]
    names = [_EMPLOYMENT.get(str(v).upper(), str(v).replace("_", " ").title()) for v in values if v]
    return ", ".join(n for n in names if n)


def _salary(posting: dict, description: str) -> tuple[int | None, int | None, str]:
    base = posting.get("baseSalary")
    if isinstance(base, dict) and str(base.get("currency") or "BDT").upper() == "BDT":
        value = base.get("value")
        if isinstance(value, dict):
            low, high, unit = value.get("minValue", value.get("value")), value.get("maxValue"), value.get("unitText")
        else:
            low, high, unit = value, None, None
        divisor = _MONTHLY_DIVISOR.get(str(unit or "MONTH").upper())
        try:
            lo = int(round(float(low) / divisor)) if divisor and low not in (None, "") else None
            hi = int(round(float(high) / divisor)) if divisor and high not in (None, "") else None
        except (TypeError, ValueError):
            lo = hi = None
        if lo and lo > 0:                        # a published salary of 0 means "not stated"
            hi = hi if hi and hi >= lo else None
            return lo, hi, f"Tk {lo:,}" + (f" - {hi:,}" if hi else "")
    return parse_salary(pay_text(description))


@register
class JSONLDSource(Source):
    id = "jsonld"
    label = "Job boards"
    enabled_by_default = False                   # needs a sites list to do anything

    def collect(self, queries: list[str]) -> list[Job]:
        filter_by_queries = str(self.config.get("relevance", "queries")).lower() != "all" and bool(queries)
        jobs: list[Job] = []
        seen_urls: set[str] = set()
        self.raw_count = 0

        for site in self.config.get("sites", []):
            template = site.get("url")
            if not template:
                continue
            label = site.get("label") or self.label
            site_queries = list(site.get("queries") or queries)
            cap = max(1, int(site.get("max_queries", 12)))
            if "{query}" in template:
                urls = [template.replace("{query}", quote_plus(q)) for q in site_queries[:cap]]
            else:
                urls = [template]
            keep_if = list(dict.fromkeys([*queries, *site_queries]))

            found = kept = 0
            for url in urls:
                try:
                    body = self.fetcher.get(url)
                except Exception as exc:          # robots.txt said no, or the network failed
                    self.note_error(f"{label}: {exc}")
                    continue
                if not body:
                    self.note_error(f"{label}: empty or refused response for {url}")
                    continue
                postings = extract_postings(body)
                self.raw_count += len(postings)
                for posting in postings:
                    job = self._build(posting, site, label, url, single=len(postings) == 1)
                    if job is None or job.url in seen_urls:
                        continue
                    found += 1
                    if filter_by_queries and not is_relevant(job.title, keep_if):
                        continue
                    seen_urls.add(job.url)
                    jobs.append(job)
                    kept += 1
            log.info("%s: kept %s of %s postings that matched your search queries", label, kept, found)
        return jobs

    def _build(self, posting: dict, site: dict, label: str, page_url: str, single: bool) -> Job | None:
        title = _line(posting.get("title"))
        url = _url(posting.get("url"), page_url) or (page_url if single else "")
        if not title or not url:
            return None

        posted = _date(posting.get("datePosted"))
        max_age = site.get("max_age_days")
        if max_age and posted and posted < (date.today() - timedelta(days=int(max_age))).isoformat():
            return None                          # still listed by the site, but not a live opening

        description = _description(posting.get("description"))
        lo, hi, salary_text = _salary(posting, description)
        deadline = None if site.get("ignore_deadline") else _date(posting.get("validThrough"))
        return self.make_job(
            title=title,
            company=_company(posting.get("hiringOrganization")) or "Unknown company",
            description=description,
            location=_location(posting, site.get("location", "Dhaka, Bangladesh")),
            url=url,
            source=label,
            category=infer_category(title, description),
            postedAt=posted,
            deadline=deadline if deadline and deadline >= "2000-01-01" else None,   # 1970-01-01 means "unset"
            salaryMin=lo, salaryMax=hi, salaryText=salary_text,
            employmentType=_employment(posting.get("employmentType")),
        )

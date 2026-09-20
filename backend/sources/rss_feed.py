"""Generic RSS / Atom reader.

This is the workhorse for boards that publish a feed for a saved search. It
needs no credentials, no scraping and no permission, because a feed is
published specifically to be read by software.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET

from ..models import Job
from ..normalize import clean_ws, infer_category, parse_date, parse_salary, strip_html
from . import register
from .base import Source

NS = {"atom": "http://www.w3.org/2005/Atom", "dc": "http://purl.org/dc/elements/1.1/"}


def _text(node, *paths: str) -> str:
    for path in paths:
        found = node.find(path, NS) if ":" in path else node.find(path)
        if found is not None:
            if found.text:
                return clean_ws(found.text)
            href = found.attrib.get("href")
            if href:
                return href.strip()
    return ""


@register
class RSSSource(Source):
    id = "rss"
    label = "RSS"
    enabled_by_default = True

    def collect(self, queries: list[str]) -> list[Job]:
        jobs: list[Job] = []
        for feed in self.config.get("feeds", []):
            url = feed.get("url")
            if not url:
                continue
            label = feed.get("label") or self.label
            try:
                body = self.fetcher.get(url)
            except Exception as exc:
                self.note_error(f"{label}: {exc}")
                continue
            if not body:
                self.note_error(f"{label}: empty response")
                continue
            try:
                root = ET.fromstring(body.encode("utf-8", "ignore"))
            except ET.ParseError as exc:
                self.note_error(f"{label}: not valid XML ({exc})")
                continue

            entries = root.findall(".//item") or root.findall(".//atom:entry", NS)
            for e in entries:
                title = _text(e, "title", "atom:title")
                link = _text(e, "link", "atom:link")
                if not title or not link:
                    continue
                body_html = _text(e, "description", "atom:summary", "atom:content",
                                  "{http://purl.org/rss/1.0/modules/content/}encoded")
                desc = strip_html(body_html)
                company = _text(e, "author", "dc:creator", "atom:author/atom:name") or feed.get("company", "")
                if not company:
                    # Feeds routinely pack "Role at Company" into the title.
                    if " at " in title:
                        title, company = title.rsplit(" at ", 1)
                lo, hi, stext = parse_salary(f"{title} {desc[:1500]}")
                jobs.append(self.make_job(
                    title=clean_ws(title),
                    company=clean_ws(company) or "Unknown company",
                    description=desc,
                    location=feed.get("location", "Dhaka, Bangladesh"),
                    url=link,
                    source=label,
                    category=feed.get("category") or infer_category(title, desc),
                    postedAt=parse_date(_text(e, "pubDate", "atom:published", "atom:updated")),
                    salaryMin=lo, salaryMax=hi, salaryText=stext,
                ))
        return jobs

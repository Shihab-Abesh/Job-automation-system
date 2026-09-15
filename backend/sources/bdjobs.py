"""Bdjobs search reader.

Selectors live in config, not in code, because job boards reshuffle their
markup every few months. When it breaks, run:

    python -m backend.pipeline probe --source bdjobs --query "sqa"

and it prints the candidate containers so you can update config/sources.yml
without touching Python.
"""
from __future__ import annotations

from urllib.parse import urljoin, quote_plus

from bs4 import BeautifulSoup

from ..models import Job
from ..normalize import clean_ws, infer_category, parse_date, parse_salary, strip_html
from . import register
from .base import Source

BASE = "https://jobs.bdjobs.com/"

DEFAULT_SELECTORS = {
    "card": "div.job-title-text, div.norm-jobs-wrapper, div.sout-jobs-wrapper, tr.jobs-list",
    "title": "div.job-title-text a, a.job-title-text, .jobtitle a, h2 a",
    "company": "div.comp-name-text, .comp-name a, .company-name",
    "location": "div.locon-text, .job-location, .loc-text",
    "deadline": "div.dead-text, .deadline, .job-deadline",
    "link_contains": "jobdetail",
}


@register
class BdjobsSource(Source):
    id = "bdjobs"
    label = "Bdjobs"
    enabled_by_default = True

    def _search_url(self, query: str, page: int = 1) -> str:
        tpl = self.config.get(
            "search_url",
            "https://jobs.bdjobs.com/jobsearch.asp?txtsearch={query}&pg={page}",
        )
        return tpl.format(query=quote_plus(query), page=page)

    def collect(self, queries: list[str]) -> list[Job]:
        jobs: list[Job] = []
        pages = int(self.config.get("pages", 1))
        sel = {**DEFAULT_SELECTORS, **(self.config.get("selectors") or {})}
        follow = bool(self.config.get("fetch_details", True))
        detail_cap = int(self.config.get("detail_limit", 25))
        followed = 0

        for q in queries:
            for page in range(1, pages + 1):
                url = self._search_url(q, page)
                try:
                    html = self.fetcher.get(url)
                except Exception as exc:
                    self.note_error(f"search '{q}' page {page}: {exc}")
                    continue
                if not html:
                    continue
                found = self._parse_list(html, sel, q)
                for job in found:
                    if follow and followed < detail_cap and job.url:
                        followed += 1
                        self._enrich(job)
                    jobs.append(job)
        return jobs

    # ---------------------------------------------------------------- parse
    def _parse_list(self, html: str, sel: dict, query: str) -> list[Job]:
        soup = BeautifulSoup(html, "lxml")
        cards = soup.select(sel["card"])
        if not cards:
            # Fallback: any anchor that points at a job detail page. Survives
            # most redesigns, at the cost of thinner metadata.
            anchors = [a for a in soup.find_all("a", href=True)
                       if sel["link_contains"] in a["href"].lower()]
            cards = [a.find_parent(["tr", "div", "li"]) or a for a in anchors]

        out: list[Job] = []
        seen_links: set[str] = set()
        for card in cards:
            a = card.select_one(sel["title"]) or card.find("a", href=True)
            if not a or not a.get("href"):
                continue
            link = urljoin(BASE, a["href"].strip())
            if link in seen_links:
                continue
            seen_links.add(link)

            title = clean_ws(a.get_text(" "))
            if not title or len(title) < 3:
                continue
            company = self._pick(card, sel["company"]) or "Unknown company"
            location = self._pick(card, sel["location"]) or "Dhaka, Bangladesh"
            deadline = parse_date(self._pick(card, sel["deadline"]))
            blurb = clean_ws(card.get_text(" "))[:400]
            lo, hi, stext = parse_salary(blurb)

            out.append(self.make_job(
                title=title,
                company=company,
                description=blurb,
                location=location,
                url=link,
                category=infer_category(title, blurb),
                deadline=deadline,
                salaryMin=lo, salaryMax=hi, salaryText=stext,
            ))
        return out

    @staticmethod
    def _pick(card, selector: str) -> str:
        if not selector:
            return ""
        node = card.select_one(selector)
        return clean_ws(node.get_text(" ")) if node else ""

    # --------------------------------------------------------------- detail
    def _enrich(self, job: Job) -> None:
        """Pull the full posting so scoring sees real requirement text."""
        try:
            html = self.fetcher.get(job.url)
        except Exception as exc:
            self.note_error(f"detail {job.url}: {exc}")
            return
        if not html:
            return
        soup = BeautifulSoup(html, "lxml")
        for junk in soup(["script", "style", "nav", "footer", "header"]):
            junk.decompose()
        main = (soup.select_one(".job-desc, #job-desc, .jobcontent, .job-details")
                or soup.find("main") or soup.body)
        text = strip_html(str(main)) if main else ""
        if len(text) > len(job.description):
            job.description = text[:12000]
        lo, hi, stext = parse_salary(text)
        if lo and not job.salaryMin:
            job.salaryMin, job.salaryMax, job.salaryText = lo, hi, stext
        job.category = infer_category(job.title, job.description)

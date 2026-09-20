"""Company careers pages, driven entirely by config.

Small Dhaka software houses rarely post on the big boards. Watching a dozen
careers pages directly is often the highest-signal source you have.
"""
from __future__ import annotations

from urllib.parse import urljoin

from bs4 import BeautifulSoup

from ..models import Job
from ..normalize import clean_ws, infer_category, parse_salary, strip_html
from . import register
from .base import Source


@register
class CareersPageSource(Source):
    id = "careers"
    label = "Careers page"
    enabled_by_default = True

    def collect(self, queries: list[str]) -> list[Job]:
        jobs: list[Job] = []
        for site in self.config.get("sites", []):
            url, company = site.get("url"), site.get("company")
            if not url or not company:
                continue
            try:
                html = self.fetcher.get(url)
            except Exception as exc:
                self.note_error(f"{company}: {exc}")
                continue
            if not html:
                continue
            soup = BeautifulSoup(html, "lxml")
            nodes = soup.select(site.get("item_selector") or "a[href]")
            for node in nodes:
                a = node if node.name == "a" else node.find("a", href=True)
                if not a or not a.get("href"):
                    continue
                title = clean_ws(a.get_text(" "))
                if not self._looks_like_a_job(title):
                    continue
                link = urljoin(url, a["href"])
                blurb = strip_html(str(node))[:1200]
                lo, hi, stext = parse_salary(blurb)
                jobs.append(self.make_job(
                    title=title,
                    company=company,
                    description=blurb,
                    location=site.get("location", "Dhaka, Bangladesh"),
                    url=link,
                    source=f"{company} careers",
                    category=infer_category(title, blurb),
                    salaryMin=lo, salaryMax=hi, salaryText=stext,
                ))
        return jobs

    @staticmethod
    def _looks_like_a_job(title: str) -> bool:
        if not (4 < len(title) < 90):
            return False
        keys = ("engineer", "developer", "analyst", "officer", "executive", "manager",
                "intern", "assistant", "specialist", "administrator", "support",
                "qa", "sqa", "tester", "mis", "coordinator", "associate", "lead")
        low = title.lower()
        return any(k in low for k in keys)

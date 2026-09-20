"""Company careers pages, driven entirely by config.

Small Dhaka software houses rarely post on the big boards. Watching a dozen
careers pages directly is often the highest-signal source you have.
"""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

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
                link = urljoin(url, a["href"])
                if not self._looks_like_a_job(title, link, url):
                    continue
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

    # Whole words, so "Engineering" (a department) is not "engineer" (a role).
    _ROLE = re.compile(
        r"\b(engineer|developer|analyst|officer|executive|manager|intern|assistant|specialist|"
        r"administrator|coordinator|associate|tester|architect|designer|consultant|trainee|"
        r"qa|sqa|mis)\b", re.I)
    # A posting lives at a job-like address; a marketing page does not.
    _JOB_PATH = re.compile(r"career|/jobs?[/\-_.]|/jobs?$|position|vacanc|opening|apply|recruit|hiring", re.I)

    @classmethod
    def _looks_like_a_job(cls, title: str, link: str = "", page_url: str = "") -> bool:
        """A link on a careers page is only a job if its text names a role AND its address
        looks like a posting. Otherwise service pages ("QA Testing & Automation"), products
        ("Adobe Experience Manager") and department links ("Engineering") become fake jobs,
        which is worse than finding none."""
        if not (4 < len(title) < 90) or not cls._ROLE.search(title):
            return False
        if link.rstrip("/") == page_url.rstrip("/"):          # the careers page linking to itself
            return False
        return bool(cls._JOB_PATH.search(urlparse(link).path))

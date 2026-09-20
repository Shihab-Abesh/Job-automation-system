"""BDRecruit source, tested offline against a canned API response. No network."""
from __future__ import annotations

import json
import re

import pytest

from backend.config import load_config
from backend.fetcher import RobotsDisallowed
from backend.sources import REGISTRY
from backend.sources.bdrecruit import BDRecruitSource, is_relevant, split_title


def _item(title, link="https://example.org/job/x/", content="<p>Body</p>", date="2026-09-20T10:00:00", **metas):
    return {"id": 1, "date": date, "link": link, "title": {"rendered": title},
            "content": {"rendered": content}, "metas": metas}


class StubFetcher:
    """Serves canned pages by ?page=N and records every URL it was asked for."""

    def __init__(self, pages):
        self.pages, self.urls = pages, []

    def get(self, url):
        self.urls.append(url)
        page = int(re.search(r"[?&]page=(\d+)", url).group(1))     # not the "page" inside per_page=
        body = self.pages.get(page)
        return json.dumps(body) if body is not None else None


QA = _item("Junior SQA Engineer | Acme Ltd", "https://example.org/job/qa/",
           "<p>Manual testing.</p><p>Salary: Tk 30,000 - 40,000</p>",
           **{"_job_expiry_date": "2026-10-30", "_job_location": {"170": "Dhaka, Bangladesh"},
              "_job_type": {"67": "Full Time", "418": "Contract"}, "_job_experience": "2 Years",
              "_job_salary": "25000৳ - 40000৳ / month"})
SALES = _item("Territory Manager, Sales | Coats", "https://example.org/job/sales/")


# ----------------------------------------------------------------- titles
@pytest.mark.parametrize("raw,expected", [
    ("Junior SQA Engineer | Acme Ltd", ("Junior SQA Engineer", "Acme Ltd")),
    ("WiNG | Sales Traineeship Program | Coca-Cola CCI", ("WiNG | Sales Traineeship Program", "Coca-Cola CCI")),
    ("Centre Manager &#8211; WFS | ActionAid Bangladesh", ("Centre Manager – WFS", "ActionAid Bangladesh")),
])
def test_title_and_company_split(raw, expected):
    assert split_title(raw, {}) == expected


def test_company_falls_back_to_the_sites_own_field_then_the_link():
    assert split_title("QA Engineer", {"custom-text-1": "Acme"}) == ("QA Engineer", "Acme")
    assert split_title("QA Engineer", {}, "https://bdrecruit.net/jobs-in-bd/acme-ltd/career/x/") == ("QA Engineer", "Acme Ltd")


# -------------------------------------------------------------- relevance
@pytest.mark.parametrize("title,queries,expected", [
    ("Junior SQA Engineer", ["software quality assurance"], True),
    ("Senior IT Officer", ["IT officer"], True),
    ("Officer, IT", ["IT officer"], True),
    ("Sr. Executive, MIS", ["MIS executive"], True),
    ("Territory Manager, Sales", ["QA engineer", "IT officer", "MIS executive"], False),
    ("Audit Officer", ["IT officer"], False),          # "it" must be a word, not a substring of "audit"
])
def test_relevance_uses_the_titles_not_the_body(title, queries, expected):
    assert is_relevant(title, queries) is expected


# ------------------------------------------------------------- collecting
def test_a_posting_becomes_a_complete_job():
    [job] = BDRecruitSource(StubFetcher({1: [QA]}), {}).collect(["QA engineer"])
    assert (job.title, job.company) == ("Junior SQA Engineer", "Acme Ltd")
    assert job.url == "https://example.org/job/qa/"        # the posting's own page, straight from the API
    assert job.source == "BDRecruit" and job.discoveredBy == "bdrecruit"
    assert job.deadline == "2026-10-30" and job.postedAt == "2026-09-20"
    assert job.location == "Dhaka, Bangladesh"
    assert job.employmentType == "Full Time, Contract" and job.experienceText == "2 Years"
    assert (job.salaryMin, job.salaryMax) == (25000, 40000)


def test_only_matching_postings_are_kept_unless_relevance_is_all():
    fetcher = StubFetcher({1: [QA, SALES]})
    assert [j.title for j in BDRecruitSource(fetcher, {}).collect(["QA engineer"])] == ["Junior SQA Engineer"]
    everything = BDRecruitSource(StubFetcher({1: [QA, SALES]}), {"relevance": "all"}).collect(["QA engineer"])
    assert len(everything) == 2


def test_a_year_range_in_the_body_is_not_read_as_a_salary():
    item = _item("QA Engineer | Acme", content="<p>Graduated between 2019-2023 with 3 years experience.</p>")
    [job] = BDRecruitSource(StubFetcher({1: [item]}), {}).collect(["QA engineer"])
    assert job.salaryMin is None


def test_a_deadline_that_is_not_a_date_is_ignored():
    item = _item("QA Engineer | Acme", **{"_job_expiry_date": "soon"})
    [job] = BDRecruitSource(StubFetcher({1: [item]}), {}).collect(["QA engineer"])
    assert job.deadline is None


# -------------------------------------------------------------- paging
def test_paging_stops_at_the_first_short_page():
    fetcher = StubFetcher({1: [QA, QA], 2: [QA], 3: [QA, QA]})
    BDRecruitSource(fetcher, {"per_page": 2, "max_pages": 5}).collect(["QA engineer"])
    assert len(fetcher.urls) == 2


def test_paging_respects_max_pages():
    fetcher = StubFetcher({1: [QA], 2: [QA], 3: [QA]})
    BDRecruitSource(fetcher, {"per_page": 1, "max_pages": 2}).collect(["QA engineer"])
    assert len(fetcher.urls) == 2


def test_only_the_job_endpoint_is_ever_requested():
    """The same API lists candidate profiles, which are other people's data."""
    fetcher = StubFetcher({1: [QA]})
    BDRecruitSource(fetcher, {}).collect(["QA engineer"])
    assert fetcher.urls and all("/job_listing" in u for u in fetcher.urls)
    assert not any("candidate" in u or "employer" in u for u in fetcher.urls)


# ------------------------------------------------------------- failures
def test_robots_disallow_is_recorded_not_fatal():
    class Refusing:
        def get(self, url):
            raise RobotsDisallowed(url)

    source = BDRecruitSource(Refusing(), {})
    assert source.collect(["QA engineer"]) == []
    assert source.errors


def test_a_non_json_response_is_recorded_not_fatal():
    class Blocked:
        def get(self, url):
            return "<html>Just a moment...</html>"

    source = BDRecruitSource(Blocked(), {})
    assert source.collect(["QA engineer"]) == []
    assert any("not JSON" in e for e in source.errors)


# ---------------------------------------------------------------- wiring
def test_it_is_registered_and_switched_on_in_the_real_config():
    assert "bdrecruit" in REGISTRY
    assert load_config("config/search.yml")["sources"]["bdrecruit"]["enabled"] is True

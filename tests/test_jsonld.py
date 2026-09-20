"""JSON-LD job board source, tested offline. No network."""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from backend.config import load_config
from backend.fetcher import RobotsDisallowed
from backend.sources import REGISTRY
from backend.sources.jsonld_jobs import JSONLDSource, extract_postings


def _posting(title="Junior Software Engineer", **kw):
    p = {"@type": "JobPosting", "title": title, "url": f"https://example.org/jobs/{abs(hash(title)) % 10000}",
         "datePosted": "2026-09-20", "validThrough": "2026-11-19",
         "hiringOrganization": {"@type": "Organization", "name": "Acme Ltd"},
         "jobLocation": {"@type": "Place", "address": {"addressLocality": "Uttara, Dhaka"}},
         "employmentType": "FULL_TIME", "description": "<p>Build web apps.</p>"}
    p.update(kw)
    return p


def _page(*blocks):
    return "<html><head>" + "".join(
        f'<script type="application/ld+json">{json.dumps(b)}</script>' for b in blocks) + "</head></html>"


def _item_list(*postings):
    return {"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "position": i, "item": p}
                                                       for i, p in enumerate(postings, 1)]}


class StubFetcher:
    def __init__(self, pages):
        self.pages, self.urls = pages, []

    def get(self, url):
        self.urls.append(url)
        return self.pages.get(url)


def _source(pages, sites, **config):
    return JSONLDSource(StubFetcher(pages), {"sites": sites, **config})


SITE = {"label": "Test Board", "url": "https://example.org/?search={query}"}


# ------------------------------------------------------------- extraction
def test_postings_are_found_inside_lists_graphs_and_wrapped_types():
    page = _page(_item_list(_posting("A Dev"), _posting("B Dev")),
                 {"@graph": [{"@type": "WebSite"}, _posting("C Dev")]},
                 _posting("D Dev", **{"@type": ["JobPosting", "Thing"]}))
    assert [p["title"] for p in extract_postings(page)] == ["A Dev", "B Dev", "C Dev", "D Dev"]


def test_a_broken_block_does_not_lose_the_good_ones():
    page = '<script type="application/ld+json">{not json,}</script>' + _page(_posting("Good Dev"))
    assert [p["title"] for p in extract_postings(page)] == ["Good Dev"]


# ---------------------------------------------------------------- mapping
def test_a_posting_becomes_a_complete_job():
    posting = _posting(url="https://example.org/jobs/7", jobLocation={"address": {"addressLocality": "Uttara, Dhaka"}})
    [job] = _source({"https://example.org/?search=software+engineer": _page(_item_list(posting))},
                    [SITE]).collect(["software engineer"])
    assert (job.title, job.company) == ("Junior Software Engineer", "Acme Ltd")
    assert job.url == "https://example.org/jobs/7"
    assert job.source == "Test Board" and job.discoveredBy == "jsonld"
    assert job.location == "Uttara, Dhaka" and job.employmentType == "Full time"
    assert job.postedAt == "2026-09-20" and job.deadline == "2026-11-19"
    assert job.category == "Software Development"


def test_a_deadline_of_1970_means_unset_and_a_zero_salary_means_not_stated():
    posting = _posting(validThrough="1970-01-01T00:00:00.000Z",
                       baseSalary={"currency": "BDT", "value": {"value": 0, "unitText": "MONTH"}})
    [job] = _source({"https://example.org/?search=x": _page(posting)}, [SITE], relevance="all").collect(["x"])
    assert job.deadline is None and job.salaryMin is None


@pytest.mark.parametrize("value,expected", [
    ({"minValue": 30000, "maxValue": 40000, "unitText": "MONTH"}, (30000, 40000)),
    ({"value": 600000, "unitText": "YEAR"}, (50000, None)),
    ({"value": 500, "unitText": "HOUR"}, (None, None)),      # not convertible to a monthly floor
])
def test_published_salaries_are_converted_to_monthly_taka(value, expected):
    posting = _posting(baseSalary={"currency": "BDT", "value": {"@type": "QuantitativeValue", **value}})
    [job] = _source({"https://example.org/?search=x": _page(posting)}, [SITE], relevance="all").collect(["x"])
    assert (job.salaryMin, job.salaryMax) == expected


def test_awkward_real_world_encodings_are_tolerated():
    posting = _posting(
        description=json.dumps("<p>Salary: Tk 30,000 - 40,000</p>"),                     # encoded twice
        jobLocation=json.dumps({"@type": "Place", "address": {"addressLocality": "Dhaka"}}),  # a JSON string
    )
    [job] = _source({"https://example.org/?search=x": _page(posting)}, [SITE], relevance="all").collect(["x"])
    assert job.location == "Dhaka" and (job.salaryMin, job.salaryMax) == (30000, 40000)


def test_a_remote_posting_is_marked_remote():
    posting = _posting(jobLocationType="TELECOMMUTE")
    [job] = _source({"https://example.org/?search=x": _page(posting)}, [SITE], relevance="all").collect(["x"])
    assert job.location.startswith("Remote")


def test_titles_and_companies_are_one_clean_line():
    posting = _posting(title="Design\nArtist/Designer\nOnsite\n/\nFull Time\nApply",
                       hiringOrganization={"name": "Ollyo\n  Ltd"})
    [job] = _source({"https://example.org/?search=x": _page(posting)}, [SITE], relevance="all").collect(["x"])
    assert job.title == "Design Artist/Designer Onsite / Full Time Apply" and job.company == "Ollyo Ltd"


def test_placeholder_locations_are_dropped():
    posting = _posting(jobLocation={"address": {"addressLocality": "Not specified", "addressRegion": "Dhaka"}})
    [job] = _source({"https://example.org/?search=x": _page(posting)}, [SITE], relevance="all").collect(["x"])
    assert job.location == "Dhaka"


def test_postings_older_than_max_age_days_are_skipped_but_undated_ones_are_kept():
    old = (date.today() - timedelta(days=200)).isoformat()
    fresh = (date.today() - timedelta(days=5)).isoformat()
    page = _page(_item_list(_posting("Old Dev", datePosted=old, url="https://example.org/jobs/1"),
                            _posting("Fresh Dev", datePosted=fresh, url="https://example.org/jobs/2"),
                            _posting("Undated Dev", datePosted=None, url="https://example.org/jobs/3")))
    site = {**SITE, "max_age_days": 45}
    jobs = _source({"https://example.org/?search=x": page}, [site], relevance="all").collect(["x"])
    assert [j.title for j in jobs] == ["Fresh Dev", "Undated Dev"]


def test_a_site_can_disown_its_own_deadlines():
    page = _page(_posting(validThrough="2026-11-19"))
    [job] = _source({"https://example.org/?search=x": page}, [{**SITE, "ignore_deadline": True}],
                    relevance="all").collect(["x"])
    assert job.deadline is None


# -------------------------------------------------------- links are honest
def test_a_listing_posting_without_its_own_url_is_skipped():
    """A link that does not lead to that job is worse than no job."""
    listing = _page(_item_list(_posting("A Dev", url=None), _posting("B Dev", url=None)))
    assert _source({"https://example.org/?search=x": listing}, [SITE], relevance="all").collect(["x"]) == []


def test_a_single_posting_page_may_use_its_own_address():
    page = _page(_posting("Only Dev", url=None))
    [job] = _source({"https://example.org/job/1": page}, [{"label": "T", "url": "https://example.org/job/1"}],
                    relevance="all").collect(["x"])
    assert job.url == "https://example.org/job/1"


def test_relative_urls_are_resolved_against_the_page():
    page = _page(_item_list(_posting("A Dev", url="/jobs/9")))
    [job] = _source({"https://example.org/?search=x": page}, [SITE], relevance="all").collect(["x"])
    assert job.url == "https://example.org/jobs/9"


# -------------------------------------------------------------- searching
def test_each_query_is_one_url_encoded_request_and_duplicates_are_folded():
    same = _page(_item_list(_posting("Web Developer", url="https://example.org/jobs/1")))
    source = _source({"https://example.org/?search=web+developer": same,
                      "https://example.org/?search=PHP+developer": same}, [SITE])
    jobs = source.collect(["web developer", "PHP developer"])
    assert source.fetcher.urls == ["https://example.org/?search=web+developer",
                                   "https://example.org/?search=PHP+developer"]
    assert len(jobs) == 1


def test_a_site_can_search_its_own_subset_but_results_are_checked_against_all_queries():
    site = {**SITE, "queries": ["web developer"]}
    page = _page(_item_list(_posting("Web Developer", url="https://example.org/jobs/1"),
                            _posting("Marketing Executive", url="https://example.org/jobs/2"),
                            _posting("Chef", url="https://example.org/jobs/3")))
    source = _source({"https://example.org/?search=web+developer": page}, [site])
    titles = [j.title for j in source.collect(["web developer", "marketing executive"])]
    assert titles == ["Web Developer", "Marketing Executive"] and len(source.fetcher.urls) == 1


def test_max_queries_caps_the_requests():
    source = _source({}, [{**SITE, "max_queries": 2}])
    source.collect(["a b", "c d", "e f", "g h"])
    assert len(source.fetcher.urls) == 2


# --------------------------------------------------------------- failures
def test_a_refusing_or_empty_site_is_recorded_not_fatal():
    class Refusing:
        def get(self, url):
            raise RobotsDisallowed(url)

    source = JSONLDSource(Refusing(), {"sites": [SITE]})
    assert source.collect(["web developer"]) == [] and source.errors
    empty = _source({}, [SITE])
    assert empty.collect(["web developer"]) == [] and empty.errors


# ----------------------------------------------------------------- wiring
def test_it_is_registered_and_bd_tech_jobs_is_configured():
    assert "jsonld" in REGISTRY
    cfg = load_config("config/search.yml")["sources"]["jsonld"]
    assert cfg["enabled"] is True
    site = next(s for s in cfg["sites"] if s["label"] == "BD Tech Jobs")
    assert site["url"].startswith("https://") and site["max_age_days"] and site["ignore_deadline"] is True

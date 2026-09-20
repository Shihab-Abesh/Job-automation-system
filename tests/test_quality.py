"""The parts that decide whether the feed is worth reading: remote-feed filtering, the
abroad gate, the priority bar, and the notifications. All offline."""
from __future__ import annotations

import json

import pytest

from backend import health, notify
from backend.geo import foreign_country
from backend.models import Job
from backend.scoring import apply_gates
from backend.sources.rss_feed import RSSSource

PROFILE = {"preferences": {"minimumMatch": 50, "strongMatch": 65, "excluded": []}}
FILTERS = {"min_salary_bdt": 0, "max_distance_km": 0}


# ------------------------------------------------------------ remote feeds
def _item(title, region, link):
    return (f"<item><title>{title}</title><link>{link}</link><region>{region}</region>"
            f"<description>&lt;p&gt;Build things.&lt;/p&gt;</description></item>")


FEED = ("<rss><channel>"
        + _item("Acme: Junior Web Developer", "Anywhere in the World", "https://e.org/1")
        + _item("Beta: Web Developer", "USA Only", "https://e.org/2")
        + _item("Gamma: Head Chef", "Anywhere in the World", "https://e.org/3")
        + "</channel></rss>")


class StubFetcher:
    def __init__(self, body):
        self.body = body

    def get(self, url):
        return self.body


def _rss(**feed):
    cfg = {"feeds": [{"url": "https://e.org/feed", "label": "Board", "location": "Remote",
                      "title_format": "company: role", "regions": ["anywhere", "asia"], **feed}]}
    return RSSSource(StubFetcher(FEED), cfg)


def test_a_remote_feed_keeps_only_relevant_jobs_you_are_allowed_to_take():
    source = _rss()
    [job] = source.collect(["web developer"])
    assert (job.title, job.company) == ("Junior Web Developer", "Acme")      # "Company: Role" split
    assert "Anywhere in the World" in job.location
    assert source.raw_count == 3                                             # served 3, kept 1


def test_relevance_all_still_applies_the_region_rule():
    titles = [j.title for j in _rss(relevance="all").collect(["web developer"])]
    assert titles == ["Junior Web Developer", "Head Chef"]                    # "USA Only" is still dropped


def test_without_regions_nothing_is_dropped_for_where_it_is():
    titles = [j.title for j in _rss(regions=[]).collect(["web developer"])]
    assert titles == ["Junior Web Developer", "Web Developer"]


# --------------------------------------------------------------- abroad gate
@pytest.mark.parametrize("place,expected", [
    ("United Kingdom", "United Kingdom"), ("Bangalore, India", "India"), ("Dubai, UAE", "Dubai"),
    ("Dhaka, Bangladesh", None), ("Gulshan, Dhaka", None), ("Anywhere in Bangladesh", None),
    ("Romania", "Romania"),                      # "oman" must not fire inside a longer word
    ("", None),
])
def test_foreign_country_detection(place, expected):
    assert foreign_country(place) == expected


def _job(location, score=70, title="Business Analyst"):
    job = Job(title=title, company="X", location=location)
    job.matchScore = score
    return job


def test_a_posting_based_abroad_is_demoted_with_a_reason():
    priority, notes = apply_gates(_job("United Kingdom"), PROFILE, FILTERS)
    assert priority == "C" and any("outside Bangladesh" in n for n in notes)


def test_a_remote_posting_that_names_a_country_is_not_demoted():
    assert apply_gates(_job("Remote (USA)"), PROFILE, FILTERS)[0] == "A"


def test_allow_abroad_switches_the_gate_off():
    assert apply_gates(_job("United Kingdom"), PROFILE, {**FILTERS, "allow_abroad": True})[0] == "A"


# ---------------------------------------------------------------- priority
@pytest.mark.parametrize("score,expected", [(66, "A"), (65, "A"), (64, "B"), (50, "B"), (49, "C")])
def test_priority_follows_the_bar_you_set(score, expected):
    assert apply_gates(_job("Dhaka", score), PROFILE, FILTERS)[0] == expected


def test_profiles_without_a_strong_match_bar_keep_the_old_rule():
    old = {"preferences": {"minimumMatch": 60}}
    assert apply_gates(_job("Dhaka", 79), old, FILTERS)[0] == "B"
    assert apply_gates(_job("Dhaka", 80), old, FILTERS)[0] == "A"


# ------------------------------------------------------------------ health
def _run(tmp_path, report, **kw):
    return health.update(tmp_path / "health.json", report, **kw)


DEAD = {"bdjobs": {"found": 0, "errors": ["empty response"], "raw": None}}
QUIET = {"bdrecruit": {"found": 0, "errors": [], "raw": 131}}      # served jobs, none matched


def test_a_source_is_reported_once_after_it_stays_broken(tmp_path):
    for _ in range(3):
        assert _run(tmp_path, DEAD) == []
    [alert] = _run(tmp_path, DEAD)
    assert alert["source"] == "bdjobs" and alert["streak"] == 4 and alert["errors"] == ["empty response"]
    assert _run(tmp_path, DEAD) == []                                # not reported again


def test_a_quiet_day_is_not_a_broken_source(tmp_path):
    for _ in range(6):
        assert _run(tmp_path, QUIET) == []


def test_a_site_that_serves_nothing_counts_as_broken_even_without_errors(tmp_path):
    silent = {"jsonld": {"found": 0, "errors": [], "raw": 0}}
    for _ in range(3):
        _run(tmp_path, silent)
    assert [a["source"] for a in _run(tmp_path, silent)] == ["jsonld"]


def test_recovery_resets_the_streak_so_a_relapse_is_reported_again(tmp_path):
    for _ in range(4):
        _run(tmp_path, DEAD)
    _run(tmp_path, {"bdjobs": {"found": 5, "errors": [], "raw": 5}})
    for _ in range(3):
        assert _run(tmp_path, DEAD) == []
    assert len(_run(tmp_path, DEAD)) == 1


def test_a_source_switched_off_is_forgotten(tmp_path):
    _run(tmp_path, DEAD)
    _run(tmp_path, QUIET)
    assert "bdjobs" not in json.loads((tmp_path / "health.json").read_text())


def test_errors_alongside_results_are_not_a_broken_source(tmp_path):
    partial = {"careers": {"found": 15, "errors": ["Innolytic: DNS failure"], "raw": None}}
    for _ in range(6):
        assert _run(tmp_path, partial) == []


# ----------------------------------------------------------- notifications
class _Response:
    def __init__(self, body):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return json.dumps(self._body).encode()


@pytest.fixture
def github(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "t0ken")
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/repo")
    sent = []

    def fake(req, timeout=0):
        sent.append(req)
        return _Response({"number": 7})

    monkeypatch.setattr(notify.urllib.request, "urlopen", fake)
    return sent


def _match(title="Web Developer | Ops", **kw):
    job = Job(title=title, company="Acme", url="https://e.org/j/1", location="Dhaka, Bangladesh")
    job.priority, job.matchScore, job.area = "B", 62, "Dhaka"
    for k, v in kw.items():
        setattr(job, k, v)
    return job


def test_new_matches_become_one_issue_that_mentions_you(github):
    ok = notify.send_github_issue([_match(), _match("Data Analyst")],
                                  {"mention": "Shihab-Abesh", "labels": ["new-jobs"]}, "https://site/")
    assert ok and len(github) == 1
    req = github[0]
    assert req.full_url == "https://api.github.com/repos/owner/repo/issues"
    assert req.get_header("Authorization") == "Bearer t0ken"
    body = json.loads(req.data)
    assert "@Shihab-Abesh" in body["body"] and "https://e.org/j/1" in body["body"]
    assert body["labels"] == ["new-jobs"] and body["title"].startswith("2 new job matches")


def test_a_pipe_in_a_title_cannot_break_the_table(github):
    notify.send_github_issue([_match("QA | Manual")], {}, "")
    row = [ln for ln in json.loads(github[0].data)["body"].splitlines() if "e.org/j/1" in ln][0]
    assert row.count("|") == 6                                        # 5 columns, no stray separators


def test_no_matches_means_no_issue(github):
    assert notify.send_github_issue([], {}, "") is False and github == []


def test_outside_actions_it_quietly_does_nothing(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setattr(notify.urllib.request, "urlopen", lambda *a, **k: pytest.fail("no request expected"))
    assert notify.send_github_issue([_match()], {}, "") is False


def test_a_failing_api_is_reported_not_raised(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")

    def boom(*a, **k):
        raise OSError("network down")

    monkeypatch.setattr(notify.urllib.request, "urlopen", boom)
    assert notify.send_github_issue([_match()], {}, "") is False


def test_the_source_problem_issue_explains_what_to_do():
    text = notify.source_problem_body({"source": "bdjobs", "streak": 4, "errors": ["empty response"]}, "me")
    assert text.startswith("@me ") and "bdjobs" in text and "empty response" in text and "sources.yml" in text


# ------------------------------------------------------- excluded titles
@pytest.mark.parametrize("title,demoted", [
    ("Senior Software Engineer", True),
    ("Sr. Executive, MIS", True),                   # "Sr." must match "Sr"
    ("Staff Software Engineer", True),
    ("Team Lead - Support", True),
    ("Leadership Trainee Program", False),          # "Lead" is a word, not a prefix
    ("Management Trainee Officer", False),          # "Manager" is not "Management"
    ("Junior Software Engineer", False),
])
def test_excluded_titles_match_whole_words(title, demoted):
    profile = {"preferences": {"minimumMatch": 50, "strongMatch": 65,
                               "excluded": ["Senior", "Sr", "Staff", "Lead", "Manager"]}}
    priority, notes = apply_gates(_job("Dhaka", 80, title), profile, FILTERS)
    assert (priority == "C" and any("excluded" in n for n in notes)) is demoted

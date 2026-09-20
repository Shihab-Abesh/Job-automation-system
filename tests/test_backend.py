"""Tests for the parts that quietly break: parsing, merging, gating."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.dedupe import deduplicate, jaccard
from backend.geo import resolve
from backend.models import Job
from backend.normalize import (infer_category, normalize_company, normalize_title,
                               parse_date, parse_salary, strip_html)
from backend.scoring import analyze, apply_gates, score_job
from backend.store import Store

PROFILE = json.loads(Path("config/profile.json").read_text(encoding="utf-8"))
FILTERS = {"min_salary_bdt": 20000, "max_distance_km": 10}


# --------------------------------------------------------------- normalize
@pytest.mark.parametrize("a,b", [
    ("Innolytic IT Ltd.", "Innolytic I.T. Limited"),
    ("BRAC Bank PLC", "Brac Bank"),
    ("Square Pharmaceuticals PLC", "SQUARE Pharmaceuticals Ltd"),
])
def test_company_variants_collapse(a, b):
    assert normalize_company(a) == normalize_company(b)


def test_sqa_expands_to_match_the_long_form():
    assert normalize_title("Junior SQA Engineer", drop_seniority=True) == \
           normalize_title("Software Quality Assurance Engineer", drop_seniority=True)


@pytest.mark.parametrize("text,lo,hi", [
    ("Tk. 20,000 - 25,000 (Monthly)", 20000, 25000),
    ("Salary: Tk 18k", 18000, None),
    ("Tk. 1.2 lakh", 120000, None),
    ("25000৳ - 40000৳ / month", 25000, 40000),      # symbol after the number
    ("150000৳ / month", 150000, None),
    ("20,000 Tk - 25,000 Tk", 20000, 25000),
    ("Negotiable", None, None),
    ("", None, None),
])
def test_salary_parsing(text, lo, hi):
    assert parse_salary(text)[:2] == (lo, hi)


def test_salary_range_is_ordered():
    assert parse_salary("Tk 30,000 to Tk 20,000")[:2] == (20000, 30000)


def test_category_inference():
    assert infer_category("Software Quality Assurance Engineer", "manual testing") \
        == "Software Quality Assurance"
    assert infer_category("MIS Officer", "monthly reporting in excel") == "MIS"
    assert infer_category("Application Support Engineer", "troubleshoot tickets") \
        == "Application Support"


@pytest.mark.parametrize("title,body,expected", [
    ("Management Trainee Officer (MTO)", "", "Management & Business"),
    ("Business Development Executive", "", "Management & Business"),
    ("Junior Software Engineer", "PHP and Laravel", "Software Development"),
    ("Web Developer", "", "Software Development"),
    ("Executive – MIS", "", "MIS"),               # "MIS" is not the first word of the title
    ("Assistant Manager, MIS", "", "MIS"),
])
def test_categories_are_not_only_qa_and_mis(title, body, expected):
    assert infer_category(title, body) == expected


def test_short_category_keys_need_whole_words():
    """The bare substring "mis" used to fire on "commission" and "mission"."""
    body = "Join our mission. Commission-based bonus. Promise of growth."
    assert infer_category("Executive", body) != "MIS"


def test_strip_html_drops_scripts():
    out = strip_html("<div>Keep<script>alert(1)</script><br>this</div>")
    assert "alert" not in out and "Keep" in out and "this" in out


def test_relative_dates():
    assert parse_date("2 days ago") is not None
    assert parse_date("25 Sep 2026") == "2026-09-25"
    assert parse_date("not a date at all") is None


# --------------------------------------------------------------------- geo
def test_distance_gate_geography():
    assert resolve("Dhanmondi, Dhaka")[1] < 10
    assert resolve("Uttara, Dhaka")[1] > 10
    assert resolve("Gazipur")[1] > 20
    assert resolve("Work from home")[2] is True


def test_unknown_area_is_not_treated_as_far():
    area, km, _ = resolve("Dhaka")
    assert km is None and "Dhaka" in area


# ------------------------------------------------------------------ dedupe
def _job(title, company, url, desc="", area="Dhanmondi"):
    j = Job(title=title, company=company, url=url, description=desc, source="test")
    j.area = area
    return j


def test_same_role_across_two_boards_merges():
    jobs = [
        _job("Junior SQA Engineer", "Innolytic IT Ltd.",
             "https://jobs.bdjobs.com/jobdetails.asp?id=1", "manual testing jira"),
        _job("Software Quality Assurance Engineer", "Innolytic I.T. Limited",
             "https://linkedin.com/jobs/view/2", "manual testing jira"),
    ]
    merged, removed = deduplicate(jobs)
    assert len(merged) == 1 and removed == 1
    assert len(merged[0].sources) == 2


def test_different_jobs_at_one_company_stay_separate():
    jobs = [
        _job("QA Engineer", "Acme Ltd", "https://x.com/1", "testing"),
        _job("Accounts Officer", "Acme Ltd", "https://x.com/2", "ledger vat"),
    ]
    merged, _ = deduplicate(jobs)
    assert len(merged) == 2


def test_board_urls_are_not_flattened_by_query_stripping():
    """Bdjobs puts the job id in the query string. Regression guard."""
    jobs = [
        _job("QA Engineer", "Acme Ltd", "https://jobs.bdjobs.com/jobdetails.asp?id=1", "aaa bbb"),
        _job("Network Admin", "Other Ltd", "https://jobs.bdjobs.com/jobdetails.asp?id=2", "ccc ddd"),
    ]
    merged, _ = deduplicate(jobs)
    assert len(merged) == 2


def test_tracking_params_still_collapse():
    jobs = [
        _job("QA Engineer", "Acme Ltd", "https://x.com/job/9?utm_source=mail", "a"),
        _job("QA Engineer", "Acme Ltd", "https://x.com/job/9?utm_source=rss&trk=xyz", "a"),
    ]
    merged, removed = deduplicate(jobs)
    assert len(merged) == 1 and removed == 1


def test_jaccard_bounds():
    assert jaccard(set(), {"a"}) == 0.0
    assert jaccard({"a", "b"}, {"a", "b"}) == 1.0


# ----------------------------------------------------------------- scoring
def test_score_matches_the_frontend_formula():
    """Hand-computed against analyzeJob() in index.html."""
    job = Job(title="Manual Testing Engineer", company="X",
              description="manual testing regression testing defect reporting",
              category="Software Quality Assurance")
    a = analyze(job, PROFILE)
    expected = round(a["skillPct"] * .35 + a["expScore"] * .25 + 100 * .15
                     + a["projectScore"] * .15 + a["prefScore"] * .10)
    assert a["score"] == expected
    assert 0 <= a["score"] <= 100


def test_low_pay_is_demoted_not_deleted():
    job = Job(title="QA Engineer", company="X", category="Software Quality Assurance")
    job.salaryMin, job.salaryMax = 12000, 15000
    job.area, job.distanceKm = "Dhanmondi", 2.8
    score_job(job, PROFILE, FILTERS)
    assert job.priority == "C"
    assert any("below your" in n for n in job.gateNotes)
    assert job.matchScore > 0          # the score is untouched by the gate


def test_excluded_title_is_gated():
    job = Job(title="Senior Software Developer", company="X")
    job.area, job.distanceKm = "Dhanmondi", 2.8
    score_job(job, PROFILE, FILTERS)
    assert job.priority == "C"


def test_missing_salary_gets_a_note_but_survives():
    job = Job(title="QA Analyst", company="X", category="Software Quality Assurance",
              description="manual testing test case design regression")
    job.area, job.distanceKm = "Dhanmondi", 2.8
    job.matchScore = 75
    priority, notes = apply_gates(job, PROFILE, FILTERS)
    assert priority in ("A", "B")
    assert any("not stated" in n for n in notes)


# ------------------------------------------------------------------- store
def test_decisions_survive_the_next_run(tmp_path):
    out, ledger = tmp_path / "jobs.json", tmp_path / "ledger.json"
    job = _job("QA Engineer", "Acme Ltd", "https://x.com/1", "testing")
    job.compute_fingerprint("acme", "quality assurance engineer", "Dhanmondi")

    store = Store(out, ledger)
    store.merge([job])
    store.save([job], {})

    store2 = Store(out, ledger)
    assert store2.set_status(job.fingerprint, "Applied")

    again = _job("QA Engineer", "Acme Ltd", "https://x.com/1", "testing")
    again.compute_fingerprint("acme", "quality assurance engineer", "Dhanmondi")
    result = Store(out, ledger).merge([again])
    assert result["jobs"][0].status == "Applied"
    assert result["new_fingerprints"] == []     # not announced as new a second time


def test_expired_postings_drop_out(tmp_path):
    job = _job("QA Engineer", "Acme Ltd", "https://x.com/1")
    job.deadline = "2020-01-01"
    job.compute_fingerprint("acme", "qa engineer", "Dhanmondi")
    result = Store(tmp_path / "j.json", tmp_path / "l.json").merge([job])
    assert result["jobs"] == [] and result["expired"] == 1


def test_a_job_you_are_interviewing_for_is_never_dropped(tmp_path):
    job = _job("QA Engineer", "Acme Ltd", "https://x.com/1")
    job.deadline = "2020-01-01"
    job.status = "Interview"
    job.compute_fingerprint("acme", "qa engineer", "Dhanmondi")
    result = Store(tmp_path / "j.json", tmp_path / "l.json").merge([job])
    assert len(result["jobs"]) == 1

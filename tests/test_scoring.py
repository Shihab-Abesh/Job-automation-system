"""The match score. Hand-computed values, so a change to the formula has to be deliberate."""
from __future__ import annotations

import pytest

from backend.models import Job
from backend.scoring import analyze, level_fit, title_fit

P = {
    "skills": [{"category": "Web", "items": ["PHP", "JavaScript", "MySQL", "HTML", "CSS", "SQL"]},
               {"category": "Testing", "items": ["Manual Testing", "Regression Testing"]}],
    "projects": [], "experience": [],
    "preferences": {"titles": ["Management Trainee Officer", "Junior Software Engineer", "MIS Executive"],
                    "categories": ["Management & Business", "Software Development"]},
}


def job(title, desc="", category="Software Development", exp=""):
    return Job(title=title, company="X", description=desc, category=category, experienceText=exp)


# score = (40 * title + 25 * level + 25 * skills + 10 * preference + 50) // 100
def test_a_management_trainee_role_scores_high_without_a_single_tech_keyword():
    a = analyze(job("Management Trainee Officer (MTO)", category="Management & Business"), P)
    assert (a["titleFit"], a["levelFit"], a["skillFit"], a["prefFit"]) == (100, 100, 0, 100)
    assert a["score"] == 75


def test_a_perfect_fit_scores_100():
    a = analyze(job("Junior Software Engineer", "PHP JavaScript MySQL HTML CSS SQL"), P)
    assert a["skillFit"] == 100 and a["score"] == 100


def test_a_senior_role_is_marked_down_for_a_fresher():
    a = analyze(job("Senior Software Engineer", "PHP"), P)
    assert (a["titleFit"], a["levelFit"], a["skillFit"]) == (67, 10, 17)
    assert a["score"] == 44


def test_an_unrelated_job_scores_low():
    assert analyze(job("Head Chef", category="Hospitality"), P)["score"] < 30


def test_the_score_actually_separates_jobs():
    """The old formula gave almost every job 53-56."""
    scores = [analyze(job(t, d), P)["score"] for t, d in [
        ("Junior Software Engineer", "PHP JavaScript MySQL"), ("Management Trainee Officer", ""),
        ("Senior Software Engineer", "PHP"), ("Head Chef", "")]]
    assert max(scores) - min(scores) > 40


# ---------------------------------------------------------------- level fit
@pytest.mark.parametrize("title,exp,years,expected", [
    ("Software Engineer", "Freshers", 0, 100),
    ("Software Engineer", "1 Year", 0, 80),
    ("Software Engineer", "2 Years", 0, 55),
    ("Software Engineer", "3 Years", 0, 30),
    ("Software Engineer", "5+ Years", 0, 10),
    ("Software Engineer", "3-5 years", 0, 30),          # the lower bound is what counts
    ("Software Engineer", "3 Years", 2, 80),            # experienceYears moves the bar
    ("Software Engineer", "", 0, 65),                   # nothing stated: neutral
    ("Junior Software Engineer", "5 Years", 0, 100),    # the title wins over a contradicting field
    ("Sr. Executive", "", 0, 10),
    ("Graduate Trainee", "", 0, 100),
])
def test_level_fit(title, exp, years, expected):
    p = {"preferences": {"experienceYears": years}}
    assert level_fit(job(title, exp=exp), p) == expected


def test_years_can_come_from_the_description_when_nothing_else_says():
    assert level_fit(job("Software Engineer", "We need 4 years of experience in PHP."), P) == 10


# ---------------------------------------------------------------- title fit
def test_abbreviations_are_expanded_on_both_sides():
    assert title_fit(job("Executive - MIS"), P) == 100          # target "MIS Executive"
    assert title_fit(job("MTO - Research and Development"), P) == 100


def test_title_fit_rounds_half_up_in_integers():
    p = {"preferences": {"titles": ["a b c d e f g h"]}}         # 1 of 8 words = 12.5
    assert title_fit(job("a"), p) == 13


# ----------------------------------------------------------------- skills
def test_skills_match_whole_words_only():
    assert analyze(job("X", "we use phpunit and mysqldump"), P)["matched"] == []
    assert analyze(job("X", "PHP, JavaScript and Manual Testing"), P)["matched"] == ["PHP", "JavaScript", "Manual Testing"]


def test_six_or_more_skills_is_full_marks():
    assert analyze(job("X", "PHP JavaScript MySQL HTML CSS SQL Regression Testing"), P)["skillFit"] == 100


def test_the_pronoun_it_is_not_read_as_information_technology():
    p = {**P, "skills": [{"category": "x", "items": ["Information Technology"]}]}
    assert analyze(job("X", "it is a great place to work"), p)["matched"] == []

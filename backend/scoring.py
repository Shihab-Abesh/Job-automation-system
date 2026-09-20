"""Match scoring. scoring.js in the repo root does the same maths for the dashboard.

Keeping the two identical matters: the number the nightly email shows has to be the number
the dashboard shows, or you stop trusting both. tests/test_parity.py runs both on the same
jobs and fails if they disagree, so everything here is integer arithmetic and the regexes are
the same on both sides.

    score = 40% title fit + 25% level fit + 25% skills + 10% preference      (each part is 0-100)

    title fit   how much of one of your target titles the job title covers
    level fit   whether the job suits your experience. Trainee, junior or 0-1 years is full
                marks; senior, lead, manager or 5+ years is nearly none.
                preferences.experienceYears is how many years you have (default 0, a fresher)
    skills      how many of your listed skills the posting mentions (6 or more is full marks)
    preference  is the job's category one you switched on

The old formula scored almost every job 53-56 because three of its four parts were the same
for nearly every job, so the percentage could not tell a good match from a poor one.
"""
from __future__ import annotations

import re
from typing import Any

from .geo import REMOTE, foreign_country
from .models import Job

STOP_WORDS = set((
    "and or the a an to of in for with on at from by is are be as this that will can "
    "should experience knowledge skills skill requirements responsible preferred plus "
    "using use ability excellent strong good candidate job role position company years year"
).split())

ABBREV = {
    "mto": "management trainee officer", "sqa": "software quality assurance",
    "qa": "quality assurance", "mis": "management information systems",
    "it": "information technology", "ba": "business analyst",
}
SENIOR_RE = re.compile(r"\b(senior|sr|lead|principal|staff|head|director|architect|manager|chief|vp)\b", re.I)
JUNIOR_RE = re.compile(r"\b(junior|jr|trainee|intern|internship|fresher|freshers|graduate|entry)\b", re.I)
YEARS_RE = re.compile(r"(\d+)\s*(?:\+|-\s*\d+|to\s*\d+)?\s*(?:years?|yrs?)\b", re.I)


def normalize(s: str | None) -> str:
    return re.sub(r"[^a-z0-9+#./ ]", " ", (s or "").lower())


def terms(s: str | None) -> list[str]:
    seen, out = set(), []
    for t in normalize(s).split():
        if len(t) > 2 and t not in STOP_WORDS and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _skill_items(p: dict[str, Any]) -> list[str]:
    sk = p.get("skills", {})
    if isinstance(sk, list):
        # New shape: [{"category": "...", "items": [...]}, ...]
        return [item for group in sk for item in group.get("items", [])]
    # Old shape, kept for profiles exported before this changed.
    return [item for key in ("technical", "testing", "tools", "systems", "soft") for item in sk.get(key, [])]


def all_evidence(p: dict[str, Any]) -> str:
    parts: list[str] = list(_skill_items(p))
    for x in p.get("experience", []):
        parts += [x.get("role", ""), x.get("company", "")] + x.get("bullets", [])
    for x in p.get("projects", []):
        parts += [x.get("name", ""), x.get("subtitle", "") or x.get("description", "")] + x.get("skills", []) + x.get("bullets", [])
    return " ".join(parts).lower()


def words(s: str | None, expand: bool = False) -> list[str]:
    """Abbreviations are expanded for titles only: in a description "it" is a pronoun."""
    out: list[str] = []
    for w in re.findall(r"[a-z0-9+#]+", (s or "").lower()):
        out.extend(ABBREV[w].split() if expand and w in ABBREV else [w])
    return out


def title_fit(job: Job, p: dict[str, Any]) -> int:
    have = set(words(job.title, True))
    best = 0
    for target in p.get("preferences", {}).get("titles", []):
        w = list(dict.fromkeys(words(target, True)))
        if not w:
            continue
        hit = sum(1 for x in w if x in have)
        best = max(best, (200 * hit + len(w)) // (2 * len(w)))
    return best


def level_fit(job: Job, p: dict[str, Any]) -> int:
    title = job.title or ""
    if SENIOR_RE.search(title):
        return 10
    if JUNIOR_RE.search(title):
        return 100
    exp = job.experienceText or ""
    if re.search(r"fresher", exp, re.I):
        return 100
    m = YEARS_RE.search(exp) or YEARS_RE.search(title) or YEARS_RE.search((job.description or "")[:800])
    if not m:
        return 65
    have = int(float(p.get("preferences", {}).get("experienceYears") or 0))
    gap = max(0, int(m.group(1)) - have)
    return (100, 80, 55, 30)[gap] if gap < 4 else 10


def skill_phrases(p: dict[str, Any]) -> list[tuple[str, str]]:
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    projects = [s for x in p.get("projects", []) for s in x.get("skills", [])]
    for item in [*_skill_items(p), *projects]:
        key = " ".join(words(item, False))
        if len(key) > 1 and key not in seen:
            seen.add(key)
            out.append((str(item).strip(), key))
    return out


def analyze(job: Job, p: dict[str, Any]) -> dict[str, Any]:
    text = " ".join([job.title or "", job.description or "", job.requiredSkills or ""])
    evidence = all_evidence(p)
    missing = [t for t in terms(text) if t not in evidence][:12]

    hay = " " + " ".join(words(text, False)) + " "
    matched = [name for name, key in skill_phrases(p) if f" {key} " in hay]

    title = title_fit(job, p)
    level = level_fit(job, p)
    skill = min(100, (100 * len(matched) + 3) // 6)
    cat = (job.category or "").lower()
    pref = 100 if any(c.lower() == cat for c in p.get("preferences", {}).get("categories", [])) else 40
    score = (40 * title + 25 * level + 25 * skill + 10 * pref + 50) // 100
    return {
        "score": score,
        "titleFit": title,
        "levelFit": level,
        "skillFit": skill,
        "prefFit": pref,
        "matched": matched[:15],
        "missing": missing,
    }


# ---------------------------------------------------------------------------
# Hard gates: the things you told the system you will not compromise on.
# These never touch the match score, they only set priority and leave a note,
# so a borderline job is demoted rather than silently deleted.
# ---------------------------------------------------------------------------
def _words(s: str | None) -> str:
    return " ".join(re.findall(r"[a-z0-9+#]+", (s or "").lower()))


def apply_gates(job: Job, p: dict[str, Any], filters: dict[str, Any]) -> tuple[str, list[str]]:
    notes: list[str] = []
    hard_fail = False

    min_salary = int(filters.get("min_salary_bdt") or 0)
    if min_salary:
        if job.salaryMax is not None and job.salaryMax < min_salary:
            notes.append(f"Pay tops out at Tk {job.salaryMax:,}, below your Tk {min_salary:,} floor")
            hard_fail = True
        elif job.salaryMin is not None and job.salaryMin < min_salary:
            notes.append(f"Starts at Tk {job.salaryMin:,}, below your Tk {min_salary:,} floor")
        elif job.salaryMin is None:
            notes.append("Pay not stated, worth asking before you invest time")

    max_km = float(filters.get("max_distance_km") or 0)
    if max_km:
        if job.distanceKm is None:
            notes.append("Exact area not stated in the posting")
        elif job.distanceKm > max_km:
            notes.append(f"{job.area} is about {job.distanceKm} km out, past your {max_km:g} km limit")
            if job.distanceKm > max_km * 2:
                hard_fail = True

    if not filters.get("allow_abroad"):
        country = foreign_country(job.location)
        if country and not REMOTE.search(job.location or ""):
            notes.append(f"Based in {country}, outside Bangladesh")
            hard_fail = True

    # Whole words, so "Lead" does not demote "Leadership Trainee Program" and "Sr." matches "Sr".
    jt = f" {_words(job.title)} "
    for bad in p.get("preferences", {}).get("excluded", []):
        if _words(bad) and f" {_words(bad)} " in jt:
            notes.append(f"Title matches your excluded list ({bad})")
            hard_fail = True

    prefs = p.get("preferences", {})
    min_match = int(prefs.get("minimumMatch") or 0)
    # strongMatch is the bar you set for "strong". The old rule (80, or minimum + 20) is only
    # the fallback for profiles that never set one.
    strong = int(prefs.get("strongMatch") or max(80, min_match + 20))

    if hard_fail:
        priority = "C"
    elif job.matchScore >= strong:
        priority = "A"
    elif job.matchScore >= min_match:
        priority = "B"
    else:
        priority = "C"
    return priority, notes


def score_job(job: Job, profile: dict[str, Any], filters: dict[str, Any]) -> Job:
    a = analyze(job, profile)
    job.matchScore = a["score"]
    job.scoreParts = {
        "title": a["titleFit"],
        "level": a["levelFit"],
        "skills": a["skillFit"],
        "preference": a["prefFit"],
    }
    if not job.requiredSkills and a["missing"]:
        job.requiredSkills = ", ".join(a["missing"])
    job.priority, job.gateNotes = apply_gates(job, profile, filters)
    return job

"""Match scoring, ported line for line from analyzeJob() in index.html.

Keeping the two implementations identical matters: the number the nightly email
shows has to be the same number the dashboard shows, or you stop trusting both.
"""
from __future__ import annotations

import re
from typing import Any

from .models import Job

STOP_WORDS = set((
    "and or the a an to of in for with on at from by is are be as this that will can "
    "should experience knowledge skills skill requirements responsible preferred plus "
    "using use ability excellent strong good candidate job role position company years year"
).split())


def normalize(s: str | None) -> str:
    return re.sub(r"[^a-z0-9+#./ ]", " ", (s or "").lower())


def terms(s: str | None) -> list[str]:
    seen, out = set(), []
    for t in normalize(s).split():
        if len(t) > 2 and t not in STOP_WORDS and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def all_evidence(p: dict[str, Any]) -> str:
    sk = p.get("skills", {})
    parts: list[str] = []
    for key in ("technical", "testing", "tools", "systems", "soft"):
        parts += sk.get(key, [])
    for x in p.get("experience", []):
        parts += [x.get("role", ""), x.get("company", "")] + x.get("bullets", [])
    for x in p.get("projects", []):
        parts += [x.get("name", ""), x.get("description", "")] + x.get("skills", []) + x.get("bullets", [])
    return " ".join(parts).lower()


def analyze(job: Job, p: dict[str, Any]) -> dict[str, Any]:
    text = " ".join([job.title or "", job.description or "", job.requiredSkills or ""])
    raw = terms(text)
    evidence = all_evidence(p)

    matched = [t for t in raw if t in evidence]
    missing = [t for t in raw if t not in evidence][:12]
    skill_pct = round(len(matched) / len(raw) * 100) if raw else 0

    prefs = p.get("preferences", {})
    jt = normalize(job.title)
    title_pref = any(
        (normalize(x) and (normalize(x) in jt or jt in normalize(x)))
        for x in prefs.get("titles", [])
    )

    cat = (job.category or "").lower()
    relevant_exp = sum(
        1 for x in p.get("experience", [])
        if cat and cat in " ".join([x.get("role", "")] + x.get("tags", [])).lower()
    )
    project_hits = 0
    for x in p.get("projects", []):
        if any(c.lower() == cat for c in x.get("categories", [])):
            project_hits += 1
            continue
        blob = normalize(" ".join(
            [x.get("name", ""), x.get("description", "")] + x.get("skills", []) + x.get("bullets", [])
        )).split()
        if any(t in raw for t in blob):
            project_hits += 1

    exp_score = min(100, 85 if relevant_exp else 45)
    project_score = min(100, project_hits * 35)
    pref_score = 100 if (title_pref or any(c.lower() == cat for c in prefs.get("categories", []))) else 40

    score = round(
        skill_pct * 0.35 + exp_score * 0.25 + 100 * 0.15 + project_score * 0.15 + pref_score * 0.10
    )
    return {
        "score": int(score),
        "skillPct": skill_pct,
        "expScore": exp_score,
        "projectScore": project_score,
        "prefScore": pref_score,
        "matched": matched[:30],
        "missing": missing,
    }


# ---------------------------------------------------------------------------
# Hard gates: the things you told the system you will not compromise on.
# These never touch the match score, they only set priority and leave a note,
# so a borderline job is demoted rather than silently deleted.
# ---------------------------------------------------------------------------
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

    jt = normalize(job.title)
    for bad in p.get("preferences", {}).get("excluded", []):
        if normalize(bad) and normalize(bad) in jt:
            notes.append(f"Title matches your excluded list ({bad})")
            hard_fail = True

    min_match = int(p.get("preferences", {}).get("minimumMatch") or 0)

    if hard_fail:
        priority = "C"
    elif job.matchScore >= max(80, min_match + 20):
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
        "keyword": a["skillPct"],
        "experience": a["expScore"],
        "projects": a["projectScore"],
        "preference": a["prefScore"],
    }
    if not job.requiredSkills and a["missing"]:
        job.requiredSkills = ", ".join(a["missing"])
    job.priority, job.gateNotes = apply_gates(job, profile, filters)
    return job

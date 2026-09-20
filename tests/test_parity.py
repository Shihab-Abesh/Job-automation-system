"""The dashboard (scoring.js) and the pipeline (scoring.py) must give the same number.

If they ever disagree, the email says 72% and the screen says 68%, and you stop trusting both.
This runs both on the real postings in the committed feed and on awkward hand-made ones.
Skipped where Node is not installed; GitHub's runners have it, so CI always runs it.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from backend.models import Job
from backend.scoring import analyze

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")

HARNESS = """
const fs = require("fs");
const api = new Function(fs.readFileSync(process.argv[2], "utf8") + "\\nreturn {analyzeJob};")();
const { profile, jobs } = JSON.parse(fs.readFileSync(0, "utf8"));
console.log(JSON.stringify(jobs.map(j => {
  const a = api.analyzeJob(j, profile);
  return [a.score, a.titleFit, a.levelFit, a.skillFit, a.prefFit, a.matched, a.missing];
})));
"""

AWKWARD = [
    {"title": "MTO - Batch 2026", "description": "MBA or BBA. Rotations across operations.", "category": "Management & Business"},
    {"title": "Executive, IT", "description": "it is a great place. Support desk, SQL and Oracle.", "category": "Information Technology"},
    {"title": "Sr. PHP Developer (Laravel)", "description": "5+ years with PHP, MySQL, JavaScript.", "category": "Software Development"},
    {"title": "Software Engineer", "description": "We want 3-5 years experience.", "category": "Software Development", "experienceText": "3-5 Years"},
    {"title": "Junior Data Analyst", "description": "", "category": "Data & Reporting", "experienceText": "Freshers"},
    {"title": "Manager, QA & Testing", "description": "Manual testing and regression testing.", "category": "Software Quality Assurance"},
    {"title": "", "description": "", "category": ""},
    {"title": "Trainee Officer (Credit) 2 yrs", "description": "PHP", "category": "Nonsense"},
    {"title": "A B C D E F G H", "description": "html css", "category": "MIS"},
]


def _profile():
    p = json.loads((ROOT / "config" / "profile.json").read_text(encoding="utf-8"))
    if isinstance(p["skills"], dict):                        # the dashboard stores skills as groups
        p["skills"] = [{"category": k, "items": v} for k, v in p["skills"].items()]
    p["preferences"]["experienceYears"] = 1
    return p


def _real_jobs():
    feed = json.loads((ROOT / "data" / "jobs.json").read_text(encoding="utf-8"))["jobs"]
    keep = ("title", "description", "category", "experienceText", "requiredSkills")
    return [{k: j.get(k, "") or "" for k in keep} for j in feed]


@pytest.mark.skipif(NODE is None, reason="Node is not installed")
def test_python_and_javascript_agree_on_every_job(tmp_path):
    profile, jobs = _profile(), AWKWARD + _real_jobs()
    harness = tmp_path / "harness.js"
    harness.write_text(HARNESS, encoding="utf-8")
    run = subprocess.run([NODE, str(harness), str(ROOT / "scoring.js")],
                         input=json.dumps({"profile": profile, "jobs": jobs}),
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert run.returncode == 0, run.stderr
    from_js = json.loads(run.stdout)
    assert len(from_js) == len(jobs) and len(jobs) >= 20

    for js, raw in zip(from_js, jobs):
        a = analyze(Job(**{"company": "X", **raw}), profile)
        py = [a["score"], a["titleFit"], a["levelFit"], a["skillFit"], a["prefFit"], a["matched"], a["missing"]]
        assert py == js, f"scoring.py and scoring.js disagree on {raw['title']!r}: python={py} js={js}"

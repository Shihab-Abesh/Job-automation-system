"""Recruiter keywords (keywords.js) and the feed sync (feed-sync.js) are browser code, so the tests
that matter live in tests/js and run under Node. This runs them as part of pytest.

Skipped where Node is not installed; GitHub's runners have it, so CI always runs them.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="Node is not installed")
@pytest.mark.parametrize("script", ["keywords.test.js", "feed_sync.test.js", "requirements.test.js", "applypack.test.js"])
def test_browser_code_passes_its_node_tests(script):
    run = subprocess.run([NODE, str(ROOT / "tests" / "js" / script)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    failures = [line for line in run.stdout.splitlines() if line.startswith(("FAIL", "     "))]
    assert run.returncode == 0, "\n".join(failures) or run.stderr


def test_the_dashboard_puts_only_what_the_user_added_on_the_resume():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert '<script src="keywords.js"></script>' in html
    # the resume line comes only from pickForResume, which returns exactly the keywords pressed Add for
    assert html.count("pickForResume(") >= 1
    assert "pickForResume(kws,rk)" in html
    assert "normalizeDecisions(job.resumeKeywords)" in html
    # added keywords are slotted into the profile's own categories (placeKeywords), not one flat list
    assert "placeKeywords(p.skills,addedKw)" in html
    # every keyword has an Add and a Not add button, and choices are stored on the job (a separate resume each)
    assert 'data-testid="kw-add"' in html and 'data-testid="kw-skip"' in html
    assert "resumeKeywords:{...rk,...patch}" in html
    # a job outside every fixed field gets the General resume rather than another field's
    assert '"General":{label:' in html and ':"General";' in html
    assert '"Other"' in html
    # every export reads the same rows, so PDF, DOCX, TXT and the preview cannot disagree
    assert html.count("skillRows.") + html.count("skillRows)") >= 3
    # keywords.js must load after scoring.js and before the app script that uses it
    assert html.index("scoring.js") < html.index("keywords.js") < html.index('<script type="text/babel">')


def test_feed_sync_keeps_every_field_the_dashboard_stores_on_a_job():
    sync = (ROOT / "feed-sync.js").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for field in ("resumeOverrides", "resumeKeywords", "pastedDescription", "selectedStrategy", "applicationPack"):
        assert f'"{field}"' in sync, f"feed-sync.js would drop {field}"
        assert field in html, f"{field} is no longer used by the dashboard; remove it from feed-sync.js"


def test_every_lexicon_entry_has_a_field_group_for_placing_it_on_the_resume():
    """placeKeywords needs a real `group` on every entry, or an added keyword has nowhere sensible to go."""
    js = (ROOT / "keywords.js").read_text(encoding="utf-8")
    start = js.index("const KW_LEXICON=`") + len("const KW_LEXICON=`")
    end = js.index("`;", start)
    group, kind, missing = None, None, []
    for raw in js[start:end].split("\n"):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#!group "):
            group = line[len("#!group "):].strip()
            continue
        if line.startswith("#!"):
            kind = line[2:].strip()
            continue
        if kind != "degree" and not group:
            missing.append(line)
    assert not missing, f"no #!group set before: {missing[:5]}"


def test_the_dashboard_wires_the_requirements_panel_and_the_new_preference():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    # analyzeRequirements is fed the SAME annotated keyword list the Recruiter Keywords panel uses,
    # so the two panels can never disagree about what a term is or whether the profile backs it
    assert "analyzeRequirements(kws,jd,job.title,job,p)" in html
    assert '<RequirementsPanel req={requirements}/>' in html
    # the salary comparison needs a real preference to compare against, defaulting to "not set"
    assert "expectedSalaryMin:null" in html
    assert 'aria-label="Expected minimum monthly salary"' in html
    # the hard-requirement badge sits right where the Add/Not add decision is made, not only in the
    # read-only panel above it
    assert 'data-testid="kw-years"' in html


def test_years_regex_understands_en_dash_ranges_the_same_way_everywhere():
    """A real posting wrote '12–15 years' with an en dash, not a hyphen, and every copy of this
    regex (scoring.js, keywords.js, backend/scoring.py) must take the lower bound, not fall through
    to matching the second number alone."""
    pattern = r"(\d+)\s*(?:\+|[–—-]\s*\d+|to\s*\d+)?\s*(?:years?|yrs?)\b"
    for path in ("scoring.js", "keywords.js", "backend/scoring.py"):
        src = (ROOT / path).read_text(encoding="utf-8")
        assert pattern in src, f"{path} still has the narrower, hyphen-only years pattern"


def test_the_dashboard_wires_the_application_pack():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    # applypack.js loads after keywords.js (it reuses keywordHits / extractResponsibilities) and before the app
    assert html.index("keywords.js") < html.index("applypack.js") < html.index('<script type="text/babel">')
    # built from the SAME keywords, requirements and Add choices the other panels use
    assert "buildApplicationPack({profile:p,job,kws,addedKw,text:jd,requirements,coverBefore,coverNow,score:a.score})" in html
    assert "<ApplicationPack " in html
    # edits are kept per job, and can be reset to what was generated
    assert "updateJob(job.id,{applicationPack:{...apSaved,...patch}})" in html
    assert 'data-testid={"pack-"+id+"-reset"}' in html
    # a resume shows the most relevant experience first, and salary is a sort option
    assert "rankExperience(p.experience,found)" in html
    assert '<option value="salary">Sort: highest salary</option>' in html


def test_the_pack_never_sends_anything():
    """It is text to copy. No fetch, no mailto, no form post, no window.open anywhere in the module."""
    src = (ROOT / "applypack.js").read_text(encoding="utf-8")
    for forbidden in ("fetch(", "XMLHttpRequest", "mailto:", "window.open", "sendBeacon", "location.href"):
        assert forbidden not in src, f"applypack.js must not contain {forbidden}"

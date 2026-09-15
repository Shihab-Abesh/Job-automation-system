"""Optional browser driver for application forms.

Two rules are hard-coded and not configurable:

  1. It only ever opens jobs you have already marked "Awaiting Approval".
  2. It fills fields and stops. It does not click submit, ever.

Point two is deliberate. Auto-submitting applications breaks the terms of every
job board worth applying through, and a recruiter who spots a bot-filled form
bins the application. The value here is the two minutes of retyping it saves,
not the click at the end.

    pip install playwright && playwright install chromium
    python tools/apply_assist.py --fingerprint 2e1d36e441e57983
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

FIELD_MAP = [
    (r"first ?name|given ?name", "firstName"),
    (r"last ?name|surname|family ?name", "lastName"),
    (r"full ?name|^name$", "fullName"),
    (r"e-?mail", "email"),
    (r"phone|mobile|contact ?number", "phone"),
    (r"linked ?in", "linkedin"),
    (r"github", "github"),
    (r"address|city|location", "location"),
    (r"university|institution|college", "university"),
    (r"degree|qualification", "degree"),
    (r"cgpa|gpa|result", "cgpa"),
]


def load(path: str):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fingerprint", required=True)
    ap.add_argument("--feed", default="data/jobs.json")
    ap.add_argument("--profile", default="config/profile.json")
    args = ap.parse_args()

    jobs = load(args.feed).get("jobs", [])
    job = next((j for j in jobs if j.get("fingerprint") == args.fingerprint), None)
    if not job:
        return print(f"No job with fingerprint {args.fingerprint}") or 1
    if job.get("status") != "Awaiting Approval":
        return print(
            f"'{job['title']}' is marked '{job.get('status')}'.\n"
            f"Approve it in the queue first. This tool will not open anything you "
            f"have not signed off."
        ) or 2

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return print("Playwright is not installed. Use the bookmarklet instead:\n"
                     "  python tools/make_bookmarklet.py") or 3

    p = load(args.profile).get("personal", {})
    edu = (load(args.profile).get("education") or [{}])[0]
    first, _, last = p.get("fullName", "").partition(" ")
    values = {
        "fullName": p.get("fullName", ""), "firstName": first, "lastName": last,
        "email": p.get("email", ""), "phone": p.get("phone", ""),
        "linkedin": p.get("linkedin", ""), "github": p.get("github", ""),
        "location": p.get("location", ""),
        "university": edu.get("institution", ""), "degree": edu.get("degree", ""),
        "cgpa": edu.get("cgpa", ""),
    }

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)   # you must be able to see it
        page = browser.new_page()
        page.goto(job["url"], wait_until="domcontentloaded")
        filled = 0
        for el in page.query_selector_all("input, textarea"):
            if (el.get_attribute("type") or "").lower() in (
                    "hidden", "submit", "button", "file", "checkbox", "radio", "password"):
                continue
            if (el.input_value() or "").strip():
                continue
            label = " ".join(filter(None, [
                el.get_attribute("name"), el.get_attribute("id"),
                el.get_attribute("placeholder"), el.get_attribute("aria-label"),
            ])).lower()
            for pattern, key in FIELD_MAP:
                if re.search(pattern, label) and values.get(key):
                    el.fill(values[key])
                    filled += 1
                    break
        print(f"Filled {filled} fields on {job['title']} at {job['company']}.")
        print("Check every answer, attach your CV, and submit it yourself.")
        input("Press Enter here when you are done to close the browser. ")
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

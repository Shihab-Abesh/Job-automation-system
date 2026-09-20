"""Text cleanup, company/title canonicalisation, BDT salary parsing, category inference.

Everything here is deterministic and offline. No API calls, no paid services.
"""
from __future__ import annotations

import html
import re
import unicodedata
from datetime import datetime, timezone

from .models import CATEGORIES

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")

# Legal-entity noise that differs between boards for the same employer.
_COMPANY_NOISE = re.compile(
    r"\b(ltd|limited|pvt|private|plc|inc|incorporated|llc|co|company|corp|corporation|"
    r"group|holdings|industries|enterprise|enterprises|international|intl|bd|bangladesh|"
    r"sister concern|a concern of|it|technologies|technology|tech|solutions|solution|"
    r"software|systems|services|service)\b",
    re.I,
)

# Wrapper words boards bolt onto titles.
_TITLE_NOISE = re.compile(
    r"\b(urgent|urgently|hiring|we are hiring|immediate|walk in|walk-in|apply now|"
    r"vacancy|vacancies|opening|openings|required|wanted|full time|full-time|part time|"
    r"part-time|contractual|permanent|male|female|freshers?|fresh graduates?)\b",
    re.I,
)

_SENIORITY = re.compile(
    r"\b(junior|jr|senior|sr|lead|principal|head|chief|associate|assistant|asst|"
    r"trainee|intern|internship|entry level|entry-level|mid level|mid-level|i{1,3}|"
    r"l[1-5]|level [1-5])\b",
    re.I,
)

# Short forms used constantly in BD postings. Expanded before matching so that
# "SQA Engineer" and "Software Quality Assurance Engineer" collapse together.
ABBREVIATIONS = {
    "sqa": "software quality assurance",
    "qa": "quality assurance",
    "qc": "quality control",
    "mis": "management information systems",
    "mto": "management trainee officer",
    "erp": "enterprise resource planning",
    "dba": "database administrator",
    "ba": "business analyst",
    "sa": "systems analyst",
    "it": "information technology",
    "is": "information systems",
    "sw": "software",
    "dev": "developer",
    "engr": "engineer",
    "exec": "executive",
    "mgmt": "management",
    "admin": "administrator",
    "sde": "software development engineer",
    "sdet": "software development engineer in test",
}


def strip_html(s: str | None) -> str:
    if not s:
        return ""
    s = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</div>|</tr>", "\n", s)
    s = _TAG.sub(" ", s)
    s = html.unescape(s)
    return clean_ws(s)


def clean_ws(s: str | None) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("\u00a0", " ")
    lines = [_WS.sub(" ", ln).strip() for ln in s.split("\n")]
    return "\n".join(ln for ln in lines if ln).strip()


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return _WS.sub(" ", re.sub(r"[^a-z0-9+#./ ]", " ", s)).strip()


def expand_abbreviations(s: str) -> str:
    out = []
    for tok in slug(s).split():
        out.append(ABBREVIATIONS.get(tok, tok))
    return " ".join(out)


def normalize_company(name: str) -> str:
    """'Innolytic IT Ltd.' and 'Innolytic I.T. Limited' both become 'innolytic'."""
    s = re.sub(r"\(.*?\)", " ", name or "")
    s = slug(s)
    s = re.sub(r"\b([a-z])\.\s*(?=[a-z]\.)", r"\1", s)   # i.t. -> it.
    s = s.replace(".", " ").replace("/", " ")
    s = _COMPANY_NOISE.sub(" ", s)
    s = re.sub(r"\bthe\b", " ", s)
    s = _WS.sub(" ", s).strip()
    return s or slug(name)


def normalize_title(title: str, drop_seniority: bool = False) -> str:
    s = re.sub(r"\(.*?\)", " ", title or "")   # strip parentheticals before slugging
    s = re.sub(r"^[^:]{0,24}:\s*", "", s)       # drop "Urgent Hiring:" style prefixes
    s = slug(s)
    s = _TITLE_NOISE.sub(" ", s)
    s = re.sub(r"\bfor\b.*$", " ", s)          # "QA Engineer for Fintech Product"
    s = re.sub(r"[-/|,]+", " ", s)
    s = expand_abbreviations(s)
    if drop_seniority:
        s = _SENIORITY.sub(" ", s)
    return _WS.sub(" ", s).strip()


# --------------------------------------------------------------------------
# Salary
# --------------------------------------------------------------------------
_NUM = r"(\d[\d,\.]*)"
# The currency marker can sit on either side of the number: "Tk 25,000" or "25000৳".
_SAL_RANGE = re.compile(
    rf"(?:tk|bdt|taka|৳)?\.?\s*{_NUM}\s*(k|thousand|lakh|lac)?\s*(?:(?:tk|bdt|taka)\b|৳)?\s*(?:-|to|–|—)\s*"
    rf"(?:tk|bdt|taka|৳)?\.?\s*{_NUM}\s*(k|thousand|lakh|lac)?",
    re.I,
)
_SAL_SINGLE = re.compile(rf"(?:tk|bdt|taka|৳)\.?\s*{_NUM}\s*(k|thousand|lakh|lac)?", re.I)
_SAL_SINGLE_SUFFIX = re.compile(rf"{_NUM}\s*(k|thousand|lakh|lac)?\s*(?:(?:tk|bdt|taka)\b|৳)", re.I)
_NEGOTIABLE = re.compile(r"negotiab|as per (company )?polic|industry standard|competitive", re.I)


def _to_taka(num: str, suffix: str | None) -> int | None:
    try:
        v = float(num.replace(",", ""))
    except ValueError:
        return None
    sfx = (suffix or "").lower()
    if sfx in ("k", "thousand"):
        v *= 1_000
    elif sfx in ("lakh", "lac"):
        v *= 100_000
    # A bare "25" almost always means 25k in a BD posting; a bare "25000" does not.
    if v < 1000:
        v *= 1_000
    return int(round(v))


def parse_salary(text: str | None) -> tuple[int | None, int | None, str]:
    """Return (min, max, human text). Monthly BDT. (None, None, 'Negotiable') is common."""
    if not text:
        return None, None, ""
    t = clean_ws(text)
    m = _SAL_RANGE.search(t)
    if m:
        lo = _to_taka(m.group(1), m.group(2))
        hi = _to_taka(m.group(3), m.group(4))
        if lo and hi and lo > hi:
            lo, hi = hi, lo
        if lo:
            return lo, hi, f"Tk {lo:,}" + (f" - {hi:,}" if hi else "")
    for single in (_SAL_SINGLE, _SAL_SINGLE_SUFFIX):
        m = single.search(t)
        if m:
            v = _to_taka(m.group(1), m.group(2))
            if v:
                return v, None, f"Tk {v:,}"
    if _NEGOTIABLE.search(t):
        return None, None, "Negotiable"
    return None, None, ""


# --------------------------------------------------------------------------
# Category inference -> one of the buckets the UI already knows (models.CATEGORIES)
# --------------------------------------------------------------------------
_CATEGORY_RULES: list[tuple[str, tuple[str, ...], int]] = [
    ("Software Development",
     ("software engineer", "software developer", "software development", "web developer",
      "php developer", "full stack", "frontend", "front end", "backend", "back end",
      "application developer", "programmer", "java developer", "python developer", "laravel",
      "node.js", ".net", "react developer", "android developer", "flutter",
      "mobile app developer"), 3),
    ("Management & Business",
     ("management trainee", "trainee officer", "business development", "marketing executive",
      "operations executive", "project coordinator", "sales executive", "relationship officer",
      "relationship manager", "supply chain", "human resource", "hr executive", "mba"), 2),
    ("Software Quality Assurance",
     ("quality assurance", "sqa", "software tester", "test engineer", "qa engineer",
      "qa analyst", "test case", "manual testing", "automation testing", "selenium",
      "test automation", "bug tracking", "regression testing", "sdet", "qc engineer"), 3),
    ("MIS",
     ("mis", "management information system", "management information systems",
      "mis executive", "mis officer",
      "reporting officer", "data entry", "record keeping"), 3),
    ("Information Systems",
     ("information systems", "systems analyst", "system analyst", "erp", "system design",
      "requirement analysis", "business systems"), 2),
    ("Data & Reporting",
     ("data analyst", "data operations", "data engineer", "business intelligence",
      "reporting analyst", "power bi", "tableau", "dashboard",
      "sql report", "data visualisation", "data visualization", "analytics"), 2),
    ("Business Analysis",
     ("business analyst", "requirement gathering", "brd", "srs", "stakeholder",
      "process improvement", "gap analysis"), 2),
    ("Application Support",
     ("application support", "technical support", "service desk", "helpdesk",
      "help desk", "l1 support", "l2 support", "support engineer", "troubleshoot"), 2),
    ("Information Technology",
     ("it officer", "it executive", "it support", "network", "hardware", "server",
      "system admin", "database administrator", "it operations", "infrastructure"), 1),
]


def _key_in_title(key: str, hay_title: str) -> bool:
    if f" {key} " in hay_title:
        return True
    # Longer keys also match a leading stem ("management information system" -> "...systems").
    return len(key) > 4 and hay_title.strip().startswith(key)


def _key_in_body(key: str, hay_body: str) -> bool:
    # A bare substring test made "mis" fire on "commission" and "mission". Short keys must
    # be whole words; longer ones must start a word so plurals still match.
    return f" {key} " in hay_body if len(key) <= 4 else f" {key}" in hay_body


def infer_category(title: str, description: str = "") -> str:
    hay_title = " " + normalize_title(title) + " "
    hay_body = " " + slug(description)[:4000] + " "
    best, best_score = "Information Technology", 0
    for cat, keys, weight in _CATEGORY_RULES:
        score = 0
        for k in keys:
            if _key_in_title(k, hay_title):
                score += 3 * weight
            elif _key_in_body(k, hay_body):
                score += weight
        if score > best_score:
            best, best_score = cat, score
    return best if best in CATEGORIES else "Information Technology"


# --------------------------------------------------------------------------
# Dates
# --------------------------------------------------------------------------
_DATE_FORMATS = [
    "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y",
    "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y",
    "%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ",
]


def parse_date(text: str | None) -> str | None:
    """Best-effort date parse -> ISO date string, or None."""
    if not text:
        return None
    t = clean_ws(text).replace("Deadline:", "").replace("Published:", "").strip()
    rel = re.search(r"(\d+)\s*(day|days|hour|hours|week|weeks)\s*ago", t, re.I)
    if rel:
        n = int(rel.group(1))
        unit = rel.group(2).lower()
        days = n if unit.startswith("day") else (0 if unit.startswith("hour") else n * 7)
        ts = datetime.now(timezone.utc).timestamp() - days * 86400
        return datetime.fromtimestamp(ts, timezone.utc).date().isoformat()
    if re.search(r"\btoday\b", t, re.I):
        return datetime.now(timezone.utc).date().isoformat()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(t[:40].strip(), fmt).date().isoformat()
        except ValueError:
            continue
    m = re.search(r"(\d{1,2})[\s/-]([A-Za-z]{3,9}|\d{1,2})[\s/-](\d{4})", t)
    if m:
        for fmt in ("%d %b %Y", "%d %B %Y", "%d %m %Y"):
            try:
                return datetime.strptime(" ".join(m.groups()), fmt).date().isoformat()
            except ValueError:
                continue
    return None

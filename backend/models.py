"""Job record. Serialises to exactly the shape index.html already expects."""
from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any

# Status vocabulary must stay identical to the Tracker component in index.html.
STATUSES = [
    "Awaiting Review",
    "Saved",
    "Awaiting Approval",
    "Applied",
    "Interview",
    "Rejected",
    "Offer",
]

# Category vocabulary must stay identical to Preferences in index.html.
CATEGORIES = [
    "Software Development",
    "Information Technology",
    "Information Systems",
    "MIS",
    "Management & Business",
    "Business Analysis",
    "Data & Reporting",
    "Application Support",
    "Software Quality Assurance",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class SourceRef:
    """One place this posting was found. A merged job can have several."""
    source: str
    url: str
    found_at: str = field(default_factory=now_iso)


@dataclass
class Job:
    # --- fields the existing React app reads directly ---
    title: str
    company: str
    description: str = ""
    category: str = "Information Technology"
    location: str = "Dhaka, Bangladesh"
    source: str = ""
    url: str = ""
    status: str = "Awaiting Review"
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    createdAt: str = field(default_factory=now_iso)
    requiredSkills: str = ""

    # --- fields Stage 2 adds. The React app ignores unknown keys, so these
    #     ride along harmlessly and the review page uses them. ---
    postedAt: str | None = None
    deadline: str | None = None
    salaryMin: int | None = None
    salaryMax: int | None = None
    salaryText: str = ""
    employmentType: str = ""
    experienceText: str = ""
    area: str = ""
    distanceKm: float | None = None
    fingerprint: str = ""
    sources: list[SourceRef] = field(default_factory=list)
    matchScore: int = 0
    scoreParts: dict[str, int] = field(default_factory=dict)
    priority: str = "C"
    gateNotes: list[str] = field(default_factory=list)
    discoveredBy: str = "pipeline"

    def compute_fingerprint(self, norm_company: str, norm_title: str, area: str) -> str:
        raw = f"{norm_company}|{norm_title}|{area or 'unknown'}"
        self.fingerprint = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
        return self.fingerprint

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["sources"] = [s if isinstance(s, dict) else asdict(s) for s in self.sources]
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Job":
        known = set(cls.__dataclass_fields__)
        clean = {k: v for k, v in d.items() if k in known}
        srcs = clean.get("sources") or []
        clean["sources"] = [SourceRef(**s) if isinstance(s, dict) else s for s in srcs]
        return cls(**clean)

    def summary_line(self) -> str:
        pay = self.salaryText or "pay not stated"
        where = self.area or self.location
        return f"{self.title} - {self.company} ({where}, {pay}) [{self.matchScore}%]"


def dumps(jobs: list[Job], meta: dict[str, Any] | None = None) -> str:
    payload = {
        "schema": 2,
        "generatedAt": now_iso(),
        "meta": meta or {},
        "jobs": [j.to_dict() for j in jobs],
    }
    return json.dumps(payload, indent=1, ensure_ascii=False)

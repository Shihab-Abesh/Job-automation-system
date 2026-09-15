"""Feed state.

Two files, both plain JSON in the repo, both diffable in a pull request:

  data/jobs.json        what the dashboard reads
  state/ledger.json     what the pipeline remembers between runs

The ledger is what stops a job you already rejected from reappearing every
morning as a fresh discovery.
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .models import Job, dumps

ACTIVE_STATUSES = {"Saved", "Awaiting Approval", "Applied", "Interview", "Offer"}


def _read_json(path: str | Path, default: Any) -> Any:
    p = Path(path)
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def _write_atomic(path: str | Path, text: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, p)


class Store:
    def __init__(self, output: str | Path, ledger: str | Path):
        self.output = Path(output)
        self.ledger_path = Path(ledger)
        self.ledger: dict[str, dict[str, Any]] = _read_json(self.ledger_path, {})

    # ------------------------------------------------------------------
    def merge(self, fresh: list[Job], retention_days: int = 45,
              drop_expired: bool = True) -> dict[str, Any]:
        previous = {
            j["fingerprint"]: j
            for j in _read_json(self.output, {}).get("jobs", [])
            if j.get("fingerprint")
        }
        today = date.today()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).date().isoformat()

        new_fps: list[str] = []
        kept: list[Job] = []

        for job in fresh:
            fp = job.fingerprint
            record = self.ledger.get(fp)
            old = previous.get(fp)

            if record:
                job.createdAt = record.get("first_seen", job.createdAt)
                decided = record.get("status")
                if decided and decided != "Awaiting Review":
                    job.status = decided
                elif old:
                    job.status = old.get("status", job.status)
                if old and old.get("id"):
                    job.id = old["id"]
            else:
                new_fps.append(fp)
                # Fingerprint, dates and status only. This file is committed to
                # a public repo, and a list of every job you passed on is not
                # something an employer needs to be able to read.
                self.ledger[fp] = {
                    "first_seen": job.createdAt,
                    "status": job.status,
                    "notified": False,
                }
            self.ledger[fp]["last_seen"] = datetime.now(timezone.utc).date().isoformat()
            kept.append(job)

        # Carry forward anything you are actively working, even if the posting
        # has dropped off the boards. You still need it in the tracker.
        live = {j.fingerprint for j in kept}
        for fp, old in previous.items():
            if fp in live:
                continue
            if old.get("status") in ACTIVE_STATUSES:
                kept.append(Job.from_dict(old))

        if drop_expired:
            before = len(kept)
            kept = [j for j in kept if self._still_relevant(j, today, cutoff)]
            expired = before - len(kept)
        else:
            expired = 0

        kept.sort(key=lambda j: ({"A": 0, "B": 1, "C": 2}.get(j.priority, 3), -j.matchScore))
        return {"jobs": kept, "new_fingerprints": new_fps, "expired": expired}

    @staticmethod
    def _still_relevant(job: Job, today: date, cutoff: str) -> bool:
        if job.status in ACTIVE_STATUSES:
            return True
        if job.deadline:
            try:
                if date.fromisoformat(job.deadline) < today:
                    return False
            except ValueError:
                pass
        return (job.createdAt or "")[:10] >= cutoff

    # ------------------------------------------------------------------
    def mark_notified(self, fingerprints: list[str]) -> None:
        for fp in fingerprints:
            self.ledger.setdefault(fp, {})["notified"] = True

    def set_status(self, fingerprint: str, status: str) -> bool:
        """A decision is persisted the moment it is made, not at the end of a
        run. Losing one because a later step crashed would mean re-reviewing a
        job you already said no to."""
        if fingerprint not in self.ledger:
            return False
        self.ledger[fingerprint]["status"] = status
        self.ledger[fingerprint]["decided_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.save_ledger()
        return True

    def save_ledger(self) -> None:
        _write_atomic(self.ledger_path, json.dumps(self.ledger, indent=1, ensure_ascii=False))

    def save(self, jobs: list[Job], meta: dict[str, Any]) -> None:
        _write_atomic(self.output, dumps(jobs, meta))
        self.save_ledger()

"""Notice when a source has quietly stopped working.

The failure this catches is the one Bdjobs had: the site changes, the fetch "succeeds"
with an empty page, and the feed just gets thinner with no error anywhere. A source is
unhealthy for a run when it produced nothing AND either raised errors or, for sources
that track it, the site itself served zero postings. Postings that were served but did
not match your queries are healthy: that is just a quiet day.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Consecutive unhealthy runs before anyone is told (about two days at two runs a day).
THRESHOLD = 4


def _unhealthy(entry: dict[str, Any]) -> bool:
    if entry.get("found", 0) > 0:
        return False
    return bool(entry.get("errors")) or entry.get("raw") == 0


def update(path: str | Path, report: dict[str, dict[str, Any]], threshold: int = THRESHOLD,
           now: datetime | None = None) -> list[dict[str, Any]]:
    """Record this run and return the sources that just crossed the threshold.

    Each problem is reported once. A source that recovers starts a fresh streak, so a
    later relapse is reported again. Sources missing from the report (switched off)
    are forgotten.
    """
    p = Path(path)
    try:
        state = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    except (json.JSONDecodeError, OSError):
        state = {}
    stamp = (now or datetime.now(timezone.utc)).date().isoformat()

    alerts: list[dict[str, Any]] = []
    for source_id, entry in report.items():
        st = state.setdefault(source_id, {"streak": 0, "alerted": False})
        if _unhealthy(entry):
            st["streak"] += 1
            st["last_problem"] = stamp
            if st["streak"] >= threshold and not st["alerted"]:
                st["alerted"] = True
                alerts.append({"source": source_id, "streak": st["streak"],
                               "errors": list(entry.get("errors") or [])[:3]})
        else:
            st.update({"streak": 0, "alerted": False, "last_ok": stamp})
    for source_id in [s for s in state if s not in report]:
        del state[source_id]

    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state, indent=1, sort_keys=True), encoding="utf-8")
    return alerts

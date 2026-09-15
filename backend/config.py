"""Config loading. YAML on disk, secrets from the environment, never both."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import yaml

DEFAULTS: dict[str, Any] = {
    "paths": {
        "profile": "config/profile.json",
        "output": "data/jobs.json",
        "ledger": "state/ledger.json",
        "digest": "state/last_digest.json",
        "http_cache": ".cache/http",
    },
    "queries": [],
    "filters": {
        "min_salary_bdt": 20000,
        "max_distance_km": 10,
        "allow_remote": True,
        "retention_days": 45,
        "drop_expired": True,
    },
    "fetch": {
        "min_interval_seconds": 3.0,
        "timeout_seconds": 25,
        "respect_robots": True,
    },
    "sources": {},
    "notify": {
        "email": {"enabled": False, "to": "", "min_priority": "A"},
        "webhook": {"enabled": False, "url_env": "WEBHOOK_URL", "min_priority": "A"},
    },
}


def load_env(path: str | Path = ".env") -> int:
    """Read KEY=VALUE lines into the environment, for running without GitHub.

    Anything already set in the real environment wins, so a GitHub Actions
    secret is never overwritten by a stray local file.
    """
    p = Path(path)
    if not p.exists():
        return 0
    loaded = 0
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value
            loaded += 1
    return loaded


def _deep_merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config(path: str | Path = "config/search.yml") -> dict[str, Any]:
    load_env()
    p = Path(path)
    data: dict[str, Any] = {}
    if p.exists():
        data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    cfg = _deep_merge(DEFAULTS, data)

    sources_file = p.parent / "sources.yml"
    if sources_file.exists():
        extra = yaml.safe_load(sources_file.read_text(encoding="utf-8")) or {}
        cfg["sources"] = _deep_merge(cfg.get("sources", {}), extra.get("sources", {}))

    # Environment wins, so a workflow can tighten limits without a commit.
    if os.environ.get("MIN_SALARY_BDT"):
        cfg["filters"]["min_salary_bdt"] = int(os.environ["MIN_SALARY_BDT"])
    if os.environ.get("MAX_DISTANCE_KM"):
        cfg["filters"]["max_distance_km"] = float(os.environ["MAX_DISTANCE_KM"])
    return cfg


def load_profile(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(
            f"Master profile not found at {p}. Export it from the dashboard "
            f"(Master Profile -> Export profile) and save it there."
        )
    return json.loads(p.read_text(encoding="utf-8"))

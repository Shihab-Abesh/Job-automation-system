"""Orchestrator and CLI.

    python -m backend.pipeline run
    python -m backend.pipeline run --dry-run
    python -m backend.pipeline probe --source bdjobs --query "quality assurance"
    python -m backend.pipeline import-decisions decisions.json
    python -m backend.pipeline stats
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

from .config import load_config, load_profile
from .dedupe import deduplicate
from .fetcher import Fetcher
from .geo import resolve
from .models import Job, now_iso
from .normalize import clean_ws, infer_category
from .notify import select, send_email, send_webhook
from .scoring import score_job
from .sources import REGISTRY
from .store import Store

log = logging.getLogger("careerpilot")


def setup_logging(verbose: bool = False) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(levelname)-7s %(name)s: %(message)s",
        stream=sys.stdout,
    )


def build_queries(cfg: dict[str, Any], profile: dict[str, Any]) -> list[str]:
    queries = list(cfg.get("queries") or [])
    if not queries:
        queries = list(profile.get("preferences", {}).get("titles", []))[:12]
    seen, out = set(), []
    for q in queries:
        q = clean_ws(q)
        if q and q.lower() not in seen:
            seen.add(q.lower())
            out.append(q)
    return out


def collect(cfg: dict[str, Any], queries: list[str], fetcher: Fetcher) -> tuple[list[Job], dict[str, Any]]:
    jobs: list[Job] = []
    report: dict[str, Any] = {}
    for sid, scfg in (cfg.get("sources") or {}).items():
        cls = REGISTRY.get(sid)
        if not cls:
            log.warning("unknown source '%s' in config, skipping", sid)
            continue
        enabled = scfg.get("enabled", cls.enabled_by_default) if isinstance(scfg, dict) else bool(scfg)
        if not enabled:
            continue
        src = cls(fetcher, scfg if isinstance(scfg, dict) else {})
        qs = (scfg.get("queries") if isinstance(scfg, dict) else None) or queries
        log.info("collecting from %s (%s queries)", src.label, len(qs))
        try:
            found = src.collect(qs)
        except Exception as exc:
            log.exception("source %s crashed", sid)
            found, src.errors = [], src.errors + [str(exc)]
        log.info("  %s returned %s postings", src.label, len(found))
        jobs.extend(found)
        report[sid] = {"found": len(found), "errors": src.errors}
    return jobs, report


def enrich(jobs: list[Job]) -> list[Job]:
    out: list[Job] = []
    for j in jobs:
        j.title = clean_ws(j.title)
        j.company = clean_ws(j.company)
        j.description = clean_ws(j.description)
        if not j.title or not j.company:
            continue
        area, km, remote = resolve(j.location, j.description)
        j.area, j.distanceKm = area, km
        if remote and not j.employmentType:
            j.employmentType = "Remote or hybrid"
        if j.category not in (None, "") and j.category == "Information Technology":
            j.category = infer_category(j.title, j.description)
        out.append(j)
    return out


def run(cfg_path: str, dry_run: bool = False, force_notify: bool = False) -> int:
    cfg = load_config(cfg_path)
    paths = cfg["paths"]
    profile = load_profile(paths["profile"])
    queries = build_queries(cfg, profile)
    log.info("queries: %s", ", ".join(queries) or "(none)")

    fetcher = Fetcher(
        cache_dir=paths["http_cache"],
        min_interval=float(cfg["fetch"]["min_interval_seconds"]),
        timeout=int(cfg["fetch"]["timeout_seconds"]),
        respect_robots=bool(cfg["fetch"]["respect_robots"]),
    )

    raw, source_report = collect(cfg, queries, fetcher)
    log.info("collected %s raw postings", len(raw))

    prepared = enrich(raw)
    merged, removed = deduplicate(prepared)
    log.info("deduplicated: %s unique (%s duplicates folded in)", len(merged), removed)

    filters = cfg["filters"]
    for j in merged:
        score_job(j, profile, filters)

    store = Store(paths["output"], paths["ledger"])
    result = store.merge(
        merged,
        retention_days=int(filters.get("retention_days", 45)),
        drop_expired=bool(filters.get("drop_expired", True)),
    )
    jobs, new_fps = result["jobs"], result["new_fingerprints"]
    by_priority = {p: sum(1 for j in jobs if j.priority == p) for p in "ABC"}
    log.info("feed: %s jobs (A=%s B=%s C=%s), %s new, %s expired",
             len(jobs), by_priority["A"], by_priority["B"], by_priority["C"],
             len(new_fps), result["expired"])

    meta = {
        "queries": queries,
        "sources": source_report,
        "counts": {"total": len(jobs), "new": len(new_fps),
                   "expired": result["expired"], "duplicatesFolded": removed,
                   **{f"priority{p}": by_priority[p] for p in "ABC"}},
        "filters": filters,
        "blockedUrls": fetcher.blocked[:20],
        "ranAt": now_iso(),
    }

    if dry_run:
        log.info("dry run, nothing written")
        for j in jobs[:15]:
            log.info("  [%s] %s", j.priority, j.summary_line())
        return 0

    store.save(jobs, meta)
    log.info("wrote %s", paths["output"])

    ncfg = cfg.get("notify", {})
    notified: list[str] = []
    if ncfg.get("email", {}).get("enabled"):
        picks = select(jobs, new_fps, ncfg["email"].get("min_priority", "A"))
        if force_notify and not picks:
            picks = [j for j in jobs if j.priority == "A"][:5]
        if send_email(picks, ncfg["email"], cfg.get("dashboard_url", "")):
            notified += [j.fingerprint for j in picks]
    if ncfg.get("webhook", {}).get("enabled"):
        picks = select(jobs, new_fps, ncfg["webhook"].get("min_priority", "A"))
        if send_webhook(picks, ncfg["webhook"], cfg.get("dashboard_url", "")):
            notified += [j.fingerprint for j in picks]
    if notified:
        store.mark_notified(notified)
        store.save(jobs, meta)

    Path(paths["digest"]).parent.mkdir(parents=True, exist_ok=True)
    Path(paths["digest"]).write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return 0


def probe(cfg_path: str, source_id: str, query: str) -> int:
    """Print what the page actually looks like, for when selectors go stale."""
    from bs4 import BeautifulSoup
    from collections import Counter

    cfg = load_config(cfg_path)
    fetcher = Fetcher(cache_dir=cfg["paths"]["http_cache"],
                      respect_robots=bool(cfg["fetch"]["respect_robots"]))
    cls = REGISTRY.get(source_id)
    if not cls:
        print(f"unknown source '{source_id}'. known: {', '.join(sorted(REGISTRY))}")
        return 1
    src = cls(fetcher, (cfg.get("sources") or {}).get(source_id, {}))
    url = src._search_url(query) if hasattr(src, "_search_url") else src.config.get("url", "")
    print(f"fetching {url}")
    if not fetcher.allowed(url):
        print("robots.txt disallows this path. This source cannot be scraped.")
        return 2
    html = fetcher.get(url, force=True)
    if not html:
        print("no response body")
        return 3
    soup = BeautifulSoup(html, "lxml")
    print(f"\n{len(html):,} bytes, title: {soup.title.string if soup.title else '(none)'}\n")
    anchors = [a for a in soup.find_all("a", href=True) if "job" in a["href"].lower()]
    print(f"{len(anchors)} job-ish links. Parent classes by frequency:")
    counter = Counter()
    for a in anchors:
        parent = a.find_parent(["div", "tr", "li", "article"])
        if parent and parent.get("class"):
            counter[".".join(parent["class"])] += 1
    for cls_name, n in counter.most_common(12):
        print(f"  {n:4}  .{cls_name}")
    print("\nFirst three links:")
    for a in anchors[:3]:
        print(f"  {clean_ws(a.get_text(' '))[:70]!r} -> {a['href'][:90]}")
    return 0


def import_decisions(cfg_path: str, file: str) -> int:
    """Feed the review page's exported decisions back into the ledger."""
    cfg = load_config(cfg_path)
    store = Store(cfg["paths"]["output"], cfg["paths"]["ledger"])
    data = json.loads(Path(file).read_text(encoding="utf-8"))
    items = data.get("decisions", data) if isinstance(data, dict) else data
    applied = 0
    for item in items:
        fp, status = item.get("fingerprint"), item.get("status")
        if fp and status and store.set_status(fp, status):
            applied += 1
    store.save_ledger()
    print(f"applied {applied} of {len(items)} decisions")
    return 0


def stats(cfg_path: str) -> int:
    cfg = load_config(cfg_path)
    out = Path(cfg["paths"]["output"])
    if not out.exists():
        print("no feed yet, run the pipeline first")
        return 1
    data = json.loads(out.read_text(encoding="utf-8"))
    jobs = data.get("jobs", [])
    print(f"feed generated {data.get('generatedAt')}  |  {len(jobs)} jobs")
    for p in "ABC":
        group = [j for j in jobs if j.get("priority") == p]
        print(f"  priority {p}: {len(group)}")
        for j in group[:5]:
            print(f"     {j.get('matchScore')}%  {j.get('title')} - {j.get('company')}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="careerpilot", description="CareerPilot BD discovery pipeline")
    ap.add_argument("--config", default="config/search.yml")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="discover, dedupe, score, notify")
    r.add_argument("--dry-run", action="store_true", help="print results, write nothing")
    r.add_argument("--force-notify", action="store_true", help="send a digest even with no new jobs")

    p = sub.add_parser("probe", help="inspect a source's HTML when selectors break")
    p.add_argument("--source", required=True)
    p.add_argument("--query", default="quality assurance")

    i = sub.add_parser("import-decisions", help="apply decisions exported from the review page")
    i.add_argument("file")

    sub.add_parser("stats", help="summarise the current feed")

    args = ap.parse_args(argv)
    setup_logging(args.verbose)

    if args.cmd == "run":
        return run(args.config, args.dry_run, args.force_notify)
    if args.cmd == "probe":
        return probe(args.config, args.source, args.query)
    if args.cmd == "import-decisions":
        return import_decisions(args.config, args.file)
    if args.cmd == "stats":
        return stats(args.config)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

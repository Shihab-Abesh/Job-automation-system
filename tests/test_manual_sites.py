"""The Manual Sites list: well formed, honest, and consistent with what the pipeline reads."""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
MANUAL = json.loads((ROOT / "config" / "manual_sites.json").read_text(encoding="utf-8"))
SOURCES = yaml.safe_load((ROOT / "config" / "sources.yml").read_text(encoding="utf-8"))["sources"]
SITES = MANUAL["sites"]


def host(url: str) -> str:
    h = urlparse(url).netloc.lower()
    return h[4:] if h.startswith("www.") else h


def pipeline_hosts() -> set[str]:
    """Hosts the pipeline reads by itself, from the sources that are switched on."""
    hosts: set[str] = set()
    for name, cfg in SOURCES.items():
        if name == "careers" or not cfg.get("enabled"):
            continue                       # careers pages are best-effort and often yield nothing
        for key in ("api_url", "search_url"):
            if cfg.get(key):
                hosts.add(host(cfg[key]))
        for entry in list(cfg.get("sites", [])) + list(cfg.get("feeds", [])):
            hosts.add(host(entry["url"]))
    return hosts


def test_there_are_manual_sites_and_they_are_grouped():
    assert len(SITES) >= 10
    assert all(s.get("group") for s in SITES)


def test_ids_are_unique():
    ids = [s["id"] for s in SITES] + [a["id"] for a in MANUAL["automatic"]]
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize("site", SITES, ids=lambda s: s["id"])
def test_each_site_says_what_it_is_and_why_it_is_manual(site):
    for field in ("id", "name", "url", "why", "note"):
        assert site.get(field, "").strip(), f"{site.get('id')} is missing {field}"
    assert site["url"].startswith(("https://", "http://"))
    if "searchUrl" in site:
        assert site["searchUrl"].startswith(("https://", "http://"))
        assert site["searchUrl"].count("{query}") == 1
        assert host(site["searchUrl"]) == host(site["url"]) or "google." in host(site["searchUrl"])


def test_no_manual_site_is_one_the_pipeline_already_reads():
    overlap = {host(s["url"]) for s in SITES} & pipeline_hosts()
    assert not overlap, f"listed as manual but fetched automatically: {sorted(overlap)}"


def test_bdjobs_is_listed_only_while_its_source_is_off():
    listed = any(s["id"] == "bdjobs" for s in SITES)
    assert listed == (not SOURCES["bdjobs"].get("enabled", False))


def test_automatic_entries_are_really_automatic():
    live = pipeline_hosts()
    for entry in MANUAL["automatic"]:
        assert entry["url"].startswith("https://")
        assert host(entry["url"]) in live, f"{entry['name']} is not fetched by any enabled source"


def test_dashboard_reads_the_list_and_has_the_tab():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert "config/manual_sites.json" in html
    assert '["manual","Manual Sites"]' in html
    assert 'tab==="manual"' in html

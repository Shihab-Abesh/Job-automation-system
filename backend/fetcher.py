"""Polite HTTP layer.

Three rules, enforced here instead of trusted to each source:
  1. robots.txt decides. If a path is disallowed, the fetch does not happen.
  2. One request per host at a time, with a floor on the gap between them.
  3. Cache on disk and revalidate, so a re-run costs the site almost nothing.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
import urllib.robotparser as robotparser
from pathlib import Path
from urllib.parse import urlparse

import requests

log = logging.getLogger("careerpilot.fetch")

DEFAULT_UA = os.environ.get(
    "CAREERPILOT_UA",
    "CareerPilotBD/2.0 (personal job-search assistant; contact: abesh9450@gmail.com)",
)


class RobotsDisallowed(RuntimeError):
    pass


class Fetcher:
    def __init__(
        self,
        cache_dir: str | Path = ".cache/http",
        min_interval: float = 3.0,
        timeout: int = 25,
        respect_robots: bool = True,
        user_agent: str = DEFAULT_UA,
    ):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.min_interval = min_interval
        self.timeout = timeout
        self.respect_robots = respect_robots
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": user_agent,
            "Accept-Language": "en-US,en;q=0.9,bn;q=0.8",
        })
        self._last_hit: dict[str, float] = {}
        self._robots: dict[str, robotparser.RobotFileParser | None] = {}
        self.blocked: list[str] = []

    # -- robots ------------------------------------------------------------
    def _robots_for(self, url: str) -> robotparser.RobotFileParser | None:
        parts = urlparse(url)
        host = f"{parts.scheme}://{parts.netloc}"
        if host in self._robots:
            return self._robots[host]
        rp = robotparser.RobotFileParser()
        rp.set_url(f"{host}/robots.txt")
        try:
            r = self.session.get(f"{host}/robots.txt", timeout=self.timeout)
            if r.status_code == 200:
                rp.parse(r.text.splitlines())
            else:
                rp = None          # no robots.txt published means no restriction
        except requests.RequestException:
            rp = None
        self._robots[host] = rp
        return rp

    def allowed(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        rp = self._robots_for(url)
        if rp is None:
            return True
        return rp.can_fetch(self.session.headers["User-Agent"], url)

    # -- rate limit --------------------------------------------------------
    def _wait(self, url: str) -> None:
        host = urlparse(url).netloc
        gap = time.monotonic() - self._last_hit.get(host, 0.0)
        if gap < self.min_interval:
            time.sleep(self.min_interval - gap)
        self._last_hit[host] = time.monotonic()

    # -- cache -------------------------------------------------------------
    def _cache_path(self, url: str) -> Path:
        return self.cache_dir / (hashlib.sha1(url.encode()).hexdigest() + ".json")

    def get(self, url: str, *, retries: int = 3, force: bool = False) -> str | None:
        """Return page text, or None if it is unavailable or off limits."""
        if not self.allowed(url):
            log.warning("robots.txt disallows %s - skipping", url)
            self.blocked.append(url)
            raise RobotsDisallowed(url)

        cache_file = self._cache_path(url)
        cached = None
        if cache_file.exists() and not force:
            try:
                cached = json.loads(cache_file.read_text())
            except (json.JSONDecodeError, OSError):
                cached = None

        headers = {}
        if cached:
            if cached.get("etag"):
                headers["If-None-Match"] = cached["etag"]
            if cached.get("last_modified"):
                headers["If-Modified-Since"] = cached["last_modified"]

        delay = 2.0
        for attempt in range(1, retries + 1):
            self._wait(url)
            try:
                r = self.session.get(url, headers=headers, timeout=self.timeout)
            except requests.RequestException as exc:
                log.warning("fetch failed (%s/%s) %s: %s", attempt, retries, url, exc)
                time.sleep(delay)
                delay *= 2
                continue

            if r.status_code == 304 and cached:
                log.info("unchanged %s", url)
                return cached["body"]
            if r.status_code == 429 or 500 <= r.status_code < 600:
                log.warning("status %s on %s, backing off", r.status_code, url)
                time.sleep(delay)
                delay *= 2
                continue
            if r.status_code in (401, 403):
                log.warning("status %s on %s - the site is refusing automated access", r.status_code, url)
                self.blocked.append(url)
                return None
            if r.status_code >= 400:
                log.warning("status %s on %s", r.status_code, url)
                return None

            body = r.text
            try:
                cache_file.write_text(json.dumps({
                    "url": url,
                    "body": body,
                    "etag": r.headers.get("ETag"),
                    "last_modified": r.headers.get("Last-Modified"),
                    "fetched_at": time.time(),
                }))
            except OSError:
                pass
            return body

        return cached["body"] if cached else None

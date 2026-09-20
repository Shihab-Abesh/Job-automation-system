"""Cross-board deduplication.

The same vacancy appears on Bdjobs, LinkedIn and a company careers page with
three different titles and three different company spellings. This collapses
them into one record that remembers every place it was seen.
"""
from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .models import Job, SourceRef
from .normalize import normalize_company, normalize_title, slug

TITLE_JACCARD = 0.72     # token overlap needed to call two titles the same role
SIMHASH_DISTANCE = 6     # max hamming distance on description simhash


def _tokens(s: str) -> set[str]:
    return {t for t in slug(s).split() if len(t) > 2}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def simhash(text: str, bits: int = 64) -> int:
    """Cheap near-duplicate signature over description shingles."""
    words = [w for w in slug(text).split() if len(w) > 2]
    if not words:
        return 0
    shingles = [" ".join(words[i:i + 3]) for i in range(max(1, len(words) - 2))]
    vec = [0] * bits
    for sh in shingles:
        h = int(hashlib.md5(sh.encode()).hexdigest(), 16)
        for i in range(bits):
            vec[i] += 1 if (h >> i) & 1 else -1
    out = 0
    for i in range(bits):
        if vec[i] > 0:
            out |= 1 << i
    return out


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


class _Union:
    def __init__(self, n: int):
        self.p = list(range(n))

    def find(self, x: int) -> int:
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def join(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


TRACKING_PARAMS = re.compile(
    r"^(utm_|trk|trackingid|ref|refid|src|source|fbclid|gclid|mc_|lipi|eb|_l|origin"
    r"|alid|jsrc|from|vjk|tk|jk_?src|sponsored)", re.I)


def _url_key(url: str) -> str:
    """Same posting linked with different tracking params is the same posting.

    Only tracking noise is stripped. Query parameters that identify the job
    (Bdjobs puts the job id in ?id=) are kept, or every posting on a board
    would collapse into one.
    """
    raw = (url or "").strip()
    if not raw:
        return ""
    parts = urlsplit(raw.lower())
    keep = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=False)
            if not TRACKING_PARAMS.match(k)]
    query = urlencode(sorted(keep))
    return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), query, ""))


def deduplicate(jobs: list[Job]) -> tuple[list[Job], int]:
    """Return (merged jobs, number removed)."""
    if not jobs:
        return [], 0

    prepped = []
    for j in jobs:
        nc = normalize_company(j.company)
        nt = normalize_title(j.title, drop_seniority=True)
        j.compute_fingerprint(nc, nt, j.area)
        prepped.append({
            "job": j,
            "company": nc,
            "title": nt,
            "title_tokens": _tokens(nt),
            "sim": simhash(j.description or j.title),
            "url": _url_key(j.url),
        })

    uf = _Union(len(prepped))

    by_fp: dict[str, int] = {}
    by_url: dict[str, int] = {}
    for i, p in enumerate(prepped):
        fp = p["job"].fingerprint
        if fp in by_fp:
            uf.join(by_fp[fp], i)
        else:
            by_fp[fp] = i
        if p["url"]:
            if p["url"] in by_url:
                uf.join(by_url[p["url"]], i)
            else:
                by_url[p["url"]] = i

    # Near-duplicates only get compared inside the same employer, which keeps
    # this O(n * small) instead of O(n^2) across the whole feed.
    buckets: dict[str, list[int]] = defaultdict(list)
    for i, p in enumerate(prepped):
        buckets[p["company"]].append(i)

    for _, idxs in buckets.items():
        for a in range(len(idxs)):
            for b in range(a + 1, len(idxs)):
                i, k = idxs[a], idxs[b]
                pi, pk = prepped[i], prepped[k]
                title_close = jaccard(pi["title_tokens"], pk["title_tokens"]) >= TITLE_JACCARD
                body_close = (
                    pi["sim"] and pk["sim"]
                    and hamming(pi["sim"], pk["sim"]) <= SIMHASH_DISTANCE
                )
                if title_close or (body_close and pi["title_tokens"] & pk["title_tokens"]):
                    uf.join(i, k)

    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(len(prepped)):
        groups[uf.find(i)].append(i)

    merged: list[Job] = []
    for _, members in groups.items():
        merged.append(_merge([prepped[i]["job"] for i in members]))

    merged.sort(key=lambda j: (-j.matchScore, j.company.lower(), j.title.lower()))
    return merged, len(jobs) - len(merged)


def _merge(group: list[Job]) -> Job:
    """Keep the richest version, remember every source it came from."""
    if len(group) == 1:
        j = group[0]
        if not j.sources:
            j.sources = [SourceRef(source=j.source or "unknown", url=j.url)]
        return j

    # The listing with the most description text is almost always the fullest one.
    base = max(group, key=lambda j: (len(j.description or ""), len(j.requiredSkills or "")))

    seen: set[tuple[str, str]] = set()
    refs: list[SourceRef] = []
    for j in group:
        for ref in (j.sources or [SourceRef(source=j.source or "unknown", url=j.url)]):
            key = (ref.source, _url_key(ref.url))
            if key not in seen:
                seen.add(key)
                refs.append(ref)
    base.sources = refs

    for j in group:
        if j is base:
            continue
        if base.salaryMin is None and j.salaryMin is not None:
            base.salaryMin, base.salaryMax, base.salaryText = j.salaryMin, j.salaryMax, j.salaryText
        if not base.salaryText and j.salaryText:
            base.salaryText = j.salaryText
        if not base.deadline and j.deadline:
            base.deadline = j.deadline
        if not base.employmentType and j.employmentType:
            base.employmentType = j.employmentType
        if not base.experienceText and j.experienceText:
            base.experienceText = j.experienceText
        if not base.requiredSkills and j.requiredSkills:
            base.requiredSkills = j.requiredSkills
        if not base.area and j.area:
            base.area, base.distanceKm = j.area, j.distanceKm
        if j.postedAt and (not base.postedAt or j.postedAt < base.postedAt):
            base.postedAt = j.postedAt

    base.source = " + ".join(sorted({r.source for r in refs}))
    return base

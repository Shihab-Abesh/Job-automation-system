"""Push notifications: email digest over SMTP, plus a generic webhook.

Both are free. Gmail needs an app password, not your real one. The webhook
posts a plain JSON body, which Discord, Slack and ntfy all accept.
"""
from __future__ import annotations

import json
import logging
import os
import smtplib
import urllib.request
from email.message import EmailMessage
from html import escape
from typing import Any

from .models import Job

log = logging.getLogger("careerpilot.notify")

PRIORITY_ORDER = {"A": 0, "B": 1, "C": 2}


def _at_least(job: Job, min_priority: str) -> bool:
    return PRIORITY_ORDER.get(job.priority, 3) <= PRIORITY_ORDER.get(min_priority, 0)


def select(jobs: list[Job], new_fps: list[str], min_priority: str) -> list[Job]:
    fresh = set(new_fps)
    return [j for j in jobs if j.fingerprint in fresh and _at_least(j, min_priority)]


# --------------------------------------------------------------------------
def _html_digest(jobs: list[Job], dashboard_url: str) -> str:
    rows = []
    for j in jobs:
        where = escape(j.area or j.location)
        if j.distanceKm is not None:
            where += f" &middot; {j.distanceKm} km"
        notes = "<br>".join(escape(n) for n in j.gateNotes[:2])
        rows.append(f"""
        <tr>
          <td style="padding:14px 16px;border-bottom:1px solid #1e293b">
            <div style="font:600 15px system-ui,sans-serif;color:#e2e8f0">{escape(j.title)}</div>
            <div style="font:13px system-ui,sans-serif;color:#67e8f9;margin-top:2px">{escape(j.company)}</div>
            <div style="font:12px system-ui,sans-serif;color:#94a3b8;margin-top:4px">
              {where} &middot; {escape(j.salaryText or 'pay not stated')} &middot; {escape(j.source)}
            </div>
            <div style="font:12px system-ui,sans-serif;color:#fbbf24;margin-top:4px">{notes}</div>
          </td>
          <td style="padding:14px 16px;border-bottom:1px solid #1e293b;text-align:right;vertical-align:top">
            <div style="font:700 22px system-ui,sans-serif;color:#22d3ee">{j.matchScore}%</div>
            <a href="{escape(j.url)}" style="font:12px system-ui,sans-serif;color:#94a3b8">Open posting</a>
          </td>
        </tr>""")

    link = (f'<p style="font:13px system-ui,sans-serif"><a href="{escape(dashboard_url)}" '
            f'style="color:#22d3ee">Review and approve in CareerPilot</a></p>') if dashboard_url else ""

    return f"""<div style="background:#020617;padding:24px">
      <h2 style="font:600 18px system-ui,sans-serif;color:#e2e8f0;margin:0 0 4px">
        {len(jobs)} new {'match' if len(jobs) == 1 else 'matches'}</h2>
      <p style="font:13px system-ui,sans-serif;color:#94a3b8;margin:0 0 16px">
        Nothing has been applied to. Every one of these is waiting on you.</p>
      <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:10px">
        {''.join(rows)}
      </table>
      {link}
    </div>"""


def send_email(jobs: list[Job], cfg: dict[str, Any], dashboard_url: str = "") -> bool:
    if not jobs:
        return False
    host = cfg.get("smtp_host", "smtp.gmail.com")
    port = int(cfg.get("smtp_port", 587))
    user = os.environ.get(cfg.get("user_env", "SMTP_USER"), "")
    password = os.environ.get(cfg.get("password_env", "SMTP_PASSWORD"), "")
    to = cfg.get("to") or user
    if not (user and password and to):
        log.warning("email digest skipped: SMTP_USER / SMTP_PASSWORD / to not all set")
        return False

    msg = EmailMessage()
    top = jobs[0]
    msg["Subject"] = f"CareerPilot: {len(jobs)} new - {top.title} at {top.company}"
    msg["From"] = user
    msg["To"] = to
    msg.set_content("\n".join(f"- {j.summary_line()}\n  {j.url}" for j in jobs))
    msg.add_alternative(_html_digest(jobs, dashboard_url), subtype="html")

    try:
        with smtplib.SMTP(host, port, timeout=30) as s:
            s.starttls()
            s.login(user, password)
            s.send_message(msg)
        log.info("emailed %s new jobs to %s", len(jobs), to)
        return True
    except Exception as exc:
        log.error("email digest failed: %s", exc)
        return False


def send_webhook(jobs: list[Job], cfg: dict[str, Any], dashboard_url: str = "") -> bool:
    if not jobs:
        return False
    url = os.environ.get(cfg.get("url_env", "WEBHOOK_URL"), "")
    if not url:
        log.warning("webhook skipped: %s not set", cfg.get("url_env", "WEBHOOK_URL"))
        return False

    lines = [f"**{len(jobs)} new job {'match' if len(jobs) == 1 else 'matches'}**"]
    for j in jobs[:10]:
        lines.append(f"`{j.matchScore}%` [{j.title} - {j.company}]({j.url})"
                     f" - {j.area or j.location}, {j.salaryText or 'pay not stated'}")
    if dashboard_url:
        lines.append(f"Review: {dashboard_url}")
    body = {
        "content": "\n".join(lines),          # Discord
        "text": "\n".join(lines),             # Slack / ntfy
        "jobs": [j.to_dict() for j in jobs],  # anything custom
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            ok = 200 <= r.status < 300
        log.info("webhook posted (%s)", "ok" if ok else "failed")
        return ok
    except Exception as exc:
        log.error("webhook failed: %s", exc)
        return False

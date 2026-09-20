"""Job-alert email reader (IMAP).

This is the sanctioned route into LinkedIn and Indeed. Both sites block
automated scraping of their search pages, and both will happily email you the
same results if you create a job alert. So instead of fighting their bot
defences, the pipeline reads the alert mail you already receive.

Setup, once:
  1. Create job alerts on LinkedIn / Indeed / Bdjobs for your target titles.
  2. In Gmail, add a filter that labels those senders "CareerPilot".
  3. Create a Gmail app password and put it in the IMAP_PASSWORD secret.

Nothing here reads mail outside that one label.
"""
from __future__ import annotations

import email
import imaplib
import os
import re
from email.header import decode_header, make_header

from bs4 import BeautifulSoup

from ..models import Job
from ..normalize import clean_ws, infer_category, parse_salary, strip_html
from . import register
from .base import Source

LINK_PATTERNS = {
    "LinkedIn": re.compile(r"linkedin\.com/(comm/)?jobs/view/", re.I),
    "Indeed": re.compile(r"indeed\.com/(rc/clk|viewjob|pagead)", re.I),
    "Bdjobs": re.compile(r"bdjobs\.com/.*jobdetail", re.I),
    "Glassdoor": re.compile(r"glassdoor\.[a-z.]+/(job-listing|partner)", re.I),
}

_NOISE = re.compile(
    r"^(view job|apply now|see all jobs|unsubscribe|see more jobs|view all|"
    r"easy apply|be an early applicant|actively recruiting|\d+ new jobs?)$", re.I)


@register
class EmailAlertSource(Source):
    id = "email_alerts"
    label = "Job alert email"
    enabled_by_default = False   # needs credentials, so opt in explicitly

    def collect(self, queries: list[str]) -> list[Job]:
        host = self.config.get("imap_host", "imap.gmail.com")
        user = os.environ.get(self.config.get("user_env", "IMAP_USER"), "")
        password = os.environ.get(self.config.get("password_env", "IMAP_PASSWORD"), "")
        folder = self.config.get("folder", "CareerPilot")
        days = int(self.config.get("lookback_days", 3))

        if not user or not password:
            self.note_error("IMAP_USER / IMAP_PASSWORD not set, skipping email alerts")
            return []

        try:
            box = imaplib.IMAP4_SSL(host)
            box.login(user, password)
        except Exception as exc:
            self.note_error(f"IMAP login failed: {exc}")
            return []

        jobs: list[Job] = []
        try:
            status, _ = box.select(f'"{folder}"', readonly=True)
            if status != "OK":
                self.note_error(f"mailbox '{folder}' not found")
                return []
            since = (email.utils.formatdate(
                email.utils.mktime_tz(email.utils.parsedate_tz(email.utils.formatdate())) - days * 86400
            ))
            since_str = email.utils.parsedate_to_datetime(since).strftime("%d-%b-%Y")
            status, data = box.search(None, f'(SINCE "{since_str}")')
            if status != "OK":
                return []
            ids = data[0].split()[-int(self.config.get("max_messages", 60)):]
            for mid in ids:
                status, raw = box.fetch(mid, "(RFC822)")
                if status != "OK" or not raw or not raw[0]:
                    continue
                jobs.extend(self._parse_message(email.message_from_bytes(raw[0][1])))
        except Exception as exc:
            self.note_error(f"IMAP read failed: {exc}")
        finally:
            try:
                box.logout()
            except Exception:
                pass
        return jobs

    # ------------------------------------------------------------------
    def _parse_message(self, msg) -> list[Job]:
        subject = str(make_header(decode_header(msg.get("Subject", "")))) if msg.get("Subject") else ""
        html = ""
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                try:
                    html = part.get_payload(decode=True).decode(
                        part.get_content_charset() or "utf-8", "ignore")
                    break
                except Exception:
                    continue
        if not html:
            return []

        soup = BeautifulSoup(html, "lxml")
        jobs: list[Job] = []
        seen: set[str] = set()

        for a in soup.find_all("a", href=True):
            href = a["href"]
            board = next((name for name, pat in LINK_PATTERNS.items() if pat.search(href)), None)
            if not board:
                continue
            title = clean_ws(a.get_text(" "))
            if not title or _NOISE.match(title) or len(title) < 4:
                continue
            key = re.sub(r"[?#].*$", "", href)
            if key in seen:
                continue
            seen.add(key)

            company, location = self._context(a)
            blurb = strip_html(str(a.find_parent(["td", "tr", "div"]) or a))[:800]
            lo, hi, stext = parse_salary(blurb)

            jobs.append(self.make_job(
                title=title,
                company=company or "Unknown company",
                description=blurb,
                location=location or "Dhaka, Bangladesh",
                url=href,
                source=f"{board} alert",
                category=infer_category(title, blurb),
                salaryMin=lo, salaryMax=hi, salaryText=stext,
                experienceText=subject[:120],
            ))
        return jobs

    @staticmethod
    def _context(anchor) -> tuple[str, str]:
        """Alert emails stack title / company / location as sibling lines."""
        block = anchor.find_parent(["td", "tr", "div"])
        if not block:
            return "", ""
        lines = [clean_ws(x) for x in block.get_text("\n").split("\n")]
        lines = [x for x in lines if x and not _NOISE.match(x)]
        title = clean_ws(anchor.get_text(" "))
        try:
            i = lines.index(title)
        except ValueError:
            i = -1
        after = lines[i + 1:i + 4] if i >= 0 else lines[:3]
        company = after[0] if after else ""
        location = ""
        for cand in after[1:]:
            if re.search(r"bangladesh|dhaka|remote|hybrid|on-?site|chattogram|sylhet", cand, re.I):
                location = cand
                break
        return company, location

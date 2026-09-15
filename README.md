# CareerPilot BD — Stage 2 backend

The dashboard you built already does the hard part: it holds your real profile
and tailors a truthful, ATS-readable CV for a job you paste in. What it cannot
do from GitHub Pages is go and find the jobs, remember what it found, or tell
you when something good appears.

That is what this adds. It runs on GitHub Actions, costs nothing, stores no
credentials in the repo, and it never applies to anything on your behalf.

```
  ┌──────────────────────── runs on a schedule, free ─────────────────────────┐
  │  Bdjobs      job-alert emails      RSS feeds      careers pages   inbox/  │
  │      └────────────┴──────────┬─────────┴───────────────┴────────────┘     │
  │                     normalise, geocode, parse pay                         │
  │                              ▼                                            │
  │                   deduplicate across boards                               │
  │                              ▼                                            │
  │             score against your profile, apply your rules                  │
  │                              ▼                                            │
  │            data/jobs.json  +  email or webhook if anything is strong      │
  └───────────────────────────────┬───────────────────────────────────────────┘
                                  ▼
                 review.html   →   you approve or pass
                                  ▼
                 index.html    →   tailored CV, tracker
```

Nothing moves past the approval step without you.

---

## Two ways to run this

**On your own laptop.** No account, no hosting, nothing public. Install Python,
run `start.bat` on Windows or `./start.sh` elsewhere, and it finds jobs and
opens the queue. Windows Task Scheduler or cron handles the twice-daily run.
Full steps in **[LOCAL.md](LOCAL.md)**. This is the simplest version and the
one to start with.

**On GitHub, free and always on.** Discovery runs whether your laptop is open
or not. The section below covers it.

---

## Running this on GitHub Pages

Yes, this works, but only because two different GitHub products are doing two
different jobs in the same repo:

| | What it does | Can it run Python? |
|---|---|---|
| **GitHub Pages** | serves `index.html`, `review.html`, `data/jobs.json` | no, static files only |
| **GitHub Actions** | runs the pipeline on a schedule and commits the feed | yes |

Pages never runs the backend. Actions does, writes `data/jobs.json` into the
repo, and Pages then serves that file like any other static asset. Your pages
already fetch it at load time, so nothing else has to change.

Three things about this setup that will otherwise catch you out.

**Pages source must be "GitHub Actions", not "Deploy from a branch."**
A commit pushed by a workflow using the default token does not trigger a Pages
build, so with branch deployment the site would quietly keep serving
yesterday's feed. The discovery workflow therefore publishes to Pages itself,
and `pages.yml` publishes the changes you push by hand. Set it once:
Settings → Pages → Source → **GitHub Actions**.

**The repo has to be public.** On the free plan, Pages only works from a
public repository. Private Pages needs Pro or higher. Two consequences:

- Actions minutes are unlimited on public repos, so the schedule costs nothing.
- Everything committed is readable by anyone, including search engines.

**So nothing personal is committed.** This is handled already:

- `config/profile.json` has your skills, experience, projects and preferences,
  and no name, phone, email or links. Scoring never needed them.
- `index.html` ships with the contact fields blank. Fill them in once under
  Master Profile; the dashboard keeps them in your browser's localStorage,
  which is not part of the repo.
- `state/ledger.json` stores fingerprints, dates and statuses only. Not the
  titles or companies of jobs you passed on.
- The digest address comes from the `SMTP_USER` secret, not from a config file.
- For the bookmarklet, copy `config/profile.local.example.json` to
  `config/profile.local.json` and fill it in. It is gitignored and stays on
  your machine.

Secrets are safe either way. They live in Actions settings, are never written
into the repo, and Pages has no access to them.

**If you would rather keep the repo private,** the pipeline runs unchanged on
Cloudflare Pages or Vercel, both free, both happy to serve a site from a
private repo. Point the build at the repo root and keep the discovery workflow
on GitHub Actions, or move it to that platform's scheduled functions.

## Setup in ten minutes

**1. Put the files in your Pages repo**

```
index.html            your existing dashboard, plus one script tag
review.html           the approval queue
review.css
review.js
feed-sync.js
.nojekyll
backend/              the pipeline
config/               what to search for, and your profile
tools/                form-filling helpers
.github/workflows/    the schedule
data/jobs.json        written by the workflow
```

See `web/INTEGRATION.md` for the one line you add to `index.html`.

**2. Export your profile**

Dashboard → Master Profile → Export profile, then delete the `personal` block
before saving it as `config/profile.json` and committing it. Scoring only reads
skills, experience, projects and preferences, and the repo is public. The backend scores jobs with the same profile and the same
formula the dashboard uses, so the number in your email is the number on
screen.

**3. Add secrets**

Settings → Secrets and variables → Actions:

| Secret | What it is | Needed for |
|---|---|---|
| `SMTP_USER` | your Gmail address | the email digest |
| `SMTP_PASSWORD` | a Gmail **app password**, not your login | the email digest |
| `IMAP_USER` / `IMAP_PASSWORD` | same account, for reading job alerts | LinkedIn and Indeed |
| `WEBHOOK_URL` | a Discord or ntfy webhook | phone push, optional |

The digest is sent to `SMTP_USER` unless you set `notify.email.to`, which keeps
your address out of a public config file.

An app password is free and revocable: Google Account → Security →
2-Step Verification → App passwords.

**4. Run it**

Actions → Discover jobs → Run workflow. After that it runs itself at 9am and
5pm Dhaka time. Locally:

```bash
pip install -r requirements.txt
python -m backend.pipeline run --dry-run    # prints results, writes nothing
python -m backend.pipeline run
python -m backend.pipeline stats
```

**5. Delete the sample data**

`fixtures/sample-jobs.json` exists so the review page has something to show
before your first real run. Remove it once Bdjobs is returning results.

---

## About LinkedIn and Indeed

Both block automated access to their search pages, in robots.txt and in their
terms, and both are good at detecting it. A scraper pointed at them works for
about a week and then starts returning empty pages or CAPTCHAs, usually
without telling you it has stopped working. The fetcher here reads robots.txt
before every request and skips anything disallowed, so it will not even try.

Both will email you the same results if you ask. That route is reliable,
allowed, and takes five minutes to set up:

1. Create job alerts on LinkedIn and Indeed for your target titles, set to daily.
2. In Gmail, make a filter: from `linkedin.com` or `indeed.com`, subject
   contains "job", apply label **CareerPilot**.
3. Set `IMAP_USER` and `IMAP_PASSWORD`, then flip `email_alerts.enabled` to
   `true` in `config/sources.yml`.

The pipeline reads only that label, pulls the job cards out of the mail, and
they flow through the same dedupe and scoring as everything else. A LinkedIn
posting and the Bdjobs version of the same job merge into one row.

Bdjobs is the one board this scrapes directly, politely: robots.txt respected,
one request every four seconds, cached and revalidated between runs so a
re-run costs the site almost nothing.

---

## How duplicates get caught

Same job, three boards, three spellings. The merge works in layers:

1. **Fingerprint.** `sha1(normalised company | normalised title | area)`.
   `Innolytic I.T. Ltd.` and `Innolytic IT Limited` normalise to `innolytic`.
   `Junior SQA Engineer` and `Software Quality Assurance Engineer` both expand
   to `software quality assurance engineer`.
2. **URL.** Tracking parameters are stripped, real ones are kept. This matters
   on Bdjobs, where the job id lives in the query string.
3. **Near match.** Inside one employer, titles are compared by token overlap
   and descriptions by simhash. Close enough, and they merge.

The surviving record is the one with the fullest description, and it keeps a
list of every place it was seen. On the sample data, seven postings collapse
to six, and the merged row carries both its Bdjobs and its LinkedIn link.

---

## Your rules, and what they do

From `config/search.yml`:

```yaml
filters:
  min_salary_bdt: 20000
  max_distance_km: 10       # from Tejgaon
```

A job that fails one of these is **demoted, never deleted**. It drops to
priority C with a note saying why, and stays in the feed where you can see it:

> Starts at Tk 15,000, below your Tk 20,000 floor.
> Gazipur is about 26.4 km out, past your 10 km limit.

Deleting would be worse. Plenty of postings say "Negotiable" and pay fine, and
a job that lists no area is often perfectly close. Those get a note too, not a
silent drop.

Priority A means strong match and no rule broken. B means worth a look. C means
read the note first.

---

## The approval queue

`review.html` is plain HTML and CSS with no React, no Babel and no CDN, so it
opens instantly on a phone. It shares `localStorage` with the dashboard, so a
decision made in one shows up in the other.

Keyboard only, for clearing a morning's queue fast:

| Key | What it does |
|---|---|
| `J` / `K` | next, previous |
| `A` | approve, ready to apply |
| `S` | save for later |
| `X` | pass |
| `O` | open the posting |

Passing a job also stops it being announced as new on the next run.

---

## Filling in application forms

```bash
python tools/make_bookmarklet.py > bookmarklet.txt
```

Paste that into a new browser bookmark. On any application form, click it, and
name, email, phone, university, degree and CGPA get filled from your profile.
Fields it does not recognise are left alone, and it tells you how many it
filled so you know what to check.

It leaves expected salary, notice period and cover letter blank on purpose.
Those change per application, and a generated answer is how a CV ends up
saying something you did not mean.

There is also `tools/apply_assist.py`, a Playwright version, which only opens
jobs you have already marked "Awaiting Approval". Neither tool clicks submit.
That is not a missing feature. Auto-submitting breaks the terms of every board
worth applying through, and a recruiter who spots a bot-filled form bins the
application. The two minutes of retyping is what is worth automating; the
click at the end is not.

---

## When a scraper breaks

It will. Job boards redesign. Bdjobs selectors live in `config/sources.yml`,
not in Python, and there is a command that tells you what to put there:

```bash
python -m backend.pipeline probe --source bdjobs --query "quality assurance"
```

It prints how many job links the page has and which CSS classes wrap them,
most common first. Paste the winner into `selectors.card` and you are done.
If robots.txt has changed to disallow the path, it says so and stops.

The list parser also has a fallback: if no selector matches, it looks for any
link containing `jobdetail` and works from there. Thinner metadata, but the
feed keeps flowing while you fix the selectors.

---

## Files

| Path | What it does |
|---|---|
| `backend/pipeline.py` | orchestration and CLI |
| `backend/sources/` | one file per source, all optional |
| `backend/normalize.py` | company and title cleanup, BDT salary parsing, category inference |
| `backend/geo.py` | Dhaka area lookup and distance, offline, no API key |
| `backend/dedupe.py` | fingerprint, URL and near-match merging |
| `backend/scoring.py` | port of `analyzeJob()` from `index.html`, plus your rules |
| `backend/store.py` | the feed and the ledger of what you have already decided |
| `backend/notify.py` | SMTP digest and webhook |
| `web/` | approval queue and the sync shim for the dashboard |
| `tools/` | form-filling helpers |
| `tests/` | 27 tests, run with `pytest -q` |

---

## What this deliberately does not do

- **Apply for you.** Every path ends at a form you submit yourself.
- **Write claims you cannot back up.** Tailoring reorders and reweights what is
  in your profile. It does not add skills.
- **Scrape sites that say no.** robots.txt is checked before every request and
  `respect_robots` is on by default. Turning it off is your call and your risk.
- **Cost anything.** Actions minutes on a public repo, Gmail, GitHub Pages.

## What to build next

The tailoring engine still runs in the browser, which is the right place for
it while it is rule-based. If you want an LLM to draft the cover letter or
rewrite bullets per posting, that needs an API key, which means a small
serverless function on Vercel or Cloudflare Workers rather than Pages. The
pipeline already produces everything such a function would need: the job text,
your profile, and the list of keywords the posting uses that your CV does not.

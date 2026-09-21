# CareerPilot BD — Stage 2 backend

The dashboard you built already does the hard part: it holds your real profile
and tailors a truthful, ATS-readable CV for a job you paste in. What it cannot
do from GitHub Pages is go and find the jobs, remember what it found, or tell
you when something good appears.

That is what this adds. It runs on GitHub Actions, costs nothing, stores no
credentials in the repo, and it never applies to anything on your behalf.

```
  ┌──────────────────────── runs on a schedule, free ─────────────────────────┐
  │  Job boards  job-alert emails      RSS feeds      careers pages   inbox/  │
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
scoring.js            the match score, loaded by index.html
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

**3. Notifications (works with no secrets)**

Each run that finds new matches (priority B or better) opens **one issue** in your
repository listing them, and GitHub notifies you by email and in the mobile app
because the issue @mentions you. There is nothing to set up. If a source stops
working (a site changes or starts blocking automated requests), it opens a
`source-problem` issue after four runs in a row, once, instead of the feed quietly
getting thinner. Both are under `notify.github_issue` in `config/search.yml`.

Issues on a public repository are public. They list public job postings only, never
your decisions about them. Set `enabled: false` if you would rather they did not.

**Optional: email and phone push.** Settings → Secrets and variables → Actions:

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

**5. Ignore `fixtures/`**

`fixtures/sample-jobs.json` is fake sample data (made-up companies and links) that
only the offline tests read. Live runs do not read it.

---

## Where the jobs come from

Every source is optional and switched on in `config/sources.yml`. All of them go
through the same polite fetcher (robots.txt checked, one request at a time,
cached between runs) and then the same dedupe and scoring.

| Source | How it is read | Status |
|---|---|---|
| **BDRecruit** (bdrecruit.net) | its public WordPress API: the whole board in two requests | on, about 130 postings |
| **BD Tech Jobs** (bdtechjobs.com) | schema.org `JobPosting` data on its homepage | on, a handful of fresh postings per run |
| RSS feeds | any feed you list | on (We Work Remotely; RemoteOK's feed no longer exists) |
| Company careers pages | the pages you list | on (Brain Station 23, Selise) |
| Job-alert email | a Gmail label | off until you add credentials |
| Bdjobs | selector scraping | **off**: it sits behind Cloudflare bot protection and answers automated requests with an empty page |

Your search is not QA-only. The queries in `config/search.yml` cover software and
CSE roles, MIS and information systems, management trainee (MTO) and MBA-style
business roles, with QA as one area among several. A posting from a general board
is kept when every word of one query appears in its title (so `management
trainee` finds "Management Trainee Officer (MTO)", and `data analyst` also finds
"Junior Data Analyst"). Set `relevance: all` on a source to keep everything.

### Adding another board

Look for schema.org markup. Open a listing page, view the source, and search for
`application/ld+json` and `"JobPosting"`. If the page has them, no code is needed:
add an entry under `jsonld.sites` in `config/sources.yml`.

```yaml
      - label: "Some Board"
        url: "https://example.com/jobs?search={query}"   # {query} = one request per search query; omit it to fetch the page once
        location: "Dhaka, Bangladesh"
        max_age_days: 45        # skip postings older than this (some boards never remove old ones)
        ignore_deadline: false  # true if the board stamps every posting with the same expiry date
```

A posting that has no URL of its own is skipped, because a link that does not lead
to that job is worse than no job. If the site is WordPress, try
`/wp-json/wp/v2/job_listing` (see `backend/sources/bdrecruit.py`); check that
`robots.txt` allows it first.

### What was checked and left out (September 2026)

Twenty-two Bangladeshi sites were tested with the same honest User-Agent this
project uses, plus about forty employer names against the public Greenhouse, Lever,
Workable, Recruitee and Ashby APIs (none of them publish there).

- **Blocked:** Bdjobs (Cloudflare bot wall).
- **Down or unreachable:** chakri.com (HTTP 523), jobscircular.net, allbdjobs.com,
  jobs.prothomalo.com, recruitingbasket.com (a stub page).
- **Reachable, but no structured data.** Reading them would mean scraping markup,
  which is exactly what broke Bdjobs: skill.jobs, shomvob.com, nextjobz.com.bd,
  job.com.bd, techntalents.com, careerjet.com.bd (an aggregator with its own API terms).
- **QA-only, and job links cannot be verified:** roadtocareer.net (every
  `/jobs/<anything>` returns the same page).
- **Not real job pages:** bdgovtjobs.com, ejobscircular.com, circularbd.com and
  bengalinformer.com republish "Job Circular 2026" articles that link back to
  themselves, not to the employer. jobsbd.works has no job API, onlinejobbd.com's feed
  is seven weeks stale, and bdjobslive.com is not Bdjobs.

### The Manual Sites tab

Everything above that the system cannot read for you is listed in the dashboard's
**Manual Sites** tab, so you can check those boards by hand. Each card says what the
site is good for and, honestly, why it is not automatic. Bdjobs, LinkedIn and Indeed
also get a **Search** button: pick a target title at the top and the button opens that
site's own search for it. Tick **Mark checked today** and the card remembers, showing
"Last checked ... (N days ago)" until you look again. Ticks live in your browser only.

The list is `config/manual_sites.json`. To add a site, add an entry (`id`, `group`,
`name`, `url`, `why`, `note`, and optionally `searchUrl` with `{query}` where the title
goes); to drop one, delete its entry. Only links that work belong there: the sites
above that were down or unreachable (chakri.com excepted, which may recover) were left
out on purpose. `tests/test_manual_sites.py` keeps the file well formed and makes sure
a site is never listed as manual while a source is fetching it automatically.

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
posting and the BDRecruit version of the same job merge into one row.

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

## How the match score works

Every job gets a score out of 100, the same number in the dashboard and in the
notification (`scoring.js` and `backend/scoring.py` are the same maths, and
`tests/test_parity.py` fails if they ever disagree).

| Part | Weight | What it asks |
|---|---|---|
| Title fit | 40% | How much of one of your target titles does the job title cover? |
| Level fit | 25% | Does the job suit your experience? Trainee, junior or 0-1 years is full marks; senior, lead, manager or 5+ years is nearly none. |
| Skills | 25% | How many of your listed skills does the posting mention? Six or more is full marks. |
| Preference | 10% | Is the job's category one you have switched on? |

Set `preferences.experienceYears` in `config/profile.json` (default 0, a fresher) and
the level part moves with it. A management-trainee role with no tech keywords still
scores well, because it is exactly the kind of job you are looking for; a senior
engineer role scores poorly however many skills it mentions.

The earlier formula scored nearly every job 53-56, because three of its four parts
were the same for almost every job. If a percentage cannot tell a good match from
a poor one it is decoration.

## Recruiter keywords: you decide, per job

Open any job's resume and the **Recruiter Keywords** panel lists the terms that job post
screens for. Nothing is on the resume until you decide: every keyword has an **Add** and a
**Not add** button. Add puts it on that job's resume; Not add keeps it off. Paste a fuller post
into the box at the bottom of the panel (or into **Add Job**, where a live preview appears as
you paste) and everything re-reads. It runs in your browser, with no account, and nothing
is sent anywhere.

**Any job, any field.** Nothing here is tied to your profile or to tech. Add Job accepts any
category (choose **Other**), and the reader works from the post itself:

- `keywords.js` holds about 550 skills across software, testing, IT, MIS and data, business,
  banking, legal, engineering and maintenance, factory work, NGO, HR, sales, media, health
  and education, plus soft skills and degrees, each with the ways people really write it
  ("MS Excel", "Microsoft Excel", "Advanced Excel").
- No list can hold every field, so the rest is read from the post: runs of meaningful words
  between stop words and punctuation ("wound care", "preventive maintenance", "dispute
  resolution"), kept only when the post signals they matter (they repeat, follow "experience
  with", or are a short requirement line). Those are marked with a `*`. A nursing, legal or
  factory post gives its own terms, not tech ones.
- Company blurbs, benefits, place names, job titles, the company's own name and
  equal-opportunity boilerplate are ignored.

**Which ones matter.** The post's headings decide the tier: **must-have** (under Requirements,
near "must" or "required", or in the job title), **important** (in the duties), **nice to have**
("preferred", "a plus").

**Your profile is shown, never decisive.** Under each keyword a note says whether your own
profile backs it: *In your profile* (you list it as a skill, a project's tech or a job title),
*Only in your experience text* (a sentence mentions it but no skill line does) or *Not in your
profile*. That is information for you, not a rule: press Add for what is true and useful. If you
add something your profile does not back, the card reminds you to keep it only if it is true,
because a resume that claims JIRA or Selenium you have never used gets you an interview you
then fail. Degrees are shown but never added; your Education section already carries them.

**What the resume gets.** Exactly the keywords you pressed Add for, as the first row of Core Skills
(**Key Skills**), in the post's own wording, because an ATS matches strings ("Test Cases" does not
find "Test Case Design"). It appears in the preview, PDF, DOCX and TXT. Bullets and projects that
use the post's keywords move to the top. Shortcuts: **Add all in my profile**, **Add all
must-haves**, **Clear all choices**. Choices are saved on that job, so every job has its own
tailored resume, and they survive reloads and feed updates.

**Jobs outside your fields.** A job that fits none of the fixed resume strategies gets the **General
Resume (any field)**: the headline is the job title and the summary is built only from your profile
(degree, internship, institution), the job title and the keywords you added. It never borrows another
field's summary.

**The numbers.** *Resume keyword match* counts a keyword only when the resume uses the post's exact
wording, and shows it before and after your additions. It is a simple-ATS estimate, not any employer's
real score, and it leaves degrees out.

## Your rules, and what they do

From `config/search.yml` and `config/profile.json`:

```yaml
filters:
  min_salary_bdt: 20000
  max_distance_km: 10       # from Tejgaon
  allow_abroad: false       # a posting based in another country is demoted unless it is remote
```

A job that fails one of these is **demoted, never deleted**. It drops to
priority C with a note saying why, and stays in the feed where you can see it:

> Starts at Tk 15,000, below your Tk 20,000 floor.
> Gazipur is about 26.4 km out, past your 10 km limit.
> Based in United Kingdom, outside Bangladesh.
> Title matches your excluded list (Senior).

Deleting would be worse. Plenty of postings say "Negotiable" and pay fine, and
a job that lists no area is often perfectly close. Those get a note too, not a
silent drop. The excluded-title list matches whole words, so `Lead` demotes "Team
Lead" but not "Leadership Trainee Program".

**Priority A** is a score of `strongMatch` or more (75) with no rule broken.
**B** is `minimumMatch` (60) or more. **C** is anything below that, or anything a
rule demoted: read the note first. Both bars are in `preferences` in
`config/profile.json`.

The dashboard's job list can be filtered by category, source and priority, and
sorted by best match, priority, newest or soonest deadline. Each card shows where
the job came from, the pay, the deadline, why it was demoted if it was, and a
link to the real posting.

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

It will. Job boards redesign. That is why BDRecruit and the JSON-LD boards are
read from structured data rather than markup: they have nothing to break. Bdjobs
is the one that does, and it is switched off (see above). Its selectors live in
`config/sources.yml`, not in Python, and if it is ever worth turning back on there
is a command that tells you what to put there:

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
| `backend/sources/` | one file per source, all optional (`bdrecruit.py`, `jsonld_jobs.py`, `rss_feed.py`, ...) |
| `backend/normalize.py` | company and title cleanup, BDT salary parsing, category inference |
| `backend/geo.py` | Dhaka area lookup and distance, offline, no API key |
| `backend/dedupe.py` | fingerprint, URL and near-match merging |
| `backend/scoring.py`, `scoring.js` | the match score (same maths in both languages, tested against each other) and your rules |
| `backend/health.py` | notices a source that has quietly stopped returning jobs |
| `keywords.js` | reads a job post for recruiter keywords in any field; you choose which go on the resume (runs in the browser, tested under Node) |
| `config/manual_sites.json` | the boards you check by hand, shown in the dashboard's Manual Sites tab |
| `backend/store.py` | the feed and the ledger of what you have already decided |
| `backend/notify.py` | GitHub issue, SMTP digest and webhook |
| `web/` | approval queue and the sync shim for the dashboard |
| `tools/` | form-filling helpers |
| `tests/` | 180+ tests, run with `pytest -q` (`tests/js/` holds the ones for the browser code, run by Node) |

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

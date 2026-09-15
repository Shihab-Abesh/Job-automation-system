# Running without GitHub

GitHub was only ever doing two things: running Python on a schedule, and
serving some static files. Your own laptop does both, for free, with no
account. This is the simplest version of the whole system.

The trade is honest: discovery only happens while the laptop is on. Since you
are checking the queue in the morning and evening anyway, that is usually
fine.

---

## Windows

**1. Install Python**

Get it from [python.org](https://www.python.org/downloads/). During setup,
tick **Add python.exe to PATH**. That one checkbox saves an hour later.

**2. Install what it needs**

Open the project folder, type `cmd` in the address bar, press Enter, then:

```
pip install -r requirements.txt
```

**3. Run it**

Double-click **`start.bat`**.

It looks for jobs, then opens the approval queue in your browser. Leave the
black window open while you use it, and close it when you are done.

That is the whole setup. Everything else below is optional.

---

## Mac and Linux

```bash
pip3 install -r requirements.txt
./start.sh
```

---

## Reviewing on your phone

The queue is built for fast triage on a small screen, so it is worth having
there. On the same wifi as the laptop:

```
start.bat --lan
```

It prints an address like `http://192.168.0.104:8000/review.html`. Open that
on your Android. Your decisions are stored in the phone's browser, so use one
device or the other for a given session rather than both at once.

---

## Making it run on its own

**Windows.** Open Command Prompt as administrator, in the project folder:

```
schtasks /create /tn "CareerPilot" /tr "%CD%\discover.bat" /sc daily /st 09:00
schtasks /create /tn "CareerPilot evening" /tr "%CD%\discover.bat" /sc daily /st 17:00
```

`discover.bat` finds jobs quietly in the background and writes to
`state\run.log`. No browser, no window. When you next open `start.bat --serve`,
everything it found is waiting.

To check it, change it or remove it, search the Start menu for Task Scheduler.
Or from the command line:

```
schtasks /run /tn "CareerPilot"
schtasks /delete /tn "CareerPilot" /f
```

**Mac and Linux.** `crontab -e`, then:

```
0 9,17 * * * cd /full/path/to/careerpilot-bd && python3 -m backend.pipeline run >> state/run.log 2>&1
```

---

## Email and push notifications

These work the same locally, they just read credentials from a file instead of
GitHub Secrets.

Copy `.env.example` to `.env` and fill in your Gmail address and an **app
password**, which is a separate 16-character password you generate at
Google Account → Security → 2-Step Verification → App passwords. Never your
real password.

```
SMTP_USER=you@gmail.com
SMTP_PASSWORD=abcd efgh ijkl mnop
```

`.env` is gitignored and is read only by the pipeline on this machine.

The same file turns on LinkedIn and Indeed alert reading: add `IMAP_USER` and
`IMAP_PASSWORD`, then set `email_alerts.enabled: true` in
`config/sources.yml`.

---

## One thing to undo

The version in this folder was set up for a public GitHub repo, so contact
details were stripped out of it. Running locally, nothing is public, so put
them back:

- Open the dashboard once (`start.bat --page index.html`), go to Master
  Profile, and fill in your name, email, phone and links. They save to your
  browser and stay there.
- For the form-filling bookmarklet, copy `config/profile.local.example.json`
  to `config/profile.local.json` and fill it in, then run
  `python tools/make_bookmarklet.py > bookmarklet.txt`.

---

## If you want it online, just not on GitHub

Two separate questions, and you can mix and match.

**Where the site lives.** Netlify, Cloudflare Pages and Vercel all host a
static folder free, and Netlify lets you drag the folder onto the page without
connecting a repository at all. Any of them will serve `index.html`,
`review.html` and `data/jobs.json` exactly as Pages did. You would upload
again after each discovery run, or point them at a repo somewhere.

**Where the pipeline runs.** GitLab is the closest drop-in: free CI minutes,
scheduled pipelines, and GitLab Pages, so the whole setup transfers with one
new config file instead of `.github/workflows/`. Beyond that, an always-free
cloud VM or a cheap VPS runs the same cron line as the Mac and Linux section
above.

Free-tier limits on all of these change often, so check the current numbers
before you commit to one. Two runs a day of this pipeline is roughly four
minutes of compute per day, which fits inside every free tier I know of.

Ask me if you want the GitLab config written out. It is a short file and the
Python does not change at all.

---

## When something does not work

**The queue is empty and says it could not load data/jobs.json.**
You opened `review.html` by double-clicking it. Browsers block a `file://`
page from reading a local JSON file. Use `start.bat` instead, which serves it
over `http://localhost`.

**"py is not recognised" or "python is not recognised".**
Python is not on PATH. Reinstall it and tick the PATH checkbox, or use the
full path to `python.exe` in `start.bat`.

**Discovery finds nothing.**
Normal on the first run if the Bdjobs selectors are stale. Run:

```
py -3 -m backend.pipeline probe --source bdjobs --query "quality assurance"
```

It prints the CSS classes the page is actually using. Paste the most common
one into `selectors.card` in `config/sources.yml`.

**Nothing happened at 9am.**
Check `state\run.log`. If it is empty, the scheduled task is not firing; open
Task Scheduler and look at Last Run Result for the CareerPilot task.

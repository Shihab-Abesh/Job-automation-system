# Wiring Stage 2 into the interface you already have

Your `index.html` does not need to be rewritten. Three small changes connect it
to the backend.

## 1. Pull the feed in automatically

Copy `feed-sync.js` next to `index.html`, then add one line just above the
React script tags:

```html
<script src="feed-sync.js"></script>
<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
```

Discovered jobs now appear in Job Analysis and Tracker like any job you added
by hand. Statuses you have already set are kept.

## 2. Add a link to the approval queue

In the `nav` array inside `App()`, the tabs are defined as:

```js
const nav=[["dashboard","Dashboard"],["profile","Master Profile"], ...];
```

Leave that alone and put a plain link in the header instead:

```html
<a href="review.html">Approval queue</a>
```

The queue is a separate HTML page on purpose. It loads in a fraction of the
time because it has no React, no Babel and no CDN, which matters when you are
triaging on a phone.

## 3. Keep the profile in one place

The backend scores jobs with the same profile the dashboard uses. Export it
once from Master Profile and commit it:

```
config/profile.json
```

Re-export whenever you change your skills, titles or excluded roles. The
scoring formula in `backend/scoring.py` is a direct port of `analyzeJob()` in
`index.html`, so the number in the email is the number on the dashboard.

## Where files go in the repo

```
index.html          your dashboard, unchanged apart from the one script tag
review.html         approval queue
review.css
review.js
feed-sync.js
data/jobs.json      written by the workflow, read by both pages
.nojekyll
```

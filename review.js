/* CareerPilot BD - approval queue.
 *
 * Reads data/jobs.json produced by the backend, merges it with whatever the
 * React dashboard already has in localStorage, and writes decisions back to
 * the same key. Same origin, same storage, so the two pages stay in step.
 */

const JOB_KEY = "careerpilot_bd_v2_jobs";
const DECISION_KEY = "careerpilot_bd_v2_decisions";
const FEED_URL = "data/jobs.json";

const state = {
  jobs: [],
  filter: "pending",
  search: "",
  cursor: 0,
  generatedAt: null,
};

const $ = (sel) => document.querySelector(sel);
const PENDING = "Awaiting Review";

/* ----------------------------------------------------------- persistence */

function readStored() {
  try {
    return JSON.parse(localStorage.getItem(JOB_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeStored(jobs) {
  localStorage.setItem(JOB_KEY, JSON.stringify(jobs));
}

function readDecisions() {
  try {
    return JSON.parse(localStorage.getItem(DECISION_KEY) || "{}");
  } catch {
    return {};
  }
}

function recordDecision(job, status) {
  const all = readDecisions();
  all[job.fingerprint] = {
    fingerprint: job.fingerprint,
    status,
    title: job.title,
    company: job.company,
    decidedAt: new Date().toISOString(),
  };
  localStorage.setItem(DECISION_KEY, JSON.stringify(all));
}

/* Merge the feed into local storage without clobbering decisions already
 * made in either page. Feed wins on job content, local wins on status. */
function merge(feedJobs) {
  const stored = readStored();
  const byFingerprint = new Map();
  const loose = [];

  for (const j of stored) {
    if (j.fingerprint) byFingerprint.set(j.fingerprint, j);
    else loose.push(j);
  }

  const decisions = readDecisions();
  const merged = feedJobs.map((incoming) => {
    const existing = byFingerprint.get(incoming.fingerprint);
    const decided = decisions[incoming.fingerprint];
    byFingerprint.delete(incoming.fingerprint);
    return {
      ...incoming,
      id: existing?.id || incoming.id,
      status: decided?.status || existing?.status || incoming.status || PENDING,
      selectedStrategy: existing?.selectedStrategy,
    };
  });

  // Jobs you added by hand in the dashboard stay put.
  return merged.concat([...byFingerprint.values()], loose);
}

/* ------------------------------------------------------------------ view */

function visible() {
  const q = state.search.trim().toLowerCase();
  return state.jobs.filter((j) => {
    if (state.filter === "pending" && j.status !== PENDING) return false;
    if (state.filter === "A" && j.priority !== "A") return false;
    if (state.filter === "flagged" && !(j.gateNotes || []).length) return false;
    if (!q) return true;
    return [j.title, j.company, j.area, j.location, j.category]
      .join(" ").toLowerCase().includes(q);
  });
}

function factLine(job) {
  const bits = [];
  if (job.category) bits.push(job.category);
  if (job.area || job.location) {
    bits.push(job.distanceKm != null
      ? `${job.area || job.location}, ${job.distanceKm} km away`
      : (job.area || job.location));
  }
  bits.push(job.salaryText || "pay not stated");
  if (job.deadline) bits.push(`closes ${job.deadline}`);
  if (job.source) bits.push(`found on ${job.source}`);
  return bits;
}

function render() {
  const rows = visible();
  const queue = $("#queue");
  const tpl = $("#rowTpl");
  queue.textContent = "";

  const pending = state.jobs.filter((j) => j.status === PENDING).length;
  $("#waitingCount").textContent = pending;
  $("#waitingLabel").textContent =
    pending === 1 ? "job waiting on your decision" : "jobs waiting on your decision";
  $("#empty").hidden = rows.length > 0;

  state.cursor = Math.min(state.cursor, Math.max(0, rows.length - 1));

  rows.forEach((job, i) => {
    const node = tpl.content.cloneNode(true);
    const li = node.querySelector(".row");
    li.dataset.priority = job.priority || "C";
    li.dataset.fingerprint = job.fingerprint;
    if (i === state.cursor) li.classList.add("is-current");
    if (job.status !== PENDING) li.classList.add("is-done");

    const score = Math.max(0, Math.min(100, job.matchScore || 0));
    node.querySelector(".gate-score").textContent = score;
    node.querySelector(".gate-fill").style.height = `${Math.max(8, score * 0.62)}px`;

    node.querySelector(".title").textContent = job.title;
    node.querySelector(".org").textContent = job.company;

    const facts = node.querySelector(".facts");
    factLine(job).forEach((bit) => {
      const s = document.createElement("span");
      s.textContent = bit;
      facts.append(s);
    });

    node.querySelector(".flags").textContent = (job.gateNotes || []).join(". ");
    node.querySelector(".skills").textContent = job.requiredSkills
      ? `Words in the posting you do not have on your CV: ${job.requiredSkills}`
      : "";

    const link = node.querySelector(".open");
    link.href = job.url || "#";
    if (!job.url) link.remove();

    node.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => decide(job, btn.dataset.act));
    });
    li.addEventListener("focus", () => {
      state.cursor = i;
      highlight();
    });

    queue.append(node);
  });
}

function highlight() {
  document.querySelectorAll(".row").forEach((row, i) => {
    row.classList.toggle("is-current", i === state.cursor);
  });
}

function flash(message) {
  const el = $("#status");
  el.textContent = message;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => (el.textContent = ""), 2600);
}

/* ------------------------------------------------------------- decisions */

function decide(job, status) {
  job.status = status;
  recordDecision(job, status);
  writeStored(state.jobs);
  const verb = { "Awaiting Approval": "Approved", Saved: "Saved", Rejected: "Passed" }[status];
  flash(`${verb}: ${job.title}`);
  render();
}

function currentJob() {
  const rows = visible();
  return rows[state.cursor];
}

function move(delta) {
  const rows = visible();
  if (!rows.length) return;
  state.cursor = (state.cursor + delta + rows.length) % rows.length;
  highlight();
  document.querySelectorAll(".row")[state.cursor]
    ?.scrollIntoView({ block: "nearest" });
}

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  const job = currentJob();
  const keys = {
    j: () => move(1),
    k: () => move(-1),
    a: () => job && decide(job, "Awaiting Approval"),
    s: () => job && decide(job, "Saved"),
    x: () => job && decide(job, "Rejected"),
    o: () => job?.url && window.open(job.url, "_blank", "noopener"),
  };
  const fn = keys[e.key.toLowerCase()];
  if (fn) {
    e.preventDefault();
    fn();
  }
});

/* ----------------------------------------------------------------- setup */

$("#filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-on", c === btn));
  state.filter = btn.dataset.filter;
  state.cursor = 0;
  render();
});

$("#search").addEventListener("input", (e) => {
  state.search = e.target.value;
  state.cursor = 0;
  render();
});

$("#exportBtn").addEventListener("click", () => {
  const decisions = Object.values(readDecisions());
  if (!decisions.length) return flash("No decisions to export yet");
  const blob = new Blob([JSON.stringify({ decisions }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "decisions.json";
  a.click();
  URL.revokeObjectURL(a.href);
  flash(`Exported ${decisions.length} decisions`);
});

$("#syncBtn").addEventListener("click", () => {
  writeStored(state.jobs);
  flash("Dashboard updated. Reload it to see the changes.");
});

async function boot() {
  try {
    const res = await fetch(`${FEED_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`feed returned ${res.status}`);
    const data = await res.json();
    state.generatedAt = data.generatedAt;
    state.jobs = merge(data.jobs || []);
    writeStored(state.jobs);
    const when = new Date(data.generatedAt);
    const counts = data.meta?.counts || {};
    $("#freshness").textContent =
      `Feed updated ${when.toLocaleString()}. ` +
      `${counts.total ?? state.jobs.length} jobs, ${counts.duplicatesFolded ?? 0} duplicates folded in.`;
  } catch (err) {
    state.jobs = readStored();
    $("#freshness").textContent =
      "Could not load data/jobs.json, showing what is saved in this browser. " +
      "Check that the discovery workflow has run at least once.";
  }
  render();
}

boot();

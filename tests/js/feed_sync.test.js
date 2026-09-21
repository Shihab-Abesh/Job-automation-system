// feed-sync.js must merge the pipeline's feed into the browser's jobs without losing anything the
// user did to them. Run by tests/test_keywords.py (or directly: node tests/js/feed_sync.test.js).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SRC = fs.readFileSync(path.resolve(__dirname, "..", "..", "feed-sync.js"), "utf8");
const JOB_KEY = "careerpilot_bd_v2_jobs";

async function sync({ stored = [], feed = [], decisions = {}, reloadedAlready = false }) {
  const local = new Map([[JOB_KEY, JSON.stringify(stored)], ["careerpilot_bd_v2_decisions", JSON.stringify(decisions)]]);
  const session = new Map(reloadedAlready ? [["careerpilot_feed_synced", "1"]] : []);
  const store = m => ({ getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) });
  let reloads = 0;
  const ctx = {
    localStorage: store(local), sessionStorage: store(session), Date, JSON, Map, Set, Promise, console,
    location: { reload: () => { reloads++; } },
    fetch: async () => ({ ok: true, json: async () => ({ jobs: feed }) })
  };
  vm.runInNewContext(SRC, ctx);
  await new Promise(r => setTimeout(r, 30));
  return { jobs: JSON.parse(local.get(JOB_KEY)), reloads };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("resume edits, keyword choices, pasted text and strategy survive a sync", async () => {
  const mine = {
    id: "local-1", fingerprint: "fp1", status: "Saved", title: "Old title", description: "old feed text",
    selectedStrategy: "Software Development",
    resumeOverrides: { headline: "My headline", summary: "Edited by hand", experienceText: "x", projectsText: "y" },
    resumeKeywords: { enabled: true, off: ["php"], claimed: ["jira"] },
    pastedDescription: "the full post I pasted"
  };
  const { jobs } = await sync({ stored: [mine], feed: [{ id: "feed-1", fingerprint: "fp1", status: "Awaiting Review", title: "New title", description: "fresh feed text" }] });
  assert.strictEqual(jobs.length, 1);
  const j = jobs[0];
  assert.deepStrictEqual(j.resumeOverrides, mine.resumeOverrides);
  assert.deepStrictEqual(j.resumeKeywords, mine.resumeKeywords);
  assert.strictEqual(j.pastedDescription, mine.pastedDescription);
  assert.strictEqual(j.selectedStrategy, "Software Development");
  assert.strictEqual(j.status, "Saved", "your status wins over the feed's");
  assert.strictEqual(j.id, "local-1", "the id React already uses is kept");
  assert.strictEqual(j.title, "New title", "feed fields still refresh");
  assert.strictEqual(j.description, "fresh feed text");
});

test("a job with no local edits does not grow empty fields", async () => {
  const { jobs } = await sync({ stored: [], feed: [{ id: "a", fingerprint: "fpA", status: "Awaiting Review", title: "T" }] });
  for (const f of ["resumeOverrides", "resumeKeywords", "pastedDescription", "selectedStrategy"]) assert.ok(!(f in jobs[0]), f);
});

test("a brand new job reloads the page once, and only once per tab", async () => {
  const feed = [{ id: "a", fingerprint: "fpA", status: "Awaiting Review", title: "T" }];
  assert.strictEqual((await sync({ feed })).reloads, 1);
  assert.strictEqual((await sync({ feed, reloadedAlready: true })).reloads, 0);
});

test("nothing new means no reload", async () => {
  const stored = [{ id: "a", fingerprint: "fpA", status: "Awaiting Review", title: "T" }];
  assert.strictEqual((await sync({ stored, feed: [{ id: "x", fingerprint: "fpA", status: "Awaiting Review", title: "T" }] })).reloads, 0);
});

test("untouched jobs that left the feed are dropped; ones you acted on are kept", async () => {
  const stored = [
    { id: "1", fingerprint: "gone1", status: "Awaiting Review", title: "untouched" },
    { id: "2", fingerprint: "gone2", status: "Applied", title: "applied", resumeKeywords: { enabled: true, off: [], claimed: ["x"] } },
    { id: "3", title: "added by hand, no fingerprint" }
  ];
  const { jobs } = await sync({ stored, feed: [{ id: "n", fingerprint: "fresh", status: "Awaiting Review", title: "fresh" }] });
  const titles = jobs.map(j => j.title).sort();
  assert.deepStrictEqual(titles, ["added by hand, no fingerprint", "applied", "fresh"]);
  assert.deepStrictEqual(jobs.find(j => j.id === "2").resumeKeywords.claimed, ["x"]);
});

test("a decision made in the approval queue still sets the status", async () => {
  const { jobs } = await sync({ stored: [], feed: [{ id: "a", fingerprint: "fpA", status: "Awaiting Review", title: "T" }], decisions: { fpA: { status: "Saved" } } });
  assert.strictEqual(jobs[0].status, "Saved");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log("ok   " + name); }
    catch (e) { failed++; console.log("FAIL " + name + "\n     " + String(e.message).split("\n").join("\n     ")); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();

// Private per-job data (privatedata.js): moving the hand-edited resume and the edited pack off job records.
// Run by tests/test_keywords.py (or directly: node tests/js/privatedata.test.js).
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const api = new Function(fs.readFileSync(path.join(ROOT, "privatedata.js"), "utf8") +
  "\nreturn {PD_FIELDS,normalizePrivate,splitPrivate,mergePrivate,withPrivate,dropPrivate};")();

const OV = { headline: "H", summary: "S", experienceText: "E", projectsText: "P" };
const PACK = { coverLetter: "letter", email: "mail", recruiter: "hi" };
const job = (id, extra = {}) => ({ id, title: "T" + id, company: "C", status: "Applied", resumeKeywords: { enabled: true, added: ["sql"], skipped: [] }, selectedStrategy: "qa", ...extra });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("the two personal fields are exactly the resume edits and the pack edits", () => {
  assert.deepStrictEqual(api.PD_FIELDS, ["resumeOverrides", "applicationPack"]);
});

test("splitPrivate lifts both fields off a job and keeps everything else", () => {
  const j = job("a", { resumeOverrides: OV, applicationPack: PACK });
  const r = api.splitPrivate([j]);
  assert.strictEqual(r.count, 1);
  assert.deepStrictEqual(r.moved, { a: { resumeOverrides: OV, applicationPack: PACK } });
  assert.ok(!("resumeOverrides" in r.jobs[0]) && !("applicationPack" in r.jobs[0]));
  assert.deepStrictEqual(r.jobs[0], job("a"));
  // the original record is not mutated
  assert.ok("resumeOverrides" in j);
});

test("jobs without them are returned untouched, and a null (a reset edit) holds nothing personal so it is not moved", () => {
  const plain = job("p");
  const nulled = job("n", { resumeOverrides: null });
  const r = api.splitPrivate([plain, nulled]);
  assert.strictEqual(r.count, 0);
  assert.strictEqual(r.jobs[0], plain);                       // same object: nothing to copy
  assert.deepStrictEqual(r.moved, {});
  assert.deepStrictEqual(r.jobs[1], nulled);
});

test("splitPrivate is idempotent: running it on its own output moves nothing", () => {
  const first = api.splitPrivate([job("a", { resumeOverrides: OV }), job("b", { applicationPack: PACK })]);
  const second = api.splitPrivate(first.jobs);
  assert.strictEqual(second.count, 0);
  assert.deepStrictEqual(second.jobs, first.jobs);
});

test("a malformed field is left on the job rather than deleted, so nothing is lost", () => {
  const j = job("m", { resumeOverrides: { summary: "only one field" }, applicationPack: "not an object" });
  const r = api.splitPrivate([j]);
  assert.strictEqual(r.count, 0);
  assert.deepStrictEqual(r.jobs[0], j);
});

test("a pack with only one edited part moves just that part", () => {
  const r = api.splitPrivate([job("a", { applicationPack: { coverLetter: "only", email: undefined, junk: "x" } })]);
  assert.deepStrictEqual(r.moved, { a: { applicationPack: { coverLetter: "only" } } });
});

test("normalizePrivate keeps sound entries and drops everything else", () => {
  const out = api.normalizePrivate({
    good: { resumeOverrides: OV, applicationPack: PACK },
    half: { resumeOverrides: { ...OV, summary: 5 }, applicationPack: { coverLetter: "kept", email: 7 } },
    empty: {}, nothing: null, str: "x", arr: [1], junk: { other: 1 }
  });
  assert.deepStrictEqual(Object.keys(out).sort(), ["good", "half"]);
  assert.deepStrictEqual(out.half, { applicationPack: { coverLetter: "kept" } });
  for (const bad of [null, undefined, 5, "x", [], [{ a: 1 }]]) assert.deepStrictEqual(api.normalizePrivate(bad), {});
});

test("merging: the vault's copy wins per field, and a field it lacks is filled from the older plain copy", () => {
  const vault = { a: { applicationPack: { coverLetter: "NEW" } } };
  const legacy = { a: { applicationPack: { coverLetter: "STALE", email: "STALE MAIL" }, resumeOverrides: OV }, b: { applicationPack: PACK } };
  const m = api.mergePrivate(vault, legacy);
  assert.strictEqual(m.a.applicationPack.coverLetter, "NEW");
  // the pack object as a whole belongs to the vault, so the stale email does not leak back in
  assert.deepStrictEqual(m.a.applicationPack, { coverLetter: "NEW" });
  assert.deepStrictEqual(m.a.resumeOverrides, OV);
  assert.deepStrictEqual(m.b, { applicationPack: PACK });
});

test("merging with nothing on either side is empty, and does not mutate its inputs", () => {
  assert.deepStrictEqual(api.mergePrivate({}, {}), {});
  assert.deepStrictEqual(api.mergePrivate(null, undefined), {});
  const v = { a: { resumeOverrides: OV } }, l = { a: { applicationPack: PACK } };
  const before = JSON.stringify([v, l]);
  api.mergePrivate(v, l);
  assert.strictEqual(JSON.stringify([v, l]), before);
});

test("withPrivate sets, replaces and removes a job's fields, and drops an entry that ends up empty", () => {
  let m = api.withPrivate({}, "a", { resumeOverrides: OV });
  assert.deepStrictEqual(m, { a: { resumeOverrides: OV } });
  m = api.withPrivate(m, "a", { applicationPack: { coverLetter: "x" } });
  assert.deepStrictEqual(m.a, { resumeOverrides: OV, applicationPack: { coverLetter: "x" } });
  m = api.withPrivate(m, "a", { resumeOverrides: null });                // "Reset to auto-generated"
  assert.deepStrictEqual(m.a, { applicationPack: { coverLetter: "x" } });
  m = api.withPrivate(m, "a", { applicationPack: { coverLetter: undefined } });   // resetting the only edited part
  assert.deepStrictEqual(m, {});
});

test("withPrivate leaves other jobs alone and never mutates the map it was given", () => {
  const base = { a: { resumeOverrides: OV }, b: { applicationPack: PACK } };
  const before = JSON.stringify(base);
  const m = api.withPrivate(base, "a", { resumeOverrides: null });
  assert.strictEqual(JSON.stringify(base), before);
  assert.deepStrictEqual(m, { b: { applicationPack: PACK } });
});

test("withPrivate ignores fields that are not personal data", () => {
  const m = api.withPrivate({}, "a", { status: "Applied", resumeKeywords: { added: ["x"] } });
  assert.deepStrictEqual(m, {});
});

test("dropPrivate removes one job's entry only", () => {
  const base = { a: { resumeOverrides: OV }, b: { applicationPack: PACK } };
  assert.deepStrictEqual(api.dropPrivate(base, "a"), { b: { applicationPack: PACK } });
  assert.deepStrictEqual(api.dropPrivate(base, "zzz"), base);
  assert.deepStrictEqual(api.dropPrivate(null, "a"), {});
});

test("everything is plain data: it survives JSON (encryption) unchanged", () => {
  const m = api.mergePrivate({ a: { resumeOverrides: OV } }, { b: { applicationPack: PACK } });
  assert.deepStrictEqual(api.normalizePrivate(JSON.parse(JSON.stringify(m))), m);
});

// ------------------------------------------------------------------ run
let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + String(e.message).split("\n").join("\n     ")); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);

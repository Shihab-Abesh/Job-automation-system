// Sent versions (versions.js): snapshot, de-duplication, diff, merge, import validation.
// Run by tests/test_keywords.py (or directly: node tests/js/versions.test.js).
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const api = new Function(read("resumedoc.js") + "\n" + read("versions.js") +
  "\nreturn {buildResumeDoc,resumeDocToText,makeVersion,versionContentKey,addVersion,versionsForJob,diffVersions,versionLine," +
  "isVersion,normalizeVersions,mergeVersions,sortNewest,formatDay,versionsStorageBytes};")();

const profile = () => ({
  personal: { fullName: "Test Person", phone: "01700000000", email: "test@example.com" },
  education: [{ degree: "BSc CSE", institution: "AIUB", date: "Expected October 2026" }], references: []
});
const doc = (over = {}) => api.buildResumeDoc({
  profile: profile(), headline: "QA Engineer", contact: "Dhaka | 01700000000", summary: "Summary one.",
  skillRows: [{ category: "Testing", items: ["Manual Testing", "SQL"] }],
  experience: [{ role: "QA Intern", company: "Innolytic IT Ltd.", location: "Dhaka", duration: "2026", bullets: ["Did a thing."] }],
  projects: [{ name: "Payroll", bullets: ["Built it."] }],
  overridden: false, experienceText: "QA Intern\n• Did a thing.", projectsText: "Payroll\n• Built it.", ...over
});
const JOB_DATA = { id: "job-1", fingerprint: "fp-1", company: "  Zorblax Ltd ", title: "QA Engineer", url: "https://example.org/j", deadline: "2026-10-05",
  source: "BDRecruit", location: "Dhaka", salaryMin: 30000, salaryMax: 45000, salaryText: "30,000 - 45,000 BDT" };
const JOB = JOB_DATA;
const ctx = (over = {}) => ({
  job: { ...JOB_DATA }, doc: doc(), strategy: "qa", strategyLabel: "QA / Software Testing", keywordsAdded: ["Postman", "API Testing"],
  pack: { coverLetter: "Dear Zorblax Ltd Hiring Team,\nLetter.", email: "Subject: x", recruiter: "Hi" },
  salary: { amount: 35000, note: "Within the post's range." }, report: { gaps: ["Docker"], matchBefore: 2, matchAfter: 5, roleFit: 71 },
  description: "The whole post.", fileName: "resume_zorblax-ltd_qa-engineer_2026-09-22.pdf", now: new Date(2026, 8, 22, 10, 30), ...over
});
const make = over => api.makeVersion(ctx(over));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("a version records the company, role, date, file name, keywords, strategy and the resume itself", () => {
  const v = make();
  assert.strictEqual(v.company, "Zorblax Ltd");
  assert.strictEqual(v.title, "QA Engineer");
  assert.strictEqual(v.appliedOn, "2026-09-22");
  assert.strictEqual(v.fileName, "resume_zorblax-ltd_qa-engineer_2026-09-22.pdf");
  assert.deepStrictEqual(v.keywordsAdded, ["Postman", "API Testing"]);
  assert.strictEqual(v.strategy, "qa");
  assert.strictEqual(v.strategyLabel, "QA / Software Testing");
  assert.strictEqual(v.doc.summary, "Summary one.");
  assert.strictEqual(v.pack.coverLetter, "Dear Zorblax Ltd Hiring Team,\nLetter.");
  assert.deepStrictEqual(v.salary, { postedMin: 30000, postedMax: 45000, postedText: "30,000 - 45,000 BDT", suggested: 35000, note: "Within the post's range." });
  assert.deepStrictEqual(v.report, { gaps: ["Docker"], matchBefore: 2, matchAfter: 5, roleFit: 71 });
  assert.strictEqual(v.description, "The whole post.");
  assert.ok(api.isVersion(v));
});

test("the date is the local calendar day, not the UTC day", () => {
  // 23:30 local time on the 22nd must still read the 22nd, whatever the machine's time zone
  assert.strictEqual(make({ now: new Date(2026, 8, 22, 23, 30) }).appliedOn, "2026-09-22");
  assert.strictEqual(make({ now: new Date(2026, 8, 22, 0, 15) }).appliedOn, "2026-09-22");
});

test("a version is a copy: editing the resume, keywords or job afterwards cannot change it", () => {
  const c = ctx();
  const v = api.makeVersion(c);
  const before = JSON.stringify(v);
  c.doc.summary = "CHANGED"; c.doc.skillRows[0].items.push("CHANGED"); c.keywordsAdded.push("CHANGED");
  c.report.gaps.push("CHANGED"); c.pack.email = "CHANGED"; c.job.company = "CHANGED";
  assert.strictEqual(JSON.stringify(v), before);
});

test("missing optional inputs give empty values, never undefined or NaN", () => {
  const v = api.makeVersion({ job: { id: "x", company: "A", title: "B" }, doc: doc(), now: new Date(2026, 0, 5) });
  assert.strictEqual(v.salary.postedMin, null);
  assert.strictEqual(v.salary.suggested, null);
  assert.deepStrictEqual(v.keywordsAdded, []);
  assert.deepStrictEqual(v.report, { gaps: [], matchBefore: null, matchAfter: null, roleFit: null });
  assert.ok(!/undefined|NaN/.test(JSON.stringify(v)));
  assert.ok(api.isVersion(v));
});

test("ids are unique", () => {
  assert.notStrictEqual(make().id, make().id);
});

test("recording the same thing twice does not add a second version", () => {
  const first = api.addVersion([], make());
  assert.ok(first.added);
  const again = api.addVersion(first.list, make({ now: new Date(2026, 8, 23) }));
  assert.strictEqual(again.added, false);
  assert.strictEqual(again.duplicateOf, first.list[0].id);
  assert.strictEqual(again.list.length, 1);
});

test("a changed resume, cover letter, keyword or strategy is a new version", () => {
  const base = api.addVersion([], make()).list;
  const variants = [
    make({ doc: doc({ summary: "Summary two." }) }),
    make({ pack: { coverLetter: "Another letter.", email: "Subject: x", recruiter: "Hi" } }),
    make({ pack: { coverLetter: "Dear Zorblax Ltd Hiring Team,\nLetter.", email: "Subject: y", recruiter: "Hi" } }),
    make({ keywordsAdded: ["Postman"] }),
    make({ strategy: "bba" })
  ];
  for (const v of variants) assert.ok(api.addVersion(base, v).added, JSON.stringify(v.keywordsAdded) + v.strategy);
});

test("a note, the time and the file name alone do not make a new version", () => {
  const base = api.addVersion([], make()).list;
  const v = make({ fileName: "other.pdf", now: new Date(2026, 9, 30) });
  v.note = "a note";
  assert.strictEqual(api.addVersion(base, v).added, false);
});

test("a duplicate is judged against the newest version only, so going back is recorded again", () => {
  let list = api.addVersion([], make({ now: new Date(2026, 8, 22) })).list;
  list = api.addVersion(list, make({ doc: doc({ summary: "Two." }), now: new Date(2026, 8, 23) })).list;
  const back = api.addVersion(list, make({ now: new Date(2026, 8, 24) }));   // same as the FIRST, not the newest
  assert.ok(back.added);
  assert.strictEqual(back.list.length, 3);
});

test("the same content for a different job is not a duplicate", () => {
  const list = api.addVersion([], make()).list;
  const other = make({ job: { ...JOB, id: "job-2", fingerprint: "fp-2", company: "Other Ltd" } });
  assert.ok(api.addVersion(list, other).added);
});

test("a job's versions come back newest first, matched by id or by fingerprint", () => {
  let list = [];
  list = api.addVersion(list, make({ now: new Date(2026, 8, 22) })).list;
  list = api.addVersion(list, make({ doc: doc({ summary: "Two." }), now: new Date(2026, 8, 25) })).list;
  list = api.addVersion(list, make({ job: { ...JOB, id: "job-9", fingerprint: "fp-9" }, now: new Date(2026, 8, 26) })).list;
  assert.deepStrictEqual(api.versionsForJob(list, JOB).map(v => v.appliedOn), ["2026-09-25", "2026-09-22"]);
  // the feed re-created the job with a new id but the same fingerprint: the history still follows it
  assert.strictEqual(api.versionsForJob(list, { id: "new-id", fingerprint: "fp-1" }).length, 2);
  // an unrelated job with neither matches nothing (and empty ids never match each other)
  assert.strictEqual(api.versionsForJob(list, { id: "", fingerprint: "" }).length, 0);
  assert.strictEqual(api.versionsForJob(list, { id: "zzz", fingerprint: "zzz" }).length, 0);
});

test("the diff names what changed between two versions", () => {
  const a = make();
  const b = make({ doc: doc({ summary: "Summary two.", skillRows: [{ category: "Testing", items: ["Manual Testing", "SQL", "Postman"] }] }),
    keywordsAdded: ["Postman", "Docker"], pack: { coverLetter: "New letter.", email: "Subject: x", recruiter: "Hi" }, strategy: "bba" });
  const d = api.diffVersions(a, b);
  assert.strictEqual(d.first, false);
  assert.deepStrictEqual(d.changed, ["Resume strategy", "Summary", "Core skills", "Cover letter"]);
  assert.deepStrictEqual(d.keywordsAdded, ["Docker"]);
  assert.deepStrictEqual(d.keywordsRemoved, ["API Testing"]);
  assert.strictEqual(d.identical, false);
});

test("the diff sees experience, project, headline, email and recruiter-message changes too", () => {
  const a = make();
  const b = make({
    doc: doc({ headline: "BBA Graduate", experience: [{ role: "QA Intern", company: "Innolytic IT Ltd.", location: "Dhaka", duration: "2026", bullets: ["Different."] }],
      projects: [{ name: "Payroll", bullets: ["Different."] }] }),
    pack: { coverLetter: "Dear Zorblax Ltd Hiring Team,\nLetter.", email: "Subject: z", recruiter: "Hello there" }
  });
  assert.deepStrictEqual(api.diffVersions(a, b).changed, ["Headline", "Experience", "Projects", "Email", "Recruiter message"]);
});

test("a changed name, contact line, education or reference is reported, never called identical", () => {
  const a = make();
  const base = { profile: profile(), headline: "QA Engineer", contact: "Dhaka | 01700000000", summary: "Summary one.",
    skillRows: [{ category: "Testing", items: ["Manual Testing", "SQL"] }],
    experience: [{ role: "QA Intern", company: "Innolytic IT Ltd.", location: "Dhaka", duration: "2026", bullets: ["Did a thing."] }],
    projects: [{ name: "Payroll", bullets: ["Built it."] }], overridden: false, experienceText: "QA Intern\n• Did a thing.", projectsText: "Payroll\n• Built it." };
  const withProfile = mut => { const p = profile(); mut(p); return make({ doc: api.buildResumeDoc({ ...base, profile: p }) }); };
  const cases = [
    ["Name and contact", withProfile(p => { p.personal.fullName = "Someone Else"; })],
    ["Education", withProfile(p => { p.education[0].degree = "MBA"; })],
    ["References", withProfile(p => { p.references = [{ name: "Ref", title: "T", email: "e@x.com", phone: "1" }]; })]
  ];
  for (const [label, b] of cases) {
    const d = api.diffVersions(a, b);
    assert.deepStrictEqual(d.changed, [label]);
    assert.strictEqual(d.identical, false);
  }
  assert.deepStrictEqual(api.diffVersions(a, make({ doc: doc({ contact: "Dhaka | 01999999999" }) })).changed, ["Name and contact"]);
  // switching a hand-edit on with the same text still counts as a change to the experience
  assert.deepStrictEqual(api.diffVersions(a, make({ doc: doc({ overridden: true }) })).changed, ["Experience", "Projects"]);
});

test("any difference the named labels miss is still reported, so 'identical' is always true", () => {
  const a = make();
  const b = make();
  b.doc = { ...b.doc, v: 99 };
  const d = api.diffVersions(a, b);
  assert.deepStrictEqual(d.changed, ["Other details"]);
  assert.strictEqual(d.identical, false);
});

test("the first version has no earlier one to compare with, and identical versions say so", () => {
  const a = make();
  assert.deepStrictEqual(api.diffVersions(null, a), { first: true, identical: false, keywordsAdded: ["Postman", "API Testing"], keywordsRemoved: [], changed: [] });
  assert.strictEqual(api.diffVersions(a, make()).identical, true);
});

test("day and list-line formatting", () => {
  assert.strictEqual(api.formatDay("2026-09-22"), "22 Sep 2026");
  assert.strictEqual(api.formatDay("2026-01-05"), "5 Jan 2026");
  assert.strictEqual(api.formatDay("nonsense"), "");
  assert.strictEqual(api.versionLine(make()), "Zorblax Ltd - QA Engineer - applied 22 Sep 2026");
  assert.strictEqual(api.versionLine({ ...make(), company: "", title: "" }), "Unknown company - Unknown role - applied 22 Sep 2026");
});

test("import validation drops anything malformed and keeps everything sound", () => {
  const good = make();
  const bad = [null, 5, "x", {}, { ...make(), id: "" }, { ...make(), doc: { name: "x" } }, { ...make(), keywordsAdded: "Postman" },
    { ...make(), pack: null }, { ...make(), appliedOn: "22/09/2026" }, { ...make(), company: 5 }];
  const out = api.normalizeVersions([...bad, good]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, good.id);
  assert.deepStrictEqual(api.normalizeVersions("not an array"), []);
  assert.deepStrictEqual(api.normalizeVersions(null), []);
});

test("normalizing fills the optional fields an older or hand-made file may lack, and de-duplicates ids", () => {
  const good = make();
  const sparse = { id: "s1", company: "A", title: "B", appliedAt: "2026-09-22T04:00:00.000Z", appliedOn: "2026-09-22", keywordsAdded: [],
    pack: { coverLetter: "", email: "", recruiter: "" }, doc: doc() };
  const out = api.normalizeVersions([sparse, good, good]);
  assert.strictEqual(out.length, 2);
  const s = out.find(v => v.id === "s1");
  assert.strictEqual(s.note, "");
  assert.strictEqual(s.updatedAt, "2026-09-22T04:00:00.000Z");
  assert.deepStrictEqual(s.report, { gaps: [], matchBefore: null, matchAfter: null, roleFit: null });
});

test("importing merges by id: nothing is lost, nothing is doubled, the newest edit wins", () => {
  const a = make({ now: new Date(2026, 8, 22) });
  const b = make({ doc: doc({ summary: "Two." }), now: new Date(2026, 8, 23) });
  const current = [a];
  const edited = { ...a, note: "Interview on Monday", updatedAt: "2099-01-01T00:00:00.000Z" };
  const merged = api.mergeVersions(current, [edited, b]);
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged.find(v => v.id === a.id).note, "Interview on Monday");
  // an older copy in the file does not overwrite a newer edit already held
  const older = { ...a, note: "stale", updatedAt: "2000-01-01T00:00:00.000Z" };
  assert.strictEqual(api.mergeVersions([edited], [older]).find(v => v.id === a.id).note, "Interview on Monday");
  // importing the same file twice changes nothing
  assert.strictEqual(api.mergeVersions(merged, merged).length, 2);
});

test("exporting and importing is lossless", () => {
  let list = api.addVersion([], make({ now: new Date(2026, 8, 22) })).list;
  list = api.addVersion(list, make({ doc: doc({ summary: "Two." }), now: new Date(2026, 8, 23) })).list;
  const round = api.mergeVersions([], JSON.parse(JSON.stringify(list)));
  assert.deepStrictEqual(api.sortNewest(round), api.sortNewest(list));
});

test("storage size is reported, and one version stays small enough to keep dozens", () => {
  assert.strictEqual(api.versionsStorageBytes([]), 2);
  const one = api.versionsStorageBytes([make()]);
  assert.ok(one > 500 && one < 12000, `${one} bytes`);
});

test("a stored version is plain data, safe to encrypt and to keep in React state", () => {
  const v = make();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(v)), v);
});

test("the TXT of a recorded version is the resume as recorded, whatever the profile says now", () => {
  const p = profile();
  const d = api.buildResumeDoc({ profile: p, headline: "QA", contact: "c", summary: "As sent.", skillRows: [], experience: [], projects: [], experienceText: "e", projectsText: "p" });
  const v = api.makeVersion({ job: JOB, doc: d, now: new Date(2026, 8, 22) });
  p.personal.fullName = "Someone Else"; p.education[0].degree = "MBA";
  assert.ok(api.resumeDocToText(v.doc).startsWith("TEST PERSON\nQA\n"));
  assert.ok(api.resumeDocToText(v.doc).includes("As sent.") && api.resumeDocToText(v.doc).includes("BSc CSE") && !/MBA|SOMEONE/.test(api.resumeDocToText(v.doc)));
});

// ------------------------------------------------------------------ run
let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + String(e.message).split("\n").join("\n     ")); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);

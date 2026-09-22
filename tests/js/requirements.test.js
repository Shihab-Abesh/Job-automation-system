// Job Requirements: distinguishing a bare skill mention from a quantified hard requirement, and the
// eleven structured groups built from that. Run by tests/test_keywords.py (or directly:
// node tests/js/requirements.test.js).
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const api = new Function(fs.readFileSync(path.join(ROOT, "keywords.js"), "utf8") +
  "\nreturn {extractKeywords,keywordEvidence,annotateKeywords,analyzeRequirements,kwBuild};")();

const profile = {
  skills: [{ category: "Testing", items: ["Manual Testing", "SQL", "Excel"] }],
  education: [{ degree: "Bachelor of Science in Computer Science and Engineering", institution: "AIUB" }],
  experience: [], projects: [],
  preferences: { locations: ["Dhaka, Bangladesh", "Remote"], experienceYears: 1, expectedSalaryMin: null }
};
const evidence = api.keywordEvidence(profile);
const analyze = (text, title = "", job = {}, prof = profile) =>
  api.analyzeRequirements(api.annotateKeywords(api.extractKeywords(text, title, job.company), evidence), text, title, job, prof);
const by = (items, key) => items.find(x => x.key === key);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ------------------------------------------------------------------ the actual ask: bare mention vs. quantified requirement
test("FLAGSHIP: 'Python preferred' reads differently from '3+ years of SQL required', per skill", () => {
  const post = `Requirements
Python preferred.

Minimum 3 years professional SQL development experience required.`;
  const r = analyze(post, "Software Engineer");
  const python = by(r.tools.items, "python"), sql = by(r.tools.items, "sql");
  assert.strictEqual(python.tier, "nice");
  assert.strictEqual(python.hardRequirement, false);
  assert.strictEqual(python.yearsRequired, null);
  assert.strictEqual(sql.tier, "must");
  assert.strictEqual(sql.hardRequirement, true);
  assert.strictEqual(sql.yearsRequired, 3);
});

test("a skill mentioned softly, then later stated with a hard year count, keeps the hard evidence", () => {
  const post = `Preferred
Python is a plus.

Requirements
Minimum 3 years professional Python development experience required.`;
  const r = analyze(post, "Software Engineer");
  const python = by(r.tools.items, "python");
  assert.strictEqual(python.hardRequirement, true);
  assert.strictEqual(python.yearsRequired, 3);
  assert.strictEqual(python.tier, "must", "the hard mention is also the stronger tier");
});

test("years ranges and a bare number both parse, using the lower bound", () => {
  const cases = [["3-5 years of Java required.", 3], ["5+ years of Java required.", 5], ["at least 2 years of Java required.", 2],
   ["Minimum 12–15 years of Java experience.", 12], ["8—10 years of Java experience.", 8]];
  for (const [line, expected] of cases) {
    const python = by(analyze(`Requirements\n${line}`).tools.items, "java");
    assert.strictEqual(python.yearsRequired, expected, line);
  }
});

test("an age range is not read as a years-of-experience requirement", () => {
  const post = "Requirements\nCandidates must be between 22 and 30 years old.\nBasic Excel skills needed.";
  const r = analyze(post);
  const excel = by(r.tools.items, "excel");
  assert.strictEqual(excel.hardRequirement, false, "the age statement leaked into Excel's requirement");
  assert.strictEqual(excel.yearsRequired, null);
});

test("an implausible year count (from an unrelated number) is not captured", () => {
  const r = analyze("Requirements\nJIRA ticket #45 years of process improvement.\nSQL required.".replace("45 years", "45 years"));
  // 45 is outside the realistic 1-25 experience range and must be ignored, whatever produced it.
  const jira = by(r.tools.items, "jira");
  assert.ok(!jira || jira.yearsRequired == null || jira.yearsRequired <= 25);
});

// ------------------------------------------------------------------ the eleven groups
const FULL_POST = `About Acme
We are a great company that loves our culture.

Location: Dhaka
Salary: Negotiable
Experience: At least 2 years

Requirements
Bachelor's degree in Computer Science required.
Python preferred.
Minimum 3 years professional SQL development experience required.
PMP certification is a plus.
Fluent English required.

Domain
Experience in Fintech is required.

Responsibilities
Write and review code.
Mentor junior engineers.

Benefits
Festival bonus and free lunch.`;

test("Required folds in both must and important tiers; Preferred is nice only", () => {
  const r = analyze(FULL_POST, "Software Engineer");
  assert.ok(r.required.items.every(k => k.tier === "must" || k.tier === "important"));
  assert.ok(r.preferred.items.every(k => k.tier === "nice"));
  assert.ok(by(r.required.items, "sql") && by(r.preferred.items, "python"));
});

test("Tools/Technologies excludes certifications, domain markers and languages, and degrees", () => {
  const r = analyze(FULL_POST, "Software Engineer");
  const keys = r.tools.items.map(k => k.key);
  assert.ok(keys.includes("sql") && keys.includes("python"));
  for (const bad of ["pmp", "fintech", "english proficiency", "bachelor's degree", "computer science"]) {
    assert.ok(!keys.includes(bad), `${bad} leaked into Tools/Technologies`);
  }
});

test("Certifications / Domain / Language are each populated from their own tag only", () => {
  const r = analyze(FULL_POST, "Software Engineer");
  assert.deepStrictEqual(r.certifications.items.map(k => k.key), ["pmp"]);
  assert.deepStrictEqual(r.domain.items.map(k => k.key), ["fintech"]);
  assert.deepStrictEqual(r.language.items.map(k => k.key), ["english proficiency"]);
});

test("a post that never asks for a certification/domain/language leaves those groups empty", () => {
  const r = analyze("Requirements\nSQL and Python required.", "Engineer");
  assert.deepStrictEqual(r.certifications.items, []);
  assert.deepStrictEqual(r.domain.items, []);
  assert.deepStrictEqual(r.language.items, []);
});

test("Responsibilities captures the actual duty sentences, not a keyword bag, and ignores the blurb/benefits", () => {
  const r = analyze(FULL_POST, "Software Engineer");
  assert.deepStrictEqual(r.responsibilities.items, ["Write and review code.", "Mentor junior engineers."]);
});

test("Education compares against the profile's real degrees: match when one fits, gap when none do", () => {
  const yes = analyze(FULL_POST, "Software Engineer").education;
  assert.strictEqual(yes.compare.state, "match");
  const no = analyze("Requirements\nMBA required.\nSQL required.", "Manager").education;
  assert.strictEqual(no.compare.state, "gap");
  const none = analyze("Requirements\nSQL required.", "Engineer").education;
  assert.strictEqual(none, null, "no degree was asked for, so the group is omitted");
});

test("Experience: role-level years vs. your stated experienceYears, plus a fresher-friendly post and an unstated one", () => {
  const gap = analyze(FULL_POST, "Software Engineer", {}, { ...profile, preferences: { ...profile.preferences, experienceYears: 1 } }).experience;
  assert.strictEqual(gap.compare.state, "gap");
  assert.strictEqual(gap.requiredYears, 2);
  assert.strictEqual(gap.haveYears, 1);
  const met = analyze(FULL_POST, "Software Engineer", {}, { ...profile, preferences: { ...profile.preferences, experienceYears: 3 } }).experience;
  assert.strictEqual(met.compare.state, "match");
  const fresher = analyze("Experience: Freshers are encouraged to apply.\nRequirements\nSQL required.", "Officer").experience;
  assert.strictEqual(fresher.compare.state, "match");
  const unstated = analyze("Requirements\nSQL required.", "Officer").experience;
  assert.strictEqual(unstated, null, "no experience information at all, so the group is omitted");
});

test("Experience prefers the pipeline's own parsed field over anything in the pasted text", () => {
  const r = analyze("Experience: 10 years (typo in the post)", "Officer", { experienceText: "1-2 Years" });
  assert.strictEqual(r.experience.text, "1-2 Years");
  assert.strictEqual(r.experience.requiredYears, 1);
});

test("Location: a feed job's own resolved distance beats any text in the post", () => {
  const near = analyze(FULL_POST, "x", { location: "Mirpur, Dhaka", area: "Mirpur", distanceKm: 4 }).location;
  assert.strictEqual(near.compare.state, "match");
  const far = analyze(FULL_POST, "x", { location: "Chattogram", area: "Chattogram", distanceKm: 40 }).location;
  assert.strictEqual(far.compare.state, "gap");
  const remote = analyze(FULL_POST, "x", { location: "Remote", employmentType: "Remote or hybrid" }).location;
  assert.strictEqual(remote.compare.state, "match");
});

test("Location: a hand-added job falls back to its own 'Location:' line, matched by text", () => {
  const yes = analyze(FULL_POST).location;   // "Location: Dhaka" vs. preferences including "Dhaka, Bangladesh"
  assert.strictEqual(yes.compare.state, "match");
  const no = analyze("Location: Chattogram\nRequirements\nSQL required.").location;
  assert.strictEqual(no.compare.state, "unknown");
  const none = analyze("Requirements\nSQL required.").location;
  assert.strictEqual(none, null);
});

test("Salary: never guesses when you haven't set an expected minimum", () => {
  const r = analyze(FULL_POST, "x", {}, profile);   // profile.preferences.expectedSalaryMin is null
  assert.strictEqual(r.salary.compare.state, "unknown");
  assert.ok(/haven't set/i.test(r.salary.compare.note));
});

test("Salary: compares once you set an expected minimum, feed job's parsed numbers preferred", () => {
  const withExpectation = { ...profile, preferences: { ...profile.preferences, expectedSalaryMin: 40000 } };
  const meets = analyze(FULL_POST, "x", { salaryMin: 35000, salaryMax: 50000 }, withExpectation).salary;
  assert.strictEqual(meets.compare.state, "match");
  const falls = analyze(FULL_POST, "x", { salaryMin: 20000, salaryMax: 30000 }, withExpectation).salary;
  assert.strictEqual(falls.compare.state, "gap");
  const negotiable = analyze("Salary: Negotiable\nRequirements\nSQL required.", "x", {}, withExpectation).salary;
  assert.strictEqual(negotiable.compare.state, "unknown");
  const none = analyze("Requirements\nSQL required.", "x", {}, withExpectation).salary;
  assert.strictEqual(none, null);
});

test("the four raw-text groups never crash on a post with none of that information", () => {
  const r = analyze("Requirements\nSQL required.", "Officer", {}, profile);
  assert.strictEqual(r.location, null);
  assert.strictEqual(r.salary, null);
  assert.strictEqual(r.experience, null);
  assert.deepStrictEqual(r.responsibilities.items, []);
});

// ------------------------------------------------------------------ the lexicon tags themselves
test("cert/domain/lang tags land on real, distinct entries, never on a degree", () => {
  const { entries } = api.kwBuild();
  const tagged = entries.filter(e => e.tag);
  assert.ok(tagged.length >= 20, `only ${tagged.length} tagged entries`);
  for (const e of tagged) {
    assert.ok(["cert", "domain", "lang"].includes(e.tag), `${e.name} has an unknown tag ${e.tag}`);
    assert.notStrictEqual(e.kind, "degree", `${e.name} is tagged but also a degree`);
  }
  assert.strictEqual(new Set(tagged.map(e => e.key)).size, tagged.length, "duplicate tagged keys");
});

test("a handful of expected certifications, domain markers and languages are present", () => {
  const { byKey } = api.kwBuild();
  for (const key of ["pmp", "prince2", "itil", "iso 27001", "jaibb", "ccna"]) assert.strictEqual(byKey.get(key).tag, "cert", key);
  for (const key of ["fmcg", "fintech", "e-commerce", "healthcare", "ngo", "telecom"]) assert.strictEqual(byKey.get(key).tag, "domain", key);
  for (const key of ["english proficiency", "bangla"]) assert.strictEqual(byKey.get(key).tag, "lang", key);
});

test("Cisco itself is not a certification, only CCNA/CCNP are", () => {
  const { byKey } = api.kwBuild();
  assert.strictEqual(byKey.get("cisco").tag, null);
  assert.strictEqual(byKey.get("ccna").tag, "cert");
});

// ------------------------------------------------------------------ robustness
test("empty or missing input never throws, and every group is absent or empty rather than undefined behaviour", () => {
  for (const v of [undefined, null, "", "   "]) {
    const kws = api.annotateKeywords(api.extractKeywords(v, v), evidence);
    const r = api.analyzeRequirements(kws, v, v, {}, profile);
    assert.deepStrictEqual(r.required.items, []);
    assert.strictEqual(r.location, null);
  }
});

test("results are plain data (safe to keep in React state)", () => {
  const r = analyze(FULL_POST, "Software Engineer");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), r);
});

// ------------------------------------------------------------------ run
let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + String(e.message).split("\n").join("\n     ")); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);

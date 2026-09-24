// Resume document (resumedoc.js): the resume as plain data, and its text form.
// Run by tests/test_keywords.py (or directly: node tests/js/resumedoc.test.js).
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const api = new Function(fs.readFileSync(path.join(ROOT, "resumedoc.js"), "utf8") + "\nreturn {buildResumeDoc,resumeDocToText,isResumeDoc};")();

const profileData = {
  personal: { fullName: "Test Person", phone: "01700000000", email: "test@example.com" },
  education: [{ degree: "BSc in Computer Science and Engineering", institution: "AIUB", date: "Expected October 2026", score: "CGPA 3.5" }],
  references: [{ name: "Ref One", title: "Manager, Acme", email: "ref@example.com", phone: "01800000000" }, { name: "", title: "blank", email: "", phone: "" }]
};
const input = () => ({
  profile: JSON.parse(JSON.stringify(profileData)),
  headline: "QA Engineer | SQL",
  contact: "Dhaka | 01700000000 | test@example.com",
  summary: "A summary.",
  skillRows: [{ category: "Testing", items: ["Manual Testing", "", "SQL"] }],
  experience: [{ role: "QA Intern", company: "Innolytic IT Ltd.", location: "Dhaka", duration: "Jan 2026 - Mar 2026", bullets: ["Did a thing.", "", "Did another."] }],
  projects: [{ name: "Payroll System", subtitle: "Oracle Project", bullets: ["Built it."] }, { name: "Solo", bullets: ["x"] }],
  overridden: false,
  experienceText: "QA Intern, Innolytic IT Ltd. | Dhaka | Jan 2026 - Mar 2026\n• Did a thing.\n• Did another.",
  projectsText: "Payroll System, Oracle Project\n• Built it."
});

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("builds a plain, JSON-safe document from the resume's parts", () => {
  const d = api.buildResumeDoc(input());
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d)), d);
  assert.strictEqual(d.name, "Test Person");
  assert.strictEqual(d.headline, "QA Engineer | SQL");
  assert.deepStrictEqual(d.skillRows, [{ category: "Testing", items: ["Manual Testing", "SQL"] }]);
  assert.strictEqual(d.experience[0].title, "QA Intern, Innolytic IT Ltd.");
  assert.strictEqual(d.experience[0].meta, "Dhaka | Jan 2026 - Mar 2026");
  assert.deepStrictEqual(d.experience[0].bullets, ["Did a thing.", "Did another."]);
  assert.strictEqual(d.projects[0].title, "Payroll System, Oracle Project");
  assert.strictEqual(d.projects[1].title, "Solo");
  // the name and subtitle are kept apart too, so the preview can bold only the name
  assert.deepStrictEqual([d.projects[0].name, d.projects[0].subtitle, d.projects[1].name, d.projects[1].subtitle], ["Payroll System", "Oracle Project", "Solo", ""]);
  assert.strictEqual(d.education[0].detail, "AIUB | CGPA 3.5");
});

test("references without a name are left out", () => {
  const d = api.buildResumeDoc(input());
  assert.strictEqual(d.references.length, 1);
  assert.deepStrictEqual(d.references[0], { name: "Ref One", title: "Manager, Acme", contact: "ref@example.com | 01800000000" });
});

test("the document is a copy: changing the profile or the input afterwards cannot change it", () => {
  const inp = input();
  const d = api.buildResumeDoc(inp);
  const before = JSON.stringify(d);
  inp.skillRows[0].items.push("CHANGED");
  inp.experience[0].bullets.push("CHANGED");
  inp.profile.education[0].degree = "CHANGED";
  inp.profile.references[0].name = "CHANGED";
  assert.strictEqual(JSON.stringify(d), before);
});

test("plain text has the layout the TXT download always had", () => {
  const t = api.resumeDocToText(api.buildResumeDoc(input()));
  assert.strictEqual(t, [
    "TEST PERSON", "QA ENGINEER | SQL", "Dhaka | 01700000000 | test@example.com", "",
    "PROFESSIONAL SUMMARY", "A summary.", "",
    "CORE SKILLS", "Testing: Manual Testing, SQL", "",
    "PROFESSIONAL EXPERIENCE", "QA Intern, Innolytic IT Ltd. | Dhaka | Jan 2026 - Mar 2026", "• Did a thing.", "• Did another.", "",
    "PROJECTS", "Payroll System, Oracle Project", "• Built it.", "",
    "EDUCATION", "BSc in Computer Science and Engineering | Expected October 2026", "AIUB | CGPA 3.5", "",
    "REFERENCES", "Ref One", "Manager, Acme", "ref@example.com | 01800000000"
  ].join("\n"));
});

test("no headline means no blank headline line; no references means no References block", () => {
  const inp = input(); inp.headline = ""; inp.profile.references = [];
  const t = api.resumeDocToText(api.buildResumeDoc(inp));
  assert.ok(t.startsWith("TEST PERSON\nDhaka |"), t.slice(0, 60));
  assert.ok(!t.includes("REFERENCES"));
});

test("a hand-edited resume keeps the edited text and says so", () => {
  const inp = input(); inp.overridden = true; inp.experienceText = "My own experience text"; inp.projectsText = "My own projects";
  const d = api.buildResumeDoc(inp);
  assert.strictEqual(d.overridden, true);
  const t = api.resumeDocToText(d);
  assert.ok(t.includes("PROFESSIONAL EXPERIENCE\nMy own experience text\n\nPROJECTS\nMy own projects\n\nEDUCATION"));
});

test("an empty profile still produces a valid document rather than throwing", () => {
  const d = api.buildResumeDoc({ profile: {}, skillRows: [], experience: [], projects: [] });
  assert.ok(api.isResumeDoc(d));
  assert.ok(api.resumeDocToText(d).startsWith("YOUR NAME"));
});

test("isResumeDoc accepts a built document and rejects anything malformed", () => {
  const d = api.buildResumeDoc(input());
  assert.ok(api.isResumeDoc(d));
  for (const bad of [null, undefined, 5, "x", [], {}, { ...d, skillRows: "x" }, { ...d, experience: [{ title: 1, bullets: [] }] },
    { ...d, projects: [{ title: "a" }] }, { ...d, education: [{}] }, { ...d, name: null }, { ...d, experienceText: undefined }, { ...d, references: {} }]) {
    assert.ok(!api.isResumeDoc(bad), String(JSON.stringify(bad)).slice(0, 80));
  }
});

// ------------------------------------------------------------------ run
let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + String(e.message).split("\n").join("\n     ")); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);

// Recruiter-keyword extraction. Run by tests/test_keywords.py (or directly: node tests/js/keywords.test.js).
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const api = new Function(fs.readFileSync(path.join(ROOT, "keywords.js"), "utf8") +
  "\nreturn {extractKeywords,keywordEvidence,annotateKeywords,pickForResume,keywordCoverage,keywordHits,kwBuild};")();

const profile = {
  skills: [
    { category: "Testing", items: ["Manual Testing", "Regression Testing", "Test Case Design", "Scrum"] },
    { category: "Tools", items: ["Microsoft Office (Excel, Word)", "Git and GitHub"] },
    { category: "Databases", items: ["Oracle SQL", "MySQL"] }
  ],
  education: [{ degree: "Bachelor of Science in Computer Science and Engineering", institution: "AIUB" }],
  experience: [{
    role: "Software Quality Assurance Intern", company: "Innolytic",
    bullets: ["Verified backend behaviour through frontend actions.", "Ran regression testing after each fix cycle."],
    tags: ["Application Support"]
  }],
  projects: [{ name: "Port System", subtitle: "Web Application (HTML, CSS, PHP, JavaScript)", bullets: ["Built forms with validation."], skills: ["PHP", "Form Validation"] }]
};
const evidence = api.keywordEvidence(profile);
const read = (text, title = "") => api.annotateKeywords(api.extractKeywords(text, title), evidence);
const by = (kws, key) => kws.find(k => k.key === key);
const keys = kws => kws.map(k => k.key);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ------------------------------------------------------------------ the lexicon itself
test("lexicon is well formed: unique aliases, sane kinds, real size", () => {
  const { entries } = api.kwBuild();
  assert.ok(entries.length >= 350, `only ${entries.length} entries`);
  const seen = new Map();
  for (const e of entries) {
    assert.ok(["tech", "soft", "degree"].includes(e.kind), `${e.name}: kind ${e.kind}`);
    for (const a of e.aliases) {
      assert.ok(a.display.length >= 2, `alias too short: ${a.display}`);
      const k = a.low;
      assert.ok(!seen.has(k), `alias "${a.display}" is in both "${seen.get(k)}" and "${e.name}"`);
      seen.set(k, e.name);
    }
  }
  assert.strictEqual(new Set(entries.map(e => e.key)).size, entries.length, "duplicate entry names");
});

// ------------------------------------------------------------------ matching
test("whole words only: Java is not JavaScript, SQL is not MySQL, Git is not GitHub", () => {
  const k = keys(read("Requirements\nJavaScript, MySQL and GitHub"));
  assert.deepStrictEqual(["javascript", "mysql", "github"].filter(x => !k.includes(x)), []);
  for (const wrong of ["java", "sql", "git"]) assert.ok(!k.includes(wrong), `${wrong} matched inside a longer word`);
});

test("the real short forms still match: SQL inside PL/SQL, Java next to a slash", () => {
  const k = keys(read("Requirements\nPL/SQL and Java/Kotlin"));
  for (const want of ["pl/sql", "sql", "java", "kotlin"]) assert.ok(k.includes(want), `missing ${want}: ${k}`);
});

test("plurals and hyphens: 'cross-browser' and 'test case' read as the same thing", () => {
  const k = keys(read("Requirements\nWriting test case scenarios and cross-browser testing"));
  assert.ok(k.includes("test cases"), k.join());
  assert.ok(k.includes("cross browser testing"), k.join());
});

test("both singular and plural forms are recognised, and each is printed as the post wrote it", () => {
  for (const [text, key, shown] of [["test case", "test cases", "Test Case"], ["test cases", "test cases", "Test Cases"],
    ["stored procedure", "stored procedures", "Stored Procedure"], ["use cases", "use cases", "Use Cases"],
    ["web application", "web development", "Web Application"], ["daily report", "mis reporting", "Daily Report"],
    ["data structure", "data structures", "Data Structure"], ["design pattern", "design patterns", "Design Pattern"]]) {
    const k = by(read("Requirements\n" + text), key);
    assert.ok(k, `${text} not found`);
    assert.strictEqual(k.display, shown);
  }
});

test("case-sensitive aliases: the verb 'excel' is not Excel, 'AI' is not 'ai' in a word", () => {
  assert.ok(!keys(read("Requirements\nYou will excel at planning and remain available")).includes("excel"));
  assert.ok(keys(read("Requirements\nAdvanced Excel skills")).includes("excel"));
});

test("the post's own wording is what gets printed", () => {
  assert.strictEqual(by(read("Requirements\nProficient in Microsoft Excel"), "excel").display, "Microsoft Excel");
  assert.strictEqual(by(read("Requirements\nProficient in ms excel"), "excel").display, "MS Excel");
  assert.strictEqual(by(read("Requirements\nAdvanced Excel and Excel"), "excel").display, "Advanced Excel", "longest wording wins");
});

test("'hosting' as a verb is not the web-hosting skill", () => {
  assert.ok(!keys(read("Duties\nHosting regular meetings with managers")).includes("cpanel"));
});

// ------------------------------------------------------------------ reading the post
const QA_POST = `About Acme
We are a fast-growing company that loves Agile and Kanban.

Requirements
Bachelor's degree in Computer Science.
Hands-on experience in manual testing, writing test cases and regression testing.
Experience with JIRA for bug tracking.
Excellent communication skills.

Preferred
Selenium automation experience is a plus.

Responsibilities
Work with developers in Scrum teams.

Benefits
Festival bonus and Docker training`;

test("tiers follow the headings", () => {
  const k = read(QA_POST, "QA Engineer");
  assert.strictEqual(by(k, "manual testing").tier, "must");
  assert.strictEqual(by(k, "jira").tier, "must");
  assert.strictEqual(by(k, "selenium").tier, "nice");
  assert.strictEqual(by(k, "scrum").tier, "important");
});

test("company blurb and benefits are ignored", () => {
  const k = keys(read(QA_POST));
  for (const noise of ["agile", "kanban", "docker"]) assert.ok(!k.includes(noise), `${noise} was counted`);
});

test("a title keyword is a must-have and ranks high", () => {
  const k = read("Some text about the team.", "PHP Developer");
  assert.strictEqual(by(k, "php").tier, "must");
  assert.ok(by(k, "php").inTitle);
});

test("headings written as sentences work, with curly apostrophes", () => {
  const k = read("About us\nWe make things.\nWhat you’ll need\nPython and SQL\nWhat you’ll do\nUse Docker");
  assert.strictEqual(by(k, "python").tier, "must");
  assert.strictEqual(by(k, "docker").tier, "important");
});

test("a blurb headed 'How we work' does not swallow the rest of the post", () => {
  const k = read("About Edfinity\nWe are remote.\nHow we work\nWe are async.\nWhat you’ll need\nPython");
  assert.strictEqual(by(k, "python").tier, "must");
});

test("'Label: value' governs its own line only", () => {
  const k = read("Skills: PHP\nWe also use Docker\nLocation: Dhaka");
  assert.strictEqual(by(k, "php").tier, "must");
  assert.notStrictEqual(by(k, "docker").tier, "must");
});

test("a short skill line is a bullet, not a heading", () => {
  const k = read("Requirements\nGood communication skills\nPHP");
  assert.ok(by(k, "communication skills"), "the bullet was swallowed as a heading");
  assert.strictEqual(by(k, "php").tier, "must");
});

test("equal-opportunity boilerplate is not a skills list", () => {
  const k = keys(read("Requirements\nPython\nEqual opportunity employer. Applies to recruiting, hiring, placement and promotion."));
  assert.ok(k.includes("python") && !k.includes("recruitment"), k.join());
});

test("'preferred' and 'a plus' demote a skill even under Requirements", () => {
  const k = read("Requirements\nPython\nDocker is a plus");
  assert.strictEqual(by(k, "python").tier, "must");
  assert.strictEqual(by(k, "docker").tier, "nice");
});

test("results are ordered most important first", () => {
  const k = read(QA_POST, "QA Engineer");
  const order = { must: 0, important: 1, nice: 2 };
  const firstNice = k.findIndex(x => x.tier === "nice");
  assert.ok(k.slice(0, Math.max(firstNice, 0)).every(x => order[x.tier] <= 1), "a nice-to-have outranks a must-have");
  assert.strictEqual(k[0].tier, "must");
});

// ------------------------------------------------------------------ terms the lexicon does not know
test("the miner picks up a phrase after 'experience with', and repeated acronyms", () => {
  const k = read("Requirements\nExperience with Meta Ads Manager.\nThe RCM team owns billing.\nRCM reporting is daily.");
  const names = k.filter(x => x.source === "mined").map(x => x.name);
  assert.ok(names.includes("Meta Ads Manager"), names.join());
  assert.ok(names.includes("RCM"), names.join());
});

test("the miner is conservative: one-off acronyms and filler phrases are not keywords", () => {
  const k = read("Requirements\nKnowledge of the company culture and good team spirit.\nOur HQ is in ZZQ.");
  assert.deepStrictEqual(k.filter(x => x.source === "mined").map(x => x.name), []);
});

test("acronyms the lexicon already handled do not come back in pieces", () => {
  const names = read("Requirements\nCI/CD pipelines and MS Excel").filter(x => x.source === "mined").map(x => x.name);
  for (const bad of ["CI", "CD", "MS"]) assert.ok(!names.includes(bad), `${bad} leaked`);
});

// ------------------------------------------------------------------ what counts as yours
test("a listed skill is 'skills' evidence; a word inside a sentence is only 'prose'", () => {
  const k = read("Requirements\nManual testing, regression testing, backend development, frontend, SQL");
  assert.strictEqual(by(k, "manual testing").evidence, "skills");
  assert.strictEqual(by(k, "sql").evidence, "skills");
  assert.strictEqual(by(k, "back end").evidence, "prose", "'verified backend behaviour' does not make a backend developer");
  assert.strictEqual(by(k, "front end").evidence, "prose");
});

test("experience tags are prose, not skills", () => {
  assert.strictEqual(by(read("Requirements\nApplication Support"), "application support").evidence, "prose");
});

test("a skill the profile lacks is 'none'", () => {
  const k = read("Requirements\nSelenium, JIRA and Docker");
  for (const key of ["selenium", "jira", "docker"]) assert.strictEqual(by(k, key).evidence, "none", key);
});

test("wording differences are bridged: 'Microsoft Excel' matches a profile that lists 'Excel'", () => {
  const k = by(read("Requirements\nMicrosoft Excel"), "excel");
  assert.strictEqual(k.evidence, "skills");
});

test("annotateKeywords accepts a plain string as skills evidence", () => {
  const k = api.annotateKeywords(api.extractKeywords("Requirements\nPython, Docker"), "Python");
  assert.strictEqual(by(k, "python").evidence, "skills");
  assert.strictEqual(by(k, "docker").evidence, "none");
});

// ------------------------------------------------------------------ the resume line: never invents
test("pickForResume adds only skills the candidate lists", () => {
  const k = read(QA_POST, "QA Engineer");
  const picked = api.pickForResume(k).map(x => x.key);
  for (const yes of ["manual testing", "regression testing", "scrum"]) assert.ok(picked.includes(yes), `${yes} missing from ${picked}`);
  for (const no of ["jira", "selenium", "communication skills"]) assert.ok(!picked.includes(no), `${no} was added without being claimed`);
});

test("a claimed skill is added, and only that one", () => {
  const k = read(QA_POST, "QA Engineer");
  const picked = api.pickForResume(k, { claimed: ["jira"] }).map(x => x.key);
  assert.ok(picked.includes("jira") && !picked.includes("selenium"));
});

test("prose-only skills need a claim too", () => {
  const k = read("Requirements\nBackend development");
  assert.ok(!api.pickForResume(k).length);
  assert.strictEqual(api.pickForResume(k, { claimed: ["back end"] }).length, 1);
});

test("'off' removes a skill; degrees never appear", () => {
  const k = read("Requirements\nBachelor of Science in Computer Science\nPHP and SQL");
  assert.ok(by(k, "computer science").have);
  const picked = api.pickForResume(k, { off: ["php"] }).map(x => x.key);
  assert.ok(!picked.includes("php") && picked.includes("sql"));
  assert.ok(!picked.includes("computer science") && !picked.includes("bachelor's degree"));
});

test("the line is capped at 14, soft skills at 4", () => {
  const tech = ["PHP", "Python", "Java", "SQL", "MySQL", "HTML", "CSS", "Git", "GitHub", "Docker", "Linux", "Scrum", "Agile", "Kanban", "Selenium", "Cypress"];
  const soft = ["Communication Skills", "Teamwork", "Problem Solving", "Time Management", "Critical Thinking", "Multitasking"];
  const kws = api.extractKeywords("Requirements\n" + [...tech, ...soft].join(", "));
  const all = api.annotateKeywords(kws, [...tech, ...soft].join(" "));
  const picked = api.pickForResume(all);
  assert.strictEqual(picked.length, 14);
  assert.ok(picked.filter(k => k.kind === "soft").length <= 4);
});

// ------------------------------------------------------------------ measuring it
test("coverage is strict about wording: 'Test Case Design' does not satisfy 'Test Cases'", () => {
  const kws = read("Requirements\ntest cases");
  assert.strictEqual(api.keywordCoverage(kws, "Test Case Design").found, 0);
  assert.strictEqual(api.keywordCoverage(kws, "Key Skills: Test Cases").found, 1);
});

test("coverage leaves degrees out and reports must-haves", () => {
  const kws = read("Requirements\nBachelor of Science. Python.\nDuties\nDocker");
  const c = api.keywordCoverage(kws, "Python");
  assert.strictEqual(c.total, 2);
  assert.strictEqual(c.found, 1);
  assert.strictEqual(c.mustTotal, 1);
  assert.strictEqual(c.mustFound, 1);
  assert.deepStrictEqual(c.missing, ["Docker"]);
});

test("keywordHits counts distinct keywords in a bullet", () => {
  const kws = api.extractKeywords("Requirements\nRegression testing, SQL, Docker");
  assert.strictEqual(api.keywordHits("Ran regression testing and wrote SQL queries", kws), 2);
  assert.strictEqual(api.keywordHits("Made tea", kws), 0);
});

// ------------------------------------------------------------------ robustness
test("empty, missing and junk input give an empty list, not an error", () => {
  for (const v of [undefined, null, "", "   ", "\n\n"]) assert.deepStrictEqual(api.extractKeywords(v, v), []);
  assert.ok(Array.isArray(api.extractKeywords("!@#$%^&*()_+ \u0000\u0001", "")));
});

test("large or hostile input stays fast", () => {
  const inputs = ["a".repeat(60000), "Java, SQL and (Excel) - C++ / CI/CD ".repeat(3000), ("Requirements\n" + "Knowledge of X-Y-Z, ".repeat(50) + "\n").repeat(400)];
  for (const text of inputs) {
    const t0 = Date.now();
    api.extractKeywords(text, "x");
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms on ${text.length} chars`);
  }
});

test("results are plain data (safe to keep in React state)", () => {
  const k = read(QA_POST, "QA Engineer");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(k)), k);
});

// ------------------------------------------------------------------ run
let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + String(e.message).split("\n").join("\n     ")); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);

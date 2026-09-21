// Recruiter-keyword extraction. Run by tests/test_keywords.py (or directly: node tests/js/keywords.test.js).
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const api = new Function(fs.readFileSync(path.join(ROOT, "keywords.js"), "utf8") +
  "\nreturn {extractKeywords,keywordEvidence,annotateKeywords,pickForResume,keywordCoverage,keywordHits,kwBuild,normalizeDecisions};")();

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

// ------------------------------------------------------------------ any field: terms read from the post itself
const mined = (text, title = "", company = "") => api.extractKeywords(text, title, company).filter(k => k.source === "mined").map(k => k.display);
const shown = (text, title = "", company = "") => api.extractKeywords(text, title, company).map(k => k.display);

test("a nursing post, a field the built-in list barely knows, still yields its own terms", () => {
  const post = "Staff Nurse\nRequirements\nDiploma in Nursing from a recognised institute.\nExperience in wound care, IV therapy and patient assessment.\nKnowledge of infection control and medication administration.";
  const m = mined(post);
  for (const want of ["Wound Care", "IV Therapy", "Patient Assessment", "Medication Administration"]) assert.ok(m.includes(want), `${want} missing from ${m}`);
  assert.ok(shown(post).includes("Infection Control"), "the built-in list still contributes");
});

test("a factory-maintenance post: what the job is actually about", () => {
  const post = "Technician\nEducational Qualifications\nDiploma\nAdditional Requirements\nKnowledge of mechanical and electrical systems, preventive maintenance, calibration, and servicing.\nHands-on experience in machine changeovers and cleaning & sanitation.\nUnderstanding of GMP, hygiene, machine safety and contamination prevention.";
  const all = shown(post);
  for (const want of ["Preventive Maintenance", "Calibration", "GMP", "Machine Changeovers", "Sanitation", "Machine Safety", "Contamination Prevention"]) assert.ok(all.includes(want), `${want} missing from ${all}`);
});

test("a legal post", () => {
  const post = "Legal Manager\nRequirements\nLL.B degree.\nExperience in corporate governance, competition law and dispute resolution.\nKey Responsibilities\nReview commercial contracts and advise on employment law.";
  const all = shown(post);
  for (const want of ["Corporate Governance", "Competition Law", "Dispute Resolution", "Commercial Contracts", "Employment Law"]) assert.ok(all.includes(want), `${want} missing from ${all}`);
});

test("extraction never depends on the candidate: a post gives the same keywords for everyone", () => {
  const post = "Requirements\nExperience in wound care and patient assessment.\nPython and SQL";
  assert.deepStrictEqual(api.extractKeywords(post, "T"), api.extractKeywords(post, "T"));
  const a = api.annotateKeywords(api.extractKeywords(post, "T"), api.keywordEvidence(profile));
  const b = api.annotateKeywords(api.extractKeywords(post, "T"), api.keywordEvidence({ skills: [], education: [], experience: [], projects: [] }));
  assert.deepStrictEqual(a.map(k => k.key), b.map(k => k.key), "the profile changed which keywords were found");
  assert.ok(a.some(k => k.evidence !== "none") && b.every(k => k.evidence === "none"), "only the evidence grade may differ");
});

test("a lone ordinary word needs the post to point at it", () => {
  assert.ok(mined("Requirements\nStorytelling").includes("Storytelling"), "a short requirement line counts");
  assert.ok(mined("Requirements\nExperience with storytelling and mentoring.").includes("Storytelling"), "so does 'experience with'");
  assert.ok(!mined("Duties\nWe value storytelling. Storytelling is fun.").includes("Storytelling"), "repeating alone is not enough");
});

test("sentences are not requirement bullets: a verb phrase is not a keyword", () => {
  const m = mined("Requirements\nThe RCM team owns billing.\nOur HQ is in ZZQ.");
  assert.ok(!m.some(x => /billing|ZZQ/i.test(x)), m.join());
});

test("job-post boilerplate, titles, places and the company name are never keywords", () => {
  const m = mined("Requirements\nATS Friendly CV in PDF format.\nReporting to the Assistant Manager and Legal Director.\nExperience with delivery in Dhaka, Gulshan and Chattogram.\nExperience with Acme Corp customers.", "", "Acme Corp");
  for (const bad of [/ats|friendly/i, /assistant|manager|director/i, /dhaka|gulshan|chattogram/i, /acme/i]) assert.ok(!m.some(x => bad.test(x)), `${bad} leaked into ${m}`);
});

test("generic nouns alone are not keywords", () => {
  const m = mined("Duties\nOperations, performance, planning, management and training are all part of this. Operations and performance matter.");
  assert.deepStrictEqual(m, []);
});

test("a spelled-out term and its abbreviation are one keyword, not two", () => {
  const k = api.extractKeywords("Requirements\nBachelor of Business Administration (BBA) from a reputed university.");
  assert.ok(k.some(x => x.key === "bba" && x.source === "lexicon"));
  assert.ok(!k.some(x => x.source === "mined" && /bba/i.test(x.display)));
});

test("acronyms the lexicon already handled do not come back in pieces", () => {
  const names = mined("Requirements\nCI/CD pipelines and MS Excel");
  for (const bad of ["CI", "CD", "MS"]) assert.ok(!names.includes(bad), `${bad} leaked`);
});

test("a repeated acronym the list does not know is a keyword", () => {
  assert.ok(mined("Requirements\nThe RCM process is daily.\nRCM reporting is weekly.").includes("RCM"));
});

test("at most 14 terms come from the post itself", () => {
  const post = "Requirements\n" + Array.from({ length: 40 }, (_, i) => `Experience with zorblax${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i * 7) % 26))} handling.`).join("\n");
  assert.ok(mined(post).length <= 14);
});

test("the reader copes with real mixed-field posts: most yield a useful list", () => {
  const feed = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "jobs.json"), "utf8")).jobs.filter(j => (j.description || "").length > 1500);
  assert.ok(feed.length >= 8, "the committed feed has too few long posts to test on");
  let useful = 0;
  for (const j of feed) {
    const k = api.extractKeywords(j.description, j.title, j.company);
    assert.strictEqual(new Set(k.map(x => x.key)).size, k.length, `${j.title}: duplicate keys`);
    assert.ok(k.every(x => x.display && x.display === x.display.trim()), `${j.title}: blank or untrimmed keyword`);
    if (k.length >= 5) useful++;
  }
  assert.ok(useful / feed.length >= 0.9, `only ${useful} of ${feed.length} long posts gave 5+ keywords`);
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

// ------------------------------------------------------------------ the resume line: you decide
test("nothing is on the resume until you press Add", () => {
  const k = read(QA_POST, "QA Engineer");
  assert.deepStrictEqual(api.pickForResume(k, api.normalizeDecisions(undefined)), []);
  assert.deepStrictEqual(api.pickForResume(k, {}), []);
  assert.deepStrictEqual(api.pickForResume(k), []);
});

test("Add puts exactly that keyword on the resume", () => {
  const k = read(QA_POST, "QA Engineer");
  assert.deepStrictEqual(api.pickForResume(k, { added: ["manual testing"] }).map(x => x.key), ["manual testing"]);
});

test("what the profile says never decides: a skill you lack can be added, one you have can be left off", () => {
  const k = read(QA_POST, "QA Engineer");
  assert.strictEqual(by(k, "jira").evidence, "none");
  assert.strictEqual(by(k, "manual testing").evidence, "skills");
  const picked = api.pickForResume(k, { added: ["jira"] }).map(x => x.key);
  assert.deepStrictEqual(picked, ["jira"], "adding is the user's call, in either direction");
  assert.deepStrictEqual(api.pickForResume(k, { added: [], skipped: ["manual testing"] }), []);
});

test("added keywords keep the order a recruiter would care about", () => {
  const k = read(QA_POST, "QA Engineer");
  const asked = ["scrum", "jira", "manual testing"];
  const picked = api.pickForResume(k, { added: asked }).map(x => x.key);
  assert.deepStrictEqual(picked, k.filter(x => asked.includes(x.key)).map(x => x.key));
});

test("degrees are shown but never added, and keys from another post are ignored", () => {
  const k = read("Requirements\nBachelor of Science in Computer Science\nPHP");
  assert.deepStrictEqual(api.pickForResume(k, { added: ["computer science", "php", "not-in-this-post"] }).map(x => x.key), ["php"]);
});

test("there is no cap: everything you add is on the line", () => {
  const tech = ["PHP", "Python", "Java", "SQL", "MySQL", "HTML", "CSS", "Git", "GitHub", "Docker", "Linux", "Scrum", "Agile", "Kanban", "Selenium", "Cypress"];
  const k = api.annotateKeywords(api.extractKeywords("Requirements\n" + tech.join(", ")), "");
  assert.strictEqual(api.pickForResume(k, { added: k.map(x => x.key) }).length, tech.length);
});

test("saved choices: defaults, and older saves carry over", () => {
  assert.deepStrictEqual(api.normalizeDecisions(undefined), { enabled: true, added: [], skipped: [] });
  assert.deepStrictEqual(api.normalizeDecisions(null), { enabled: true, added: [], skipped: [] });
  assert.deepStrictEqual(api.normalizeDecisions({ enabled: false, added: ["a"], skipped: ["b"] }), { enabled: false, added: ["a"], skipped: ["b"] });
  // the first version stored `claimed` (added by hand) and `off` (left out of an automatic list)
  assert.deepStrictEqual(api.normalizeDecisions({ enabled: true, off: ["php"], claimed: ["jira"] }), { enabled: true, added: ["jira"], skipped: ["php"] });
});

test("saved choices: junk and contradictions are cleaned up", () => {
  assert.deepStrictEqual(api.normalizeDecisions({ added: ["a", "a", 7, null, "b"], skipped: ["b", "c"] }), { enabled: true, added: ["a", "b"], skipped: ["c"] });
  assert.deepStrictEqual(api.normalizeDecisions({ added: "nope", skipped: {} }), { enabled: true, added: [], skipped: [] });
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

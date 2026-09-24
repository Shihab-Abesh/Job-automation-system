// Application Pack: cover letter, email, recruiter message, salary suggestion, documents, checklist,
// tailoring report. Run by tests/test_keywords.py (or directly: node tests/js/applypack.test.js).
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const api = new Function(
  fs.readFileSync(path.join(ROOT, "keywords.js"), "utf8") + "\n" + fs.readFileSync(path.join(ROOT, "applypack.js"), "utf8") +
  "\nreturn {extractKeywords,keywordEvidence,annotateKeywords,analyzeRequirements,keywordCoverage,pickForResume,buildApplicationPack," +
  "buildCoverLetter,buildEmailDraft,buildRecruiterMessage,suggestSalary,requiredDocuments,suggestFilename,tailoringReport," +
  "buildChecklist,rankExperience,educationLabel,apClip,apSlug,apCountPlaceholders,apWords};")();

const BULLET_TEST = "Surfaced dozens of defects on a live website rebuild by designing and executing functional test cases covering UI verification, form validation and cross-browser behaviour, all reported before client delivery.";
const BULLET_MEET = "Turned client needs into testable checks by taking part in requirement meetings, Scrum meetings and project meetings with developers, designers and the project manager.";
const BULLET_SQL = "Improved query performance by writing and tuning complex SQL with joins, subqueries and stored procedures.";

const profile = {
  personal: { fullName: "Test Person", phone: "01700000000", email: "test@example.com" },
  skills: [{ category: "Testing", items: ["Manual Testing", "Regression Testing", "Scrum"] }, { category: "Databases", items: ["SQL", "MySQL"] },
    { category: "Tools", items: ["Microsoft Office (Excel, Word)"] }],
  education: [{ degree: "Bachelor of Science in Computer Science and Engineering", institution: "AIUB", date: "Expected October 2026" }],
  experience: [{ role: "Software Quality Assurance Intern", company: "Innolytic IT Ltd.", bullets: [BULLET_TEST, BULLET_MEET], tags: [] }],
  projects: [{ name: "Payroll System", subtitle: "Oracle Database Project", bullets: [BULLET_SQL], skills: ["SQL"] }],
  preferences: { locations: ["Dhaka, Bangladesh"], experienceYears: 0, expectedSalaryMin: 30000 }
};
const evidence = api.keywordEvidence(profile);

const QA_POST = `Requirements
Bachelor's degree in Computer Science required.
Hands-on experience in manual testing, regression testing and SQL.
Experience with JIRA for bug tracking.

Responsibilities
Write SQL queries to check test data.
Execute test cases and report defects.
Acme Ltd is offering an opportunity to grow your career.`;

const pack = (text, job = {}, prof = profile, extra = {}) => {
  const kws = api.annotateKeywords(api.extractKeywords(text, job.title, job.company), api.keywordEvidence(prof));
  const addedKw = extra.addedKw !== undefined ? extra.addedKw : kws.filter(k => k.evidence === "skills" && k.kind !== "degree");
  const requirements = api.analyzeRequirements(kws, text, job.title, job, prof);
  return { kws, addedKw, requirements, out: api.buildApplicationPack({ profile: prof, job, kws, addedKw, text, date: "2026-09-24", requirements,
    coverBefore: { found: 2, total: 8 }, coverNow: { found: 5, total: 8 }, score: 71 }) };
};
const JOB = { title: "QA Engineer", company: "Zorblax Ltd", url: "https://example.org/j", deadline: "2026-10-05", location: "Dhaka, Bangladesh" };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const BANNED = /excited|thrilled|passionate|I am writing to|I am pleased to/i;

// ------------------------------------------------------------------ the cover letter
test("three short paragraphs, 120-180 words, no boilerplate opener", () => {
  const { out } = pack(QA_POST, JOB);
  const c = out.coverLetter;
  assert.strictEqual(c.body.split("\n\n").length, 3);
  assert.ok(c.words >= 120 && c.words <= 180, `${c.words} words`);
  assert.ok(c.inRange);
  assert.ok(!BANNED.test(c.text), c.text);
});

test("the company and role are mentioned naturally, and nothing else is said about the company", () => {
  const { out } = pack(QA_POST, JOB);
  const t = out.coverLetter.text;
  assert.ok(t.includes("QA Engineer") && t.includes("Zorblax Ltd"));
  // every mention of the company is the greeting, the opening line, or the placeholder that asks YOU for the reason
  const stripped = t.replace("Dear Zorblax Ltd Hiring Team,", "").replace("at Zorblax Ltd.", "").replace(/\[EDIT THIS[^\]]*\]/g, "");
  assert.ok(!stripped.includes("Zorblax"), `an unexpected claim about the company: ${stripped}`);
  assert.ok(/\[EDIT THIS: one specific thing about Zorblax Ltd/.test(t));
});

test("the achievements are real bullets from the profile, only ever shortened at their end", () => {
  const { out } = pack(QA_POST, JOB);
  const bullets = [BULLET_TEST, BULLET_MEET, BULLET_SQL].map(b => b.toLowerCase());
  const clause = out.coverLetter.body.split("\n\n")[1].replace(/^[^:]+:\s*/, "");
  const parts = clause.replace(/\.$/, "").split("; and ");
  assert.strictEqual(parts.length, 2);
  for (const part of parts) {
    assert.ok(bullets.some(b => b.startsWith(part.toLowerCase().slice(0, 40))), `not from your resume: ${part}`);
    assert.ok(bullets.some(b => b.includes(part.toLowerCase())), `reworded, not just shortened: ${part}`);
  }
});

test("a duty is quoted only when it holds something really in the profile, and never the company's own blurb", () => {
  const withOverlap = pack(QA_POST, JOB).out.coverLetter.text;
  assert.ok(/The duty in your post that matches my background most closely is "Write SQL queries to check test data"/.test(withOverlap), withOverlap);
  assert.ok(!/is offering an opportunity/.test(withOverlap), "quoted the company's own blurb");
  const noSql = { ...profile, skills: [{ category: "Testing", items: ["Manual Testing"] }], projects: [] };
  const without = pack("Requirements\nExperience with JIRA.\nResponsibilities\nManage vendor contracts and budgets.", JOB, noSql).out.coverLetter.text;
  assert.ok(!/The duty in your post/.test(without), "claimed a duty matched a background it does not");
});

test("if the post asks for multitasking, the letter shows evidence rather than only naming it", () => {
  const post = QA_POST + "\nMulti-tasking across several projects is essential.";
  const t = pack(post, JOB).out.coverLetter.text;
  assert.ok(/You ask for multitasking; rather than just say it, here is what I did in my Software Quality Assurance Intern role at Innolytic IT Ltd/.test(t), t);
  assert.ok(!/You ask for multitasking/.test(pack(QA_POST, JOB).out.coverLetter.text), "mentioned multitasking when the post did not");
});

test("'multi-tasking' as a job post spells it is recognised as the multitasking skill", () => {
  const k = api.extractKeywords("Requirements\nMulti-tasking is a must.\nAbility to manage multiple priorities.");
  assert.ok(k.some(x => x.key === "multitasking"));
});

test("the biggest asks come from the built-in list, not employer jargon mined from the post", () => {
  const post = "Requirements\nPython, SQL and Excel required.\nFunctional Stint report every month.\nFunctional Stint results are reviewed.";
  const t = pack(post, JOB).out.coverLetter.text;
  assert.ok(/biggest asks are/.test(t));
  assert.ok(!/Functional Stint/.test(t.split("\n\n")[0]), "employer jargon listed as a top ask");
});

test("what the profile cannot supply becomes a placeholder, never an invented fact", () => {
  const empty = { personal: {}, skills: [], education: [], experience: [], projects: [], preferences: {} };
  const { out } = pack(QA_POST, { title: "QA Engineer", company: "" }, empty);
  const t = out.coverLetter.text;
  for (const need of ["company name", "add two achievements from your resume", "your name"]) assert.ok(t.includes(need), `no placeholder for: ${need}`);
  assert.ok(out.coverLetter.words < 120 && out.coverLetter.notes.some(n => /Short by design/.test(n)), "should say it is short rather than pad");
  assert.ok(!/undefined|null|NaN/.test(t));
});

test("a degree that is only expected is never called earned", () => {
  assert.ok(/student \(degree expected October 2026\)/.test(api.educationLabel(profile)));
  assert.ok(!/graduate/.test(api.educationLabel(profile)));
  const done = { education: [{ degree: "BBA in Marketing", date: "2024" }] };
  assert.strictEqual(api.educationLabel(done), "Marketing graduate");
  assert.ok(!/graduate/.test(pack(QA_POST, JOB).out.coverLetter.text));
});

test("apClip only removes the end of a sentence, never rewords it, and never ends on a dangling word", () => {
  for (const limit of [8, 12, 16, 24]) {
    const clipped = api.apClip(BULLET_TEST, limit);
    assert.ok(BULLET_TEST.startsWith(clipped), `changed the wording: ${clipped}`);
    assert.ok(clipped.split(" ").length <= limit);
    assert.ok(!/\b(and|or|of|the|a|an|to|for|with|by|in|on|at)$/i.test(clipped), `dangling: ${clipped}`);
  }
});

// ------------------------------------------------------------------ email and recruiter message
test("email: uses the address in the post, else asks for it; attaches a cover letter only when the post wants one", () => {
  const withMail = pack("Send your CV and cover letter to hr@zorblax.com by 5 October.\nRequirements\nSQL required.", JOB).out.email;
  assert.strictEqual(withMail.to, "hr@zorblax.com");
  assert.ok(/resume and cover letter are attached/.test(withMail.body));
  const without = pack(QA_POST, JOB).out.email;
  assert.ok(/\[EDIT THIS: recipient email/.test(without.to));
  assert.ok(/My resume is attached/.test(without.body) && !/cover letter/.test(without.body));
  assert.ok(/^Application for QA Engineer - Test Person$/.test(without.subject));
});

test("recruiter message stays under 300 characters, even with a very long company and title", () => {
  const long = { title: "Senior Executive, Regional Business Development and Strategic Partnerships (Retail & Distribution)", company: "The Very Long Named International Trading And Distribution Company Limited (Bangladesh)" };
  for (const job of [JOB, long]) {
    const m = pack(QA_POST, job).out.recruiter;
    assert.ok(m.chars <= 300 && m.text.length === m.chars, `${m.chars} chars`);
    assert.ok(/I've applied for the/.test(m.text));
  }
});

// ------------------------------------------------------------------ salary
test("salary: your minimum against the post's range, never a guess, never above the post's maximum", () => {
  const s = (job, expected) => api.suggestSalary(job, { preferences: { expectedSalaryMin: expected } });
  assert.strictEqual(s({}, null).state, "unknown");
  assert.strictEqual(s({}, null).amount, null);
  assert.strictEqual(s({ salaryMin: 20000, salaryMax: 30000 }, null).amount, null, "guessed with no expectation set");
  assert.deepStrictEqual([s({ salaryText: "Negotiable" }, 30000).state, s({ salaryText: "Negotiable" }, 30000).amount], ["anchor", 30000]);
  assert.strictEqual(s({ salaryMin: 25000, salaryMax: 50000 }, 30000).amount, 30000);
  assert.strictEqual(s({ salaryMin: 40000, salaryMax: 50000 }, 30000).amount, 40000, "should ask at least the post's own minimum");
  assert.strictEqual(s({ salaryMin: 20000, salaryMax: 25000 }, 30000).state, "below");
  assert.strictEqual(s({ salaryMin: 20000, salaryMax: 25000 }, 30000).amount, 30000);
  for (const [min, max, exp] of [[10000, 20000, 15000], [35000, 45000, 30000], [50000, 50000, 40000]]) {
    const r = s({ salaryMin: min, salaryMax: max }, exp);
    if (r.state === "inside") assert.ok(r.amount <= max && r.amount >= exp);
  }
});

// ------------------------------------------------------------------ documents, filename, checklist
test("documents: the resume is always listed; others only when the post names them", () => {
  assert.deepStrictEqual(api.requiredDocuments("Requirements\nSQL required.").map(d => d.key), ["cv"]);
  const found = api.requiredDocuments("Send your CV, a cover letter, recent photograph, NID copy, academic transcripts, experience certificate and expected salary.").map(d => d.key);
  for (const key of ["cv", "cover", "photo", "nid", "academic", "experience", "expsalary"]) assert.ok(found.includes(key), key);
});

test("filename: resume_company_role_date, slugged, cut at a word not through one", () => {
  assert.strictEqual(api.suggestFilename(profile, JOB, "2026-09-24"), "resume_zorblax-ltd_qa-engineer_2026-09-24.pdf");
  const long = api.suggestFilename(profile, { title: "Management Trainee Officer", company: "New Zealand Dairy Products (BD) Limited" }, "2026-09-24");
  assert.ok(/^resume_new-zealand-dairy_management-trainee-officer_2026-09-24\.pdf$/.test(long), long);
  assert.strictEqual(api.suggestFilename(profile, { title: "", company: "" }, "2026-09-24"), "resume_company_role_2026-09-24.pdf");
  assert.strictEqual(api.apSlug("Ünïcode & Co."), "unicode-co");
});

test("checklist ticks itself: placeholders left, cover letter needed or optional, a passed deadline warns", () => {
  const p = pack(QA_POST, JOB).out;
  const texts = { coverLetter: p.coverLetter.text, email: p.email.text, recruiter: p.recruiter.text };
  const base = { job: JOB, texts, docs: p.docs, filename: p.filename, needsCoverLetter: false, applyEmail: null, today: "2026-09-24" };
  const by = (items, key) => items.find(i => i.key === key);
  const open = api.buildChecklist(base);
  assert.strictEqual(by(open, "placeholders").state, "todo");
  assert.strictEqual(by(open, "cover").state, "info", "optional cover letter should not nag");
  assert.strictEqual(by(open, "deadline").state, "info");
  assert.ok(/11 days left/.test(by(open, "deadline").note));
  const filled = { coverLetter: "done", email: "done", recruiter: "done" };
  const done = api.buildChecklist({ ...base, texts: filled, needsCoverLetter: true });
  assert.strictEqual(by(done, "placeholders").state, "done");
  assert.strictEqual(by(done, "cover").state, "done");
  assert.strictEqual(by(api.buildChecklist({ ...base, job: { ...JOB, deadline: "2026-09-01" } }), "deadline").state, "warn");
  assert.strictEqual(by(api.buildChecklist({ ...base, job: { ...JOB, url: "" } }), "url").state, "warn");
  assert.strictEqual(by(api.buildChecklist({ ...base, job: { ...JOB, url: "" }, applyEmail: "hr@x.com" }), "url").state, "info");
  assert.strictEqual(by(api.buildChecklist({ ...base, needsCoverLetter: true }), "cover").state, "todo");
});

// ------------------------------------------------------------------ the tailoring report
test("report: keywords added, real gaps (with years), and before/after coverage", () => {
  const post = "Requirements\nMinimum 3 years of JIRA experience required.\nSQL required.\nSelenium is a plus.\nBachelor degree in Business Administration required.";
  const { out, kws, addedKw } = pack(post, JOB);
  const r = out.report;
  assert.deepStrictEqual(r.keywordsAdded, addedKw.map(k => k.display));
  assert.ok(r.gaps.some(g => /JIRA \(asks 3\+ yrs\): not in your profile/.test(g)), JSON.stringify(r.gaps));
  assert.ok(!r.gaps.some(g => /^SQL/.test(g)), "listed a skill you have as a gap");
  assert.ok(!r.gaps.some(g => /^Selenium/.test(g)), "a nice-to-have is not an important gap");
  assert.ok(r.gaps.some(g => /^Education:/.test(g)), "a degree gap should be reported");
  assert.deepStrictEqual([r.matchBefore, r.matchAfter, r.roleFit], [25, 63, 71]);
  assert.ok(kws.length > 0);
});

test("report: a skill you have but with fewer years than asked is still a gap, worded honestly", () => {
  const { out } = pack("Requirements\nMinimum 3 years of SQL experience required.", JOB);
  assert.ok(out.report.gaps.some(g => /^SQL: asks 3\+ yrs; your stated experience is 0$/.test(g)), JSON.stringify(out.report.gaps));
});

// ------------------------------------------------------------------ experience order
test("experience is ordered most relevant first, ties keep your own order", () => {
  const exp = [
    { role: "Cashier", company: "Shop", bullets: ["Handled cash."] },
    { role: "QA Intern", company: "Acme", bullets: ["Ran regression testing and manual testing."] },
    { role: "Clerk", company: "Office", bullets: ["Filed papers."] }
  ];
  const kws = api.annotateKeywords(api.extractKeywords("Requirements\nRegression testing and manual testing required."), "");
  assert.deepStrictEqual(api.rankExperience(exp, kws).map(x => x.role), ["QA Intern", "Cashier", "Clerk"]);
  assert.deepStrictEqual(api.rankExperience(exp, []).map(x => x.role), ["Cashier", "QA Intern", "Clerk"]);
});

// ------------------------------------------------------------------ robustness, and real posts
test("nothing in any generated text is undefined, null, NaN or an unclosed placeholder", () => {
  for (const text of [QA_POST, "", "   ", "Requirements\nSQL.", "x".repeat(5000)]) {
    const { out } = pack(text, text ? JOB : {});
    const all = [out.coverLetter.text, out.email.text, out.recruiter.text, out.filename, out.salary.note].join("\n");
    assert.ok(!/undefined|\bnull\b|NaN/.test(all), all);
    assert.strictEqual((all.match(/\[EDIT THIS/g) || []).length, (all.match(/\[EDIT THIS[^\]]*\]/g) || []).length, "unclosed placeholder");
  }
});

test("results are plain data (safe to keep in React state)", () => {
  const { out } = pack(QA_POST, JOB);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), out);
});

test("every real job in the committed feed gets a pack: letter in range or explained, no boilerplate, no junk", () => {
  const feed = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "jobs.json"), "utf8")).jobs;
  assert.ok(feed.length >= 10);
  for (const j of feed) {
    const { out } = pack(j.description, j);
    const c = out.coverLetter;
    assert.ok(c.inRange || c.notes.length, `${j.title}: ${c.words} words with no explanation`);
    assert.ok(c.words <= 180, `${j.title}: ${c.words} words`);
    assert.ok(!BANNED.test(c.text), j.title);
    assert.ok(out.recruiter.chars <= 300, j.title);
    assert.ok(!/undefined|\bnull\b|NaN/.test(c.text + out.email.text), j.title);
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

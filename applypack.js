/* Application Pack: everything you need to apply for ONE job, built from your Master Profile and the
   post's own words. Pure functions, no DOM, so tests/test_keywords.py runs them under Node. index.html
   loads this after keywords.js, whose keywordHits / extractResponsibilities it reuses.

   There is no model behind this: it is a static page. So every sentence is either
     - a template filled with a fact from your profile,
     - a line quoted from the post, or
     - an [EDIT THIS: ...] placeholder where the fact is one only you can supply.
   It never rewrites a bullet in new words (that is where invented claims creep in) and it never
   states anything about a company the post did not say. Nothing here sends anything anywhere.
*/

const AP_EDIT="[EDIT THIS";
const apPh=msg=>`${AP_EDIT}: ${msg}]`;

// ---------------------------------------------------------------- small helpers

function apWords(s){return (String(s||"").match(/\S+/g)||[]).length}
function apCountPlaceholders(text){return (String(text||"").match(/\[EDIT THIS/g)||[]).length}
function apList(a){
 a=(a||[]).filter(Boolean);
 return a.length<=1?(a[0]||""):a.length===2?`${a[0]} and ${a[1]}`:`${a.slice(0,-1).join(", ")} and ${a[a.length-1]}`;
}
function apSlug(s,max=24){
 const full=String(s||"").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
 if(full.length<=max)return full;
 let cut=full.slice(0,max);
 if(full[max]!=="-"&&cut.includes("-"))cut=cut.replace(/-[^-]*$/,"");   // never end on half a word
 return cut.replace(/-+$/,"");
}
function apIsoDate(d){
 if(typeof d==="string"&&/^\d{4}-\d{2}-\d{2}/.test(d))return d.slice(0,10);
 const x=d instanceof Date?d:new Date();
 const two=n=>String(n).padStart(2,"0");
 return `${x.getFullYear()}-${two(x.getMonth()+1)}-${two(x.getDate())}`;
}
function apCompany(job){const c=String((job&&job.company)||"").trim();return c&&!/^unknown company$/i.test(c)?c:""}
function apTitleOf(job){return String((job&&job.title)||"").trim()}
const apNoDot=s=>String(s||"").replace(/\.+$/,"");
const apEnd=s=>/[.!?]$/.test(s)?s:s+".";
const apA=w=>/^[aeiou]/i.test(w)?"an":"a";
function apClipChars(s,max){s=String(s||"");return s.length<=max?s:s.slice(0,max-1).replace(/\s+\S*$/,"")+"…"}

// A bullet, shortened only at a clause boundary and never reworded: dropping the tail of a true
// sentence keeps it true; paraphrasing it would not.
function apClip(text,maxWords){
 const t=String(text||"").trim().replace(/\s+/g," ").replace(/[.;:,\s]+$/,"");
 const words=t.split(" ");
 if(words.length<=maxWords)return t;
 const head=words.slice(0,maxWords).join(" ");
 const cut=Math.max(head.lastIndexOf(", "),head.lastIndexOf("; "),head.lastIndexOf(" by "),head.lastIndexOf(" covering "),head.lastIndexOf(" while "),head.lastIndexOf(" and "));
 let out=cut>head.length*0.5?head.slice(0,cut):head;
 out=out.replace(/[\s,;:]+$/,"");
 for(let i=0;i<3;i++)out=out.replace(/\s+(and|or|of|the|a|an|to|for|with|by|in|on|at|as|from)$/i,"");
 return out.trim();
}
// "Surfaced dozens..." reads fine after a colon as "surfaced dozens...", but "SQL" and "iOS" must keep their capitals.
function apLowerFirst(s){
 s=String(s||"");
 const first=s.split(/\s+/)[0]||"";
 if(/^[A-Z]{2,}\b/.test(first)||/[A-Z].*[A-Z]/.test(first.slice(1)))return s;
 return s.charAt(0).toLowerCase()+s.slice(1);
}

// "Bachelor of Science in Computer Science and Engineering", date "Expected October 2026" must not
// become "graduate": nothing here may claim a degree that has not been earned yet.
function apField(degree){return String(degree||"").replace(/^.*?\bin\s+/i,"").trim()}
function educationLabel(profile){
 const e=((profile&&profile.education)||[])[0];
 if(!e||!e.degree)return "";
 const field=apField(e.degree)||e.degree;
 const date=String(e.date||"");
 if(/expected/i.test(date)){
  const when=date.replace(/expected/i,"").trim();
  return `${field} student${when?` (degree expected ${when})`:""}`;
 }
 return `${field} graduate`;
}

// ---------------------------------------------------------------- what the post needs, what you have

// Soft skills are real needs, but "communication" as a job's biggest ask says little; list hard
// requirements first.
function apNeedsAndMine(kws,addedKw){
 const added=new Set((addedKw||[]).map(k=>k.key));
 const pool=(kws||[]).filter(k=>k.kind!=="degree");
 const ranked=pool.filter(k=>k.tier==="must"||k.tier==="important");
 // Terms from the built-in list first; a phrase mined from the post ("Functional Stint") is often the
 // employer's own jargon and only fills in when the list found fewer than three.
 const lex=k=>k.source==="lexicon";
 const needs=[...ranked.filter(k=>lex(k)&&k.kind!=="soft"),...ranked.filter(k=>lex(k)&&k.kind==="soft"),...ranked.filter(k=>!lex(k))].slice(0,3);
 const isMine=k=>added.has(k.key)||k.evidence==="skills";
 const mine=pool.filter(isMine);
 const overlap=needs.filter(isMine).slice(0,2);
 return {needs,mine,overlap};
}

// Two real bullets from the profile, ranked by how many of the post's keywords they contain.
function apAchievements(p,kws,addedKw,n=2,experienceOnly=false){
 const pool=(kws||[]).filter(k=>k.kind!=="degree");
 let cands=[];
 ((p&&p.experience)||[]).forEach((x,xi)=>(x.bullets||[]).forEach((b,bi)=>{
  if(String(b||"").trim())cands.push({text:String(b).trim(),src:{kind:"experience",role:x.role||"",company:x.company||""},order:xi*100+bi,bonus:1});
 }));
 ((p&&p.projects)||[]).forEach((x,xi)=>(x.bullets||[]).forEach((b,bi)=>{
  if(String(b||"").trim())cands.push({text:String(b).trim(),src:{kind:"project",name:x.name||""},order:1000+xi*100+bi,bonus:0});
 }));
 // Asked for multitasking: the evidence is what you did in a real role, so draw from that when there is enough of it.
 if(experienceOnly&&cands.filter(c=>c.src.kind==="experience").length>=n)cands=cands.filter(c=>c.src.kind==="experience");
 for(const c of cands){
  c.hits=keywordHits(c.text,pool);
  c.added=keywordHits(c.text,addedKw||[]);
  c.score=c.hits*3+c.added*2+c.bonus;
 }
 const ranked=[...cands].sort((a,b)=>b.score-a.score||a.order-b.order);
 const matched=ranked.filter(c=>c.hits>0).slice(0,n);
 // Too few bullets match: fall back to your strongest general experience, and say so, rather than pad.
 const picked=matched.length>=n?matched:[...matched,...ranked.filter(c=>!matched.includes(c)&&c.src.kind==="experience")].slice(0,n);
 return {picked,matchedCount:matched.length};
}
function apContext(picked){
 const s=picked.map(c=>c.src);
 if(!s.length)return "my resume";
 if(s.every(x=>x.kind==="experience"&&x.role===s[0].role&&x.company===s[0].company)){
  const role=s[0].role,co=apNoDot(s[0].company);
  return role&&co?`my ${role} role at ${co}`:role?`my ${role} role`:co?`my work at ${co}`:"my resume";
 }
 if(s.every(x=>x.kind==="project"&&x.name===s[0].name)&&s[0].name)return `my ${s[0].name} project`;
 return "my resume";
}

// ---------------------------------------------------------------- cover letter

const AP_MULTITASK_RE=/multi[-\s]?task|multiple (?:tasks|priorities|projects)|several (?:tasks|projects)/i;

// Three short paragraphs, 120-180 words: why your background fits their biggest need; two achievements
// that are really on your resume; why this role, with the company-specific part left as a placeholder,
// because nothing about a company is knowable from a post that does not say it.
function buildCoverLetter(ctx){
 const {profile,job,kws,addedKw,text}=ctx;
 const p=profile||{},personal=p.personal||{};
 const company=apCompany(job),title=apTitleOf(job);
 const {needs,mine,overlap}=apNeedsAndMine(kws,addedKw);
 const edu=educationLabel(p);
 const wantsMulti=(kws||[]).some(k=>k.key==="multitasking")||AP_MULTITASK_RE.test(String(text||""));
 const {picked,matchedCount}=apAchievements(p,kws,addedKw,2,wantsMulti);
 const coLow=kwNorm(company).toLowerCase();
 const isBlurb=d=>(coLow&&kwNorm(d).toLowerCase().includes(coLow))||/^(we|our|the company|this is)\b/i.test(d)||/\b(is|are) (offering|looking|seeking|hiring|recruiting)\b/i.test(d);
 // A duty is quoted only when it contains something that is really in your profile; "matches my
 // background" must never be said about a duty whose keywords you do not have.
 const duties=extractResponsibilities(text,12).filter(d=>!isBlurb(d)).map(d=>({d,hits:keywordHits(d,mine)}));
 const bestDuty=duties.length?[...duties].sort((a,b)=>b.hits-a.hits)[0]:null;

 const compose=o=>{
  const co=company||apPh("company name"),ti=title||apPh("role");
  const p1=[`I'm applying for the ${ti} role at ${co}.`];
  if(o.edu&&edu)p1.push(`I'm a ${edu}.`);
  p1.push(needs.length?`Your post's biggest ${needs.length>1?"asks are":"ask is"} ${apList(needs.map(k=>k.display))}.`:apPh("name what this role needs most, from the post")+".");
  if(overlap.length)p1.push(`${apList(overlap.map(k=>k.display))} ${overlap.length>1?"are":"is"} already part of my toolkit.`);
  else if(mine.length&&needs.length)p1.push(`What I can already show is ${apList(mine.slice(0,2).map(k=>k.display))}.`);
  else if(needs.length)p1.push(apPh("name the requirement in your post that you can speak to most directly")+".");

  let p2;
  if(!picked.length)p2=apPh("add two achievements from your resume that match this post")+".";
  else{
   const cx=apContext(picked);
   const lead=wantsMulti&&picked.some(c=>c.src.kind==="experience")
    ?`You ask for multitasking; rather than just say it, ${cx==="my resume"?"here is what I have done":"here is what I did in "+cx}:`
    :`${picked.length>1?"Two examples":"One example"} from ${cx}:`;
   const parts=picked.map(c=>apLowerFirst(apClip(c.text,o.clip)));
   p2=`${lead} ${parts.length>1?`${parts[0]}; and ${parts[1]}`:parts[0]}.`;
  }

  const p3=[];
  if(bestDuty&&bestDuty.hits>0&&o.resp>0){
   p3.push(`The duty in your post that matches my background most closely is "${apClip(bestDuty.d,o.resp)}".`);
  }
  p3.push(apPh(`one specific thing about ${company||"the company"} that draws you to it, such as a product, project or value you actually looked up`)+".");
  p3.push("I would welcome a conversation about how I can help.");

  const body=[p1.join(" "),p2,p3.join(" ")].join("\n\n");
  return {body,words:apWords(body)};
 };

 const steps=[{clip:28,resp:16,edu:true},{clip:24,resp:14,edu:true},{clip:20,resp:12,edu:true},{clip:16,resp:10,edu:true},{clip:14,resp:8,edu:false},{clip:12,resp:6,edu:false},{clip:10,resp:0,edu:false}];
 let out;
 for(const o of steps){out=compose(o);if(out.words<=180)break;}

 const notes=[];
 if(out.words<120)notes.push(`Short by design (${out.words} words): ${matchedCount<2?"few of your resume bullets match this post, so ":""}nothing was added just to reach 120. Add real detail where you see [EDIT THIS].`);
 if(out.words>180)notes.push(`Over 180 words (${out.words}) even after trimming; shorten the [EDIT THIS] lines when you fill them in.`);
 if(picked.length&&matchedCount<Math.min(2,picked.length))notes.push("Some bullets are your strongest general examples, not close matches to this post.");

 const name=String(personal.fullName||"").trim()||apPh("your name");
 const contact=[personal.phone,personal.email].filter(Boolean).join(" | ");
 const full=`Dear ${company?company+" Hiring Team":"Hiring Team"},\n\n${out.body}\n\nSincerely,\n${name}${contact?"\n"+contact:""}`;
 return {text:full,body:out.body,words:out.words,inRange:out.words>=120&&out.words<=180,notes};
}

// The three paragraphs only, without the greeting and sign-off, so an edited letter is measured the
// same way the generated one is.
function coverLetterBodyWords(text){
 let t=String(text||"").replace(/\r/g,"").replace(/^\s*Dear[^\n]*\n+/i,"");
 const i=t.search(/\n\s*(Sincerely|Best regards|Kind regards|Yours sincerely|Regards),?\s*(\n|$)/i);
 if(i>=0)t=t.slice(0,i);
 return apWords(t);
}

// ---------------------------------------------------------------- email and recruiter message

const AP_EMAIL_RE=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
function findApplyEmail(text){const m=AP_EMAIL_RE.exec(String(text||""));return m?m[0]:null}

function buildEmailDraft(ctx){
 const {profile,job,kws,addedKw,text,filename,coverAttached}=ctx;
 const personal=(profile&&profile.personal)||{};
 const company=apCompany(job),title=apTitleOf(job);
 const {overlap}=apNeedsAndMine(kws,addedKw);
 const edu=educationLabel(profile);
 const to=findApplyEmail(text)||apPh("recipient email from the post");
 const subject=`Application for ${title||apPh("role")} - ${String(personal.fullName||"").trim()||apPh("your name")}`;
 const attach=coverAttached?"My resume and cover letter are attached":"My resume is attached";
 const intro=edu?(overlap.length?`I'm a ${edu}; my overlap with your post is strongest on ${apList(overlap.map(k=>k.display))}.`:`I'm a ${edu}.`):"";
 const contact=[personal.phone,personal.email].filter(Boolean).join(" | ");
 const body=[
  "Dear Hiring Team,",
  `I'm applying for the ${title||apPh("role")} position${company?` at ${company}`:""}. ${attach}${filename?` (${filename})`:""}.`,
  intro,
  `I'm available for an interview at your convenience.${contact?` You can reach me at ${contact}.`:""}`,
  `Best regards,\n${String(personal.fullName||"").trim()||apPh("your name")}`
 ].filter(Boolean).join("\n\n");
 return {to,subject,body,text:`To: ${to}\nSubject: ${subject}\n\n${body}`,words:apWords(body)};
}

// Under 300 characters (a LinkedIn connection note's limit), with the company/title kept whole.
function buildRecruiterMessage(ctx){
 const {profile,job,kws,addedKw}=ctx;
 const company=apClipChars(apCompany(job)||"the company",50),title=apClipChars(apTitleOf(job)||"open",60);
 const head=`Hi ${apPh("name")}, I've applied for the ${title} role at ${company}.`;
 const tail=" Happy to share my resume or answer any questions.";
 const edu=educationLabel(profile);
 const exp=((profile&&profile.experience)||[])[0];
 const {overlap}=apNeedsAndMine(kws,addedKw);
 const role=exp&&exp.role?`I've worked as ${apA(exp.role)} ${exp.role}`:"";
 const variants=[
  [edu&&`I'm a ${edu}`,role,overlap.length&&`strongest overlap: ${apList(overlap.map(k=>k.display))}`],
  [edu&&`I'm a ${edu}`,overlap.length&&`strongest overlap: ${apList(overlap.map(k=>k.display))}`],
  [edu&&`I'm a ${edu}`],
  []
 ];
 for(const v of variants){
  const bits=v.filter(Boolean);
  const msg=head+(bits.length?` ${bits.join("; ")}.`:"")+tail;
  if(msg.length<=300)return {text:msg,chars:msg.length};
 }
 const msg=(head+tail).slice(0,300);
 return {text:msg,chars:msg.length};
}

// ---------------------------------------------------------------- salary, documents, filename

// Your rule, plus the post's number: ask the higher of your own minimum and the post's minimum, never
// above the post's maximum. With no expected salary set there is nothing to anchor on, so no guess.
function suggestSalary(job,profile){
 const expected=Number(profile&&profile.preferences&&profile.preferences.expectedSalaryMin)||null;
 const min=job&&job.salaryMin!=null?Number(job.salaryMin):null,max=job&&job.salaryMax!=null?Number(job.salaryMax):null;
 const posted=min!=null||max!=null;
 const fmt=n=>Number(n).toLocaleString("en-US")+" Tk";
 const range=posted?(min!=null&&max!=null&&min!==max?`${fmt(min)} to ${fmt(max)}`:fmt(min!=null?min:max)):"";
 if(!expected&&!posted)return {state:"unknown",amount:null,note:"Set an expected salary in Career Preferences to get a suggestion. The post does not state pay."};
 if(!expected)return {state:"unknown",amount:null,note:`The post offers ${range}. Set an expected salary in Career Preferences and this will suggest a figure.`};
 if(!posted)return {state:"anchor",amount:expected,note:`The post lists pay as "${(job&&job.salaryText)||"not stated"}", so your ${fmt(expected)} minimum is the anchor.`};
 const top=max!=null?max:min,bottom=min!=null?min:max;
 if(top<expected)return {state:"below",amount:expected,note:`The post's pay tops out at ${fmt(top)}, below your ${fmt(expected)} minimum. Ask for your minimum, or decide whether it is worth applying.`};
 const amount=Math.min(Math.max(expected,bottom),top);
 return {state:"inside",amount,note:`Inside the post's ${range}: the higher of your ${fmt(expected)} minimum and the post's own minimum.`};
}

const AP_DOCS=[
 ["cv","Resume / CV",/\b(resume|cv|curriculum vitae)\b/i],
 ["cover","Cover letter",/\b(cover(?:ing)? letter|motivation letter|letter of interest)\b/i],
 ["photo","Recent photograph",/\b(photograph|passport[- ]size (?:photo|picture)|recent photo)\b/i],
 ["nid","National ID / passport copy",/\b(national id|nid\b|passport copy|copy of (?:your )?passport)/i],
 ["academic","Academic certificates / transcripts",/\b(academic (?:certificate|transcript)s?|transcripts?|mark ?sheets?|educational certificates?|testimonials?)\b/i],
 ["experience","Experience certificate",/\bexperience (?:certificate|letter)s?\b/i],
 ["expsalary","Expected salary stated in the application",/\b(expected salary|salary expectation|expected pay)\b/i],
 ["cursalary","Current salary stated in the application",/\b(current salary|present salary)\b/i],
 ["portfolio","Portfolio / work samples / GitHub",/\b(portfolio|work samples?|github)\b/i],
 ["refs","References",/\b(references?|referees?)\b/i]
];
// The resume is always on the list; anything else only when the post itself mentions it.
function requiredDocuments(text){
 const t=String(text||"");
 return AP_DOCS.filter(([key,,re])=>key==="cv"||re.test(t)).map(([key,label,re])=>({key,label,fromPost:re.test(t)}));
}

function suggestFilename(profile,job,date){
 const co=apSlug(apCompany(job)||"company"),ti=apSlug(apTitleOf(job)||"role",28);
 return `resume_${co}_${ti}_${apIsoDate(date)}.pdf`;
}

// ---------------------------------------------------------------- the tailoring report

const apPct=c=>c&&c.total?Math.round(100*c.found/c.total):0;
function tailoringReport(ctx){
 const {kws,addedKw,requirements,coverBefore,coverNow,score,profile}=ctx;
 const added=new Set((addedKw||[]).map(k=>k.key));
 const have=Number(profile&&profile.preferences&&profile.preferences.experienceYears)||0;
 const gaps=[];
 for(const k of (kws||[])){
  if(k.kind==="degree"||!(k.tier==="must"||k.tier==="important"))continue;
  if(k.evidence!=="skills"&&!added.has(k.key))gaps.push(`${k.display}${k.hardRequirement?` (asks ${k.yearsRequired}+ yrs)`:""}: not in your profile`);
  else if(k.hardRequirement&&k.yearsRequired>have)gaps.push(`${k.display}: asks ${k.yearsRequired}+ yrs; your stated experience is ${have}`);
 }
 const r=requirements||{};
 for(const [label,g] of [["Education",r.education],["Experience",r.experience],["Location",r.location],["Salary",r.salary]]){
  if(g&&g.compare&&(g.compare.state==="gap"||g.compare.state==="partial"))gaps.push(`${label}: ${g.compare.note}`);
 }
 return {
  keywordsAdded:(addedKw||[]).map(k=>k.display),
  gaps:gaps.slice(0,12),
  matchBefore:apPct(coverBefore),
  matchAfter:apPct(coverNow),
  roleFit:typeof score==="number"?score:null
 };
}

// ---------------------------------------------------------------- the checklist

function buildChecklist(ctx){
 const {job,texts,docs,filename,needsCoverLetter,applyEmail}=ctx;
 const today=apIsoDate(ctx.today);
 const left=t=>apCountPlaceholders(t);
 const items=[];
 items.push({key:"resume",label:"Resume",state:"done",note:`Tailored to this post. Suggested file name: ${filename}`});
 const cl=left(texts.coverLetter);
 items.push({key:"cover",label:"Cover letter",
  state:needsCoverLetter?(cl?"todo":"done"):"info",
  note:needsCoverLetter?(cl?`The post asks for one; ${cl} [EDIT THIS] left to fill`:"The post asks for one; ready"):"The post does not ask for one; attach it only if you want to"});
 const em=left(texts.email);
 items.push({key:"email",label:"Email draft",state:em?"todo":"done",note:em?`${em} [EDIT THIS] left to fill`:"Ready to send"});
 const rm=left(texts.recruiter);
 items.push({key:"recruiter",label:"Recruiter message",state:rm?"todo":"done",note:rm?`${rm} [EDIT THIS] left to fill`:"Ready to send"});
 items.push({key:"url",label:"Application URL",state:job&&job.url?"info":(applyEmail?"info":"warn"),
  note:job&&job.url?job.url:(applyEmail?`No web link; apply by email to ${applyEmail}`:"The post gives no link or email; check the source before applying")});
 if(job&&job.deadline){
  const days=Math.round((new Date(job.deadline)-new Date(today))/86400000);
  items.push({key:"deadline",label:"Deadline",state:days<0?"warn":"info",note:days<0?`Passed on ${job.deadline}`:`${job.deadline} (${days} day${days===1?"":"s"} left)`});
 }else items.push({key:"deadline",label:"Deadline",state:"info",note:"Not stated in the post"});
 const extra=(docs||[]).filter(d=>d.key!=="cv"&&d.fromPost);
 items.push({key:"docs",label:"Required documents",state:extra.length?"todo":"info",
  note:extra.length?`Prepare: ${extra.map(d=>d.label).join(", ")}`:"The post names no documents beyond your resume"});
 const all=left(texts.coverLetter)+left(texts.email)+left(texts.recruiter);
 items.push({key:"placeholders",label:"Every [EDIT THIS] filled in",state:all?"todo":"done",note:all?`${all} left across the pack`:"None left"});
 return items;
}

// ---------------------------------------------------------------- experience order

// Most relevant experience first, as a tailored resume should: ranked by how many of the post's
// keywords each entry's role and bullets contain. Ties keep your own order.
function rankExperience(experience,kws){
 const pool=(kws||[]).filter(k=>k.kind!=="degree");
 return (experience||[]).map((x,i)=>({x,i,s:keywordHits([x.role,...(x.bullets||[]),...(x.tags||[])].join(" "),pool)}))
  .sort((a,b)=>b.s-a.s||a.i-b.i).map(o=>o.x);
}

// ---------------------------------------------------------------- everything at once

function buildApplicationPack(ctx){
 const {profile,job,text}=ctx;
 const filename=suggestFilename(profile,job,ctx.date);
 const docs=requiredDocuments(text);
 const needsCoverLetter=docs.some(d=>d.key==="cover"&&d.fromPost);
 const applyEmail=findApplyEmail(text);
 const coverLetter=buildCoverLetter(ctx);
 const email=buildEmailDraft({...ctx,filename,coverAttached:needsCoverLetter});
 const recruiter=buildRecruiterMessage(ctx);
 return {
  filename,docs,needsCoverLetter,applyEmail,coverLetter,email,recruiter,
  salary:suggestSalary(job,profile),
  report:tailoringReport(ctx)
 };
}

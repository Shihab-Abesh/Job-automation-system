/* Sent versions: a record of exactly what you sent for each application.

   A version is taken when you press Mark Applied (or Record current version): the resume as a plain
   document (resumedoc.js), the keywords you pressed Add for, the strategy, the cover letter, email and
   recruiter message as they stood, the pay the post offered and what was suggested, and the job post
   itself. Months later, if an interview comes, you can read the exact claims and wording the employer
   received, and download the same PDF again, even if your profile, the strategy or the post has since changed.

   It records what the app held at that moment. It cannot know what you actually attached or typed into an
   email, so the wording in the app says "recorded when you pressed Mark Applied", never "sent".

   Pure functions, no DOM: tests/test_keywords.py runs them under Node. Storage (encrypted, in the vault) is
   handled by index.html.
*/

const VN_SCHEMA=1;
const VN_MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function vnId(){
 return (typeof crypto!=="undefined"&&crypto.randomUUID)?crypto.randomUUID():"v-"+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
}
function vnLocalDate(d){
 const two=n=>String(n).padStart(2,"0");
 return `${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())}`;
}
// "2026-09-22" -> "22 Sep 2026"
function formatDay(iso){
 const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||""));
 return m?`${Number(m[3])} ${VN_MONTHS[Number(m[2])-1]||"?"} ${m[1]}`:"";
}
const vnCopy=x=>JSON.parse(JSON.stringify(x));
const vnStr=s=>s==null?"":String(s);

// c: {job, doc, strategy, strategyLabel, keywordsAdded, pack:{coverLetter,email,recruiter}, salary,
//     report, description, fileName, now, id}
// Everything is copied in, so nothing you edit afterwards can reach back into a recorded version.
function makeVersion(c){
 const job=c.job||{},now=c.now instanceof Date?c.now:new Date();
 const pack=c.pack||{},sal=c.salary||{},rep=c.report||{};
 return {
  schema:VN_SCHEMA,
  id:c.id||vnId(),
  jobId:vnStr(job.id),jobFingerprint:vnStr(job.fingerprint),
  company:vnStr(job.company).trim(),title:vnStr(job.title).trim(),
  url:vnStr(job.url),deadline:vnStr(job.deadline),source:vnStr(job.source),location:vnStr(job.location),
  appliedAt:now.toISOString(),appliedOn:vnLocalDate(now),updatedAt:now.toISOString(),
  fileName:vnStr(c.fileName),
  strategy:vnStr(c.strategy),strategyLabel:vnStr(c.strategyLabel),
  keywordsAdded:(c.keywordsAdded||[]).map(vnStr),
  doc:vnCopy(c.doc),
  pack:{coverLetter:vnStr(pack.coverLetter),email:vnStr(pack.email),recruiter:vnStr(pack.recruiter)},
  salary:{postedMin:job.salaryMin==null?null:Number(job.salaryMin),postedMax:job.salaryMax==null?null:Number(job.salaryMax),
   postedText:vnStr(job.salaryText),suggested:sal.amount==null?null:Number(sal.amount),note:vnStr(sal.note)},
  report:{gaps:(rep.gaps||[]).map(vnStr),matchBefore:rep.matchBefore==null?null:Number(rep.matchBefore),
   matchAfter:rep.matchAfter==null?null:Number(rep.matchAfter),roleFit:rep.roleFit==null?null:Number(rep.roleFit)},
  description:vnStr(c.description),
  note:""
 };
}

// What makes two versions "the same thing that was sent": the resume, the pack texts, the keywords
// and the strategy. Not the id, the time, the note, the file name (it carries the date), or the post.
function versionContentKey(v){
 return JSON.stringify([v.doc,v.pack&&v.pack.coverLetter,v.pack&&v.pack.email,v.pack&&v.pack.recruiter,v.keywordsAdded,v.strategy]);
}

function sortNewest(list){
 return [...(list||[])].sort((a,b)=>String(b.appliedAt).localeCompare(String(a.appliedAt)));
}
// A job's versions, newest first. Matched by the job's id, or by its fingerprint for a job that was
// re-created by a feed refresh, so the history never detaches from its job.
function versionsForJob(list,job){
 const id=vnStr(job&&job.id),fp=vnStr(job&&job.fingerprint);
 return sortNewest((list||[]).filter(v=>(id&&v.jobId===id)||(fp&&v.jobFingerprint===fp)));
}

// Adds a version unless the newest one for the same job holds exactly the same content.
function addVersion(list,v){
 const latest=versionsForJob(list,{id:v.jobId,fingerprint:v.jobFingerprint})[0];
 if(latest&&versionContentKey(latest)===versionContentKey(v))return {list,added:false,duplicateOf:latest.id};
 return {list:[...(list||[]),v],added:true,duplicateOf:null};
}

// What changed between two versions of the same job, in words a person would use.
function diffVersions(prev,next){
 if(!prev)return {first:true,identical:false,keywordsAdded:[...next.keywordsAdded],keywordsRemoved:[],changed:[]};
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const changed=[];
 if(prev.strategy!==next.strategy)changed.push("Resume strategy");
 const a=prev.doc,b=next.doc;
 if(a.name!==b.name||a.contact!==b.contact)changed.push("Name and contact");
 if(a.headline!==b.headline)changed.push("Headline");
 if(a.summary!==b.summary)changed.push("Summary");
 if(!same(a.skillRows,b.skillRows))changed.push("Core skills");
 if(!same([a.overridden,a.experience,a.experienceText],[b.overridden,b.experience,b.experienceText]))changed.push("Experience");
 if(!same([a.overridden,a.projects,a.projectsText],[b.overridden,b.projects,b.projectsText]))changed.push("Projects");
 if(!same(a.education,b.education))changed.push("Education");
 if(!same(a.references,b.references))changed.push("References");
 if(prev.pack.coverLetter!==next.pack.coverLetter)changed.push("Cover letter");
 if(prev.pack.email!==next.pack.email)changed.push("Email");
 if(prev.pack.recruiter!==next.pack.recruiter)changed.push("Recruiter message");
 const keywordsAdded=next.keywordsAdded.filter(k=>!prev.keywordsAdded.includes(k));
 const keywordsRemoved=prev.keywordsAdded.filter(k=>!next.keywordsAdded.includes(k));
 // Whatever else differs (a field this list does not name) must never read as "identical".
 if(!changed.length&&!keywordsAdded.length&&!keywordsRemoved.length&&versionContentKey(prev)!==versionContentKey(next))changed.push("Other details");
 return {first:false,identical:!changed.length&&!keywordsAdded.length&&!keywordsRemoved.length,keywordsAdded,keywordsRemoved,changed};
}

// One line for a list: "Zorblax Ltd - QA Engineer - applied 22 Sep 2026".
function versionLine(v){
 return `${v.company||"Unknown company"} - ${v.title||"Unknown role"} - applied ${formatDay(v.appliedOn)}`;
}

// Anything read back from storage or from an imported file is checked before it is trusted; a
// malformed record is dropped rather than allowed to crash the page or a renderer.
function isVersion(v){
 return !!v&&typeof v==="object"&&typeof v.id==="string"&&v.id.length>0
  &&typeof v.company==="string"&&typeof v.title==="string"
  &&typeof v.appliedAt==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(String(v.appliedOn))
  &&Array.isArray(v.keywordsAdded)&&v.keywordsAdded.every(k=>typeof k==="string")
  &&!!v.pack&&typeof v.pack==="object"&&typeof v.pack.coverLetter==="string"&&typeof v.pack.email==="string"&&typeof v.pack.recruiter==="string"
  &&isResumeDoc(v.doc);
}
function normalizeVersions(raw){
 const seen=new Set(),out=[];
 for(const v of Array.isArray(raw)?raw:[]){
  if(!isVersion(v)||seen.has(v.id))continue;
  seen.add(v.id);
  out.push({schema:VN_SCHEMA,jobId:"",jobFingerprint:"",url:"",deadline:"",source:"",location:"",fileName:"",strategy:"",strategyLabel:"",description:"",note:"",updatedAt:v.appliedAt,
   salary:{postedMin:null,postedMax:null,postedText:"",suggested:null,note:""},report:{gaps:[],matchBefore:null,matchAfter:null,roleFit:null},...v});
 }
 return out;
}
// Union by id; where both sides have the same version, the one edited last wins (its note, say).
function mergeVersions(current,incoming){
 const byId=new Map();
 for(const v of normalizeVersions(current))byId.set(v.id,v);
 for(const v of normalizeVersions(incoming)){
  const have=byId.get(v.id);
  if(!have||String(v.updatedAt)>String(have.updatedAt))byId.set(v.id,v);
 }
 return [...byId.values()];
}
function versionsStorageBytes(list){return JSON.stringify(list||[]).length}

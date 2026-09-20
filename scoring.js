/* Match scoring for the dashboard.

   backend/scoring.py does the same maths in Python, and tests/test_parity.py runs both on the
   same jobs and fails if they ever disagree: the number in the email has to be the number on
   screen. Everything is integer arithmetic so the two languages cannot round differently.

   score = 40% title fit + 25% level fit + 25% skills + 10% preference   (each part is 0-100)

     title fit   how much of one of your target titles the job title covers
     level fit   whether the job suits your experience. Trainee, junior or 0-1 years is full
                 marks; senior, lead, manager or 5+ years is nearly none. preferences.experienceYears
                 is how many years you have (default 0, a fresher)
     skills      how many of your listed skills the posting mentions (6 or more is full marks)
     preference  is the job's category one you switched on

   The old formula scored almost every job 53-56 because three of its four parts were the same
   for nearly every job, so the percentage could not tell a good match from a poor one.
*/
const stopWords=new Set(("and or the a an to of in for with on at from by is are be as this that will can should experience knowledge skills skill requirements responsible preferred plus using use ability excellent strong good candidate job role position company years year").split(" "));
function normalize(s){return (s||"").toLowerCase().replace(/[^a-z0-9+#./ ]/g," ")}
function terms(s){return [...new Set(normalize(s).split(/\s+/).filter(x=>x.length>2&&!stopWords.has(x)))]}
function allEvidence(p){
 return [
 ...p.skills.flatMap(g=>g.items),
 ...p.experience.flatMap(x=>[x.role,x.company,...x.bullets]),
 ...p.projects.flatMap(x=>[x.name,x.subtitle||x.description||"",...(x.skills||[]),...x.bullets])
 ].join(" ").toLowerCase()
}

const ABBREV={mto:"management trainee officer",sqa:"software quality assurance",qa:"quality assurance",mis:"management information systems",it:"information technology",ba:"business analyst"};
const SENIOR_RE=/\b(senior|sr|lead|principal|staff|head|director|architect|manager|chief|vp)\b/i;
const JUNIOR_RE=/\b(junior|jr|trainee|intern|internship|fresher|freshers|graduate|entry)\b/i;
const YEARS_RE=/(\d+)\s*(?:\+|-\s*\d+|to\s*\d+)?\s*(?:years?|yrs?)\b/i;

// Abbreviations are expanded for titles only: in a description "it" is a pronoun.
function words(s,expand){
 return ((s||"").toLowerCase().match(/[a-z0-9+#]+/g)||[]).flatMap(w=>expand&&ABBREV[w]?ABBREV[w].split(" "):[w]);
}

function titleFit(job,p){
 const have=new Set(words(job.title,true));
 let best=0;
 for(const target of (p.preferences&&p.preferences.titles)||[]){
  const w=[...new Set(words(target,true))];
  if(!w.length)continue;
  const hit=w.filter(x=>have.has(x)).length;
  const fit=Math.floor((200*hit+w.length)/(2*w.length));
  if(fit>best)best=fit;
 }
 return best;
}

function levelFit(job,p){
 const title=job.title||"";
 if(SENIOR_RE.test(title))return 10;
 if(JUNIOR_RE.test(title))return 100;
 const exp=job.experienceText||"";
 if(/fresher/i.test(exp))return 100;
 const m=YEARS_RE.exec(exp)||YEARS_RE.exec(title)||YEARS_RE.exec((job.description||"").slice(0,800));
 if(!m)return 65;
 const have=Math.floor(Number(p.preferences&&p.preferences.experienceYears)||0);
 const gap=Math.max(0,Number(m[1])-have);
 return gap<4?[100,80,55,30][gap]:10;
}

function skillPhrases(p){
 const seen=new Set(),out=[];
 for(const item of [...p.skills.flatMap(g=>g.items||[]),...(p.projects||[]).flatMap(x=>x.skills||[])]){
  const key=words(item,false).join(" ");
  if(key.length>1&&!seen.has(key)){seen.add(key);out.push([String(item).trim(),key]);}
 }
 return out;
}

function analyzeJob(job,p){
 const text=[job.title,job.description,job.requiredSkills||""].join(" ");
 const raw=terms(text);
 const evidence=allEvidence(p);
 const missing=raw.filter(t=>!evidence.includes(t)).slice(0,12);

 const hay=" "+words(text,false).join(" ")+" ";
 const matched=skillPhrases(p).filter(([,key])=>hay.includes(" "+key+" ")).map(([name])=>name);

 const title=titleFit(job,p);
 const level=levelFit(job,p);
 const skill=Math.min(100,Math.floor((100*matched.length+3)/6));
 const cat=(job.category||"").toLowerCase();
 const pref=((p.preferences&&p.preferences.categories)||[]).some(c=>c.toLowerCase()===cat)?100:40;
 const score=Math.floor((40*title+25*level+25*skill+10*pref+50)/100);
 return {score,titleFit:title,levelFit:level,skillFit:skill,prefFit:pref,matched:matched.slice(0,15),missing:[...new Set(missing)]}
}

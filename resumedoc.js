/* Resume document: a resume as plain data.

   The on-screen preview, the PDF, the DOCX, the TXT and every stored "sent version" are all rendered from
   this one object, so what you see, what you download and what was recorded when you applied cannot
   drift apart. It holds copies (strings and arrays), never references into the profile, so changing your
   Master Profile later cannot rewrite a resume that was already sent.

   Pure functions, no DOM: tests/test_keywords.py runs them under Node. The PDF/DOCX renderers that need
   the browser libraries live in resumefiles.js.
*/

const RD_DOC_VERSION=1;
const rdStr=s=>s==null?"":String(s);
const rdJoin=parts=>parts.filter(Boolean).join(" | ");

// c: {profile, headline, contact, summary, skillRows, experience, projects, overridden,
//     experienceText, projectsText}. experience/projects arrive already ordered and filtered the way
//     the resume shows them; experienceText/projectsText are the plain-text form of the same content
//     (or your hand-edited text, when overridden).
function buildResumeDoc(c){
 const p=c.profile||{},personal=p.personal||{};
 return {
  v:RD_DOC_VERSION,
  name:rdStr(personal.fullName),
  headline:rdStr(c.headline),
  contact:rdStr(c.contact),
  summary:rdStr(c.summary),
  skillRows:(c.skillRows||[]).map(g=>({category:rdStr(g.category),items:(g.items||[]).filter(Boolean).map(rdStr)})),
  experience:(c.experience||[]).map(e=>({title:`${e.role}, ${e.company}`,meta:rdJoin([e.location,e.duration]),bullets:(e.bullets||[]).filter(Boolean).map(rdStr)})),
  projects:(c.projects||[]).map(x=>({title:`${x.name}${x.subtitle?`, ${x.subtitle}`:""}`,name:rdStr(x.name),subtitle:rdStr(x.subtitle),bullets:(x.bullets||[]).filter(Boolean).map(rdStr)})),
  overridden:!!c.overridden,
  experienceText:rdStr(c.experienceText),
  projectsText:rdStr(c.projectsText),
  education:(p.education||[]).map(e=>({degree:rdStr(e.degree),date:rdStr(e.date),detail:rdJoin([e.institution,e.score])})),
  references:(p.references||[]).filter(r=>r.name).map(r=>({name:rdStr(r.name),title:rdStr(r.title),contact:rdJoin([r.email,r.phone])}))
 };
}

// The same plain-text layout the dashboard has always produced for the TXT download.
function resumeDocToText(d){
 const skills=d.skillRows.map(g=>`${g.category}: ${g.items.join(", ")}`).join("\n");
 const edu=d.education.map(e=>`${e.degree}${e.date?" | "+e.date:""}\n${e.detail}`).join("\n\n");
 const refs=d.references.map(r=>`${r.name}\n${r.title}\n${r.contact}`).join("\n\n");
 return `${(d.name||"Your Name").toUpperCase()}\n${d.headline?d.headline.toUpperCase()+"\n":""}${d.contact}\n\nPROFESSIONAL SUMMARY\n${d.summary}\n\nCORE SKILLS\n${skills}\n\nPROFESSIONAL EXPERIENCE\n${d.experienceText}\n\nPROJECTS\n${d.projectsText}\n\nEDUCATION\n${edu}${refs?`\n\nREFERENCES\n${refs}`:""}`;
}

// Is this object shaped like a resume document? Used before trusting anything read back from storage
// or from an imported file: a renderer given a malformed one would throw halfway through a PDF.
function isResumeDoc(d){
 if(!d||typeof d!=="object")return false;
 const arr=v=>Array.isArray(v);
 return typeof d.name==="string"&&typeof d.summary==="string"&&typeof d.contact==="string"
  &&arr(d.skillRows)&&d.skillRows.every(g=>g&&typeof g.category==="string"&&arr(g.items))
  &&arr(d.experience)&&d.experience.every(e=>e&&typeof e.title==="string"&&arr(e.bullets))
  &&arr(d.projects)&&d.projects.every(x=>x&&typeof x.title==="string"&&arr(x.bullets))
  &&arr(d.education)&&d.education.every(e=>e&&typeof e.degree==="string")
  &&arr(d.references)&&typeof d.experienceText==="string"&&typeof d.projectsText==="string";
}

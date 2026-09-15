"""Build a form-filling bookmarklet from your master profile.

No install, no browser driver, no permissions. You open an application form,
click the bookmark, and the fields it recognises get filled with your real
details. It never clicks submit, and it never invents an answer: fields it
cannot map are left for you.

    python tools/make_bookmarklet.py > bookmarklet.txt

Then make a new browser bookmark and paste the whole line in as the URL.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import quote

# The public profile has no contact details, so this reads the local copy.
# Create it once: copy config/profile.local.example.json, fill it in. It is
# gitignored and never leaves your machine.
LOCAL = Path("config/profile.local.json")
PUBLIC = Path("config/profile.json")

TEMPLATE = """javascript:(function(){
var P=%s;
var MAP=[
 [/first ?name|given ?name/i,P.firstName],
 [/last ?name|surname|family ?name/i,P.lastName],
 [/full ?name|^name$|applicant/i,P.fullName],
 [/e-?mail/i,P.email],
 [/phone|mobile|contact ?number|cell/i,P.phone],
 [/linked ?in/i,P.linkedin],
 [/github/i,P.github],
 [/portfolio|website|personal ?site/i,P.portfolio],
 [/address|location|city|present ?address/i,P.location],
 [/university|institution|college|school/i,P.university],
 [/degree|qualification|education level/i,P.degree],
 [/cgpa|gpa|result|grade/i,P.cgpa],
 [/current (job|position|designation|title)|present ?position/i,P.currentRole],
 [/current (employer|company|organization)/i,P.currentCompany],
 [/(years? of )?experience/i,P.experienceYears],
 [/expected (salary|ctc)|salary expectation/i,P.expectedSalary],
 [/notice ?period/i,P.noticePeriod],
 [/cover ?letter|why (do )?you|about ?you|summary|objective/i,P.summary]
];
var n=0;
function label(el){
 var t=[el.name,el.id,el.placeholder,el.getAttribute('aria-label')||''].join(' ');
 if(el.labels&&el.labels.length)t+=' '+el.labels[0].innerText;
 var p=el.closest('div,td,li,section');
 if(p)t+=' '+(p.innerText||'').slice(0,90);
 return t;
}
document.querySelectorAll('input,textarea').forEach(function(el){
 var ty=(el.type||'').toLowerCase();
 if(['hidden','submit','button','file','checkbox','radio','password'].indexOf(ty)>=0)return;
 if(el.value&&el.value.trim())return;
 var t=label(el);
 for(var i=0;i<MAP.length;i++){
  if(MAP[i][0].test(t)&&MAP[i][1]){
   var setter=Object.getOwnPropertyDescriptor(
     el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype,'value').set;
   setter.call(el,MAP[i][1]);
   el.dispatchEvent(new Event('input',{bubbles:true}));
   el.dispatchEvent(new Event('change',{bubbles:true}));
   el.style.outline='2px solid #22d3ee';
   n++;break;
  }
 }
});
alert('CareerPilot filled '+n+' field'+(n===1?'':'s')+'.\\nCheck every one, attach your CV, then submit it yourself.');
})();"""


def build(profile: dict) -> str:
    p = profile.get("personal", {})
    edu = (profile.get("education") or [{}])[0]
    exp = (profile.get("experience") or [{}])[0]
    name = p.get("fullName", "")
    first, _, last = name.partition(" ")
    fields = {
        "fullName": name,
        "firstName": first,
        "lastName": last or first,
        "email": p.get("email", ""),
        "phone": p.get("phone", ""),
        "location": p.get("location", ""),
        "linkedin": p.get("linkedin", ""),
        "github": p.get("github", ""),
        "portfolio": p.get("portfolio", ""),
        "university": edu.get("institution", ""),
        "degree": edu.get("degree", ""),
        "cgpa": edu.get("cgpa", ""),
        "currentRole": exp.get("role", ""),
        "currentCompany": exp.get("company", ""),
        # Left blank on purpose. These change per application and guessing
        # them is how a CV ends up saying something you did not mean.
        "experienceYears": "",
        "expectedSalary": "",
        "noticePeriod": "",
        "summary": "",
    }
    js = TEMPLATE % json.dumps(fields, ensure_ascii=False)
    compact = " ".join(js.split())
    return "javascript:" + quote(compact[len("javascript:"):], safe="")


if __name__ == "__main__":
    if not LOCAL.exists():
        sys.exit(
            f"{LOCAL} not found.\n"
            f"Copy config/profile.local.example.json to {LOCAL} and fill in your\n"
            f"name, email and phone. It stays on this machine."
        )
    data = json.loads(PUBLIC.read_text(encoding="utf-8")) if PUBLIC.exists() else {}
    data.update(json.loads(LOCAL.read_text(encoding="utf-8")))
    print(build(data))

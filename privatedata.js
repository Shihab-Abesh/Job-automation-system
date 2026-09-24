/* Private per-job data: what you wrote yourself for one application.

   Two things are yours and personal: the hand-edited resume text (headline, summary, experience,
   projects) and the edited cover letter, email and recruiter message. They name you and say things
   about you, so they are kept in the encrypted vault, keyed by job id, and never on the job record,
   which sits unencrypted in the browser because a job post is public.

   Older versions of the dashboard stored both on the job record. splitPrivate() lifts them off so they can
   be moved into the vault; the dashboard only removes them from the job list after the encrypted copy has
   been written, so a failed write never loses an edit.

   Pure functions, no DOM or storage: tests/test_keywords.py runs them under Node.
*/

const PD_FIELDS=["resumeOverrides","applicationPack"];
const PD_OVERRIDE_KEYS=["headline","summary","experienceText","projectsText"];
const PD_PACK_KEYS=["coverLetter","email","recruiter"];
const pdIsObj=x=>!!x&&typeof x==="object"&&!Array.isArray(x);

// A hand-edited resume: all four texts, as strings. Anything else is not one, and is dropped.
function pdCleanOverrides(o){
 if(!pdIsObj(o)||!PD_OVERRIDE_KEYS.every(k=>typeof o[k]==="string"))return null;
 const out={};
 for(const k of PD_OVERRIDE_KEYS)out[k]=o[k];
 return out;
}
// An edited pack: only the three known texts, only if they are strings. A part you reset (undefined) is absent.
function pdCleanPack(o){
 if(!pdIsObj(o))return null;
 const out={};
 for(const k of PD_PACK_KEYS)if(typeof o[k]==="string")out[k]=o[k];
 return Object.keys(out).length?out:null;
}
function pdCleanEntry(e){
 if(!pdIsObj(e))return null;
 const out={},ov=pdCleanOverrides(e.resumeOverrides),ap=pdCleanPack(e.applicationPack);
 if(ov)out.resumeOverrides=ov;
 if(ap)out.applicationPack=ap;
 return Object.keys(out).length?out:null;
}

// Whatever was read back from storage: {jobId:{resumeOverrides?,applicationPack?}}, validated.
function normalizePrivate(raw){
 const out={};
 if(!pdIsObj(raw))return out;
 for(const id of Object.keys(raw)){
  const e=pdCleanEntry(raw[id]);
  if(e)out[id]=e;
 }
 return out;
}

// Lift the two fields off every job record. Returns the jobs without them (only records that had them
// are copied), what was lifted, and how many jobs had something to lift.
function splitPrivate(jobs){
 const moved={};
 let count=0;
 const out=(jobs||[]).map(j=>{
  if(!j||typeof j!=="object")return j;
  const has=PD_FIELDS.some(f=>f in j);
  if(!has)return j;
  const e=pdCleanEntry(j);
  if(e&&j.id!=null){moved[j.id]=e;count++;}
  const rest={...j};
  // Only strip a field that was valid and is being kept in `moved`; a malformed one is left where it is.
  if(e&&j.id!=null)for(const f of PD_FIELDS)delete rest[f];
  return rest;
 });
 return {jobs:out,moved,count};
}

// Per job and per field, what is already in the vault wins; a field it lacks is filled from `incoming`.
// (The vault is the newer copy: the plain one is only ever a leftover from an older page.)
function mergePrivate(current,incoming){
 const out={};
 for(const id of new Set([...Object.keys(current||{}),...Object.keys(incoming||{})])){
  const a=pdCleanEntry((current||{})[id])||{},b=pdCleanEntry((incoming||{})[id])||{};
  const e=pdCleanEntry({...b,...a});
  if(e)out[id]=e;
 }
 return out;
}

// One job's edits after a change. A field set to null/undefined (or a pack part set to undefined) is removed,
// and a job with nothing left has no entry at all.
function withPrivate(map,jobId,patch){
 const cur={...((map||{})[jobId]||{})};
 for(const f of PD_FIELDS)if(f in (patch||{})){
  if(patch[f]==null)delete cur[f];else cur[f]=patch[f];
 }
 const e=pdCleanEntry(cur);
 const out={...(map||{})};
 if(e)out[jobId]=e;else delete out[jobId];
 return out;
}
function dropPrivate(map,jobId){
 const out={...(map||{})};
 delete out[jobId];
 return out;
}
